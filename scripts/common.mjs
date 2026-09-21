import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { researchSchema } from './research-schema.mjs';
import { sharedConnection } from './shared-api-client.mjs';
import { atomicRename } from './atomic-rename.mjs';
import { normalizeSlug } from './server/slugs.mjs';

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const config = JSON.parse(await fs.readFile(path.join(repo, 'config.json'), 'utf8'));
if (process.env.WIKI_PORT) config.port = Number(process.env.WIKI_PORT);
export const root = path.resolve(process.env.WIKI_DATA_ROOT || config.dataRoot);
export const dataPath = (...parts) => path.join(root, ...parts);
export const sha = data => createHash('sha256').update(data).digest('hex');
export const now = () => new Date().toISOString();
export const slash = p => p.split(path.sep).join('/');
export const safeName = name => {
  const clean=path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'');
  const suffix=path.extname(clean),ext=suffix.length<=16?suffix:'';
  return (clean.length<=150?clean:clean.slice(0,150-ext.length).replace(/[. ]+$/,'')+ext)||'document';
};

const jsonWrites = new Map();
export async function atomicJson(file, value) {
  const contents = JSON.stringify(value, null, 2) + '\n';
  const manifestCounts = file === manifestPath ? countManifest(value) : null;
  // Serialize same-file writes: Windows cannot reliably replace one file concurrently.
  const pending = (jsonWrites.get(file) ?? Promise.resolve()).catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(file), {recursive: true});
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, contents, 'utf8');
      const written = file === manifestPath ? await fs.stat(temp) : null;
      await atomicRename(temp, file);
      if (file === manifestPath) {
        try {
          const stat = await fs.stat(file);
          if (stat.ino === written.ino && stat.mtimeMs === written.mtimeMs && stat.size === written.size) {
            await atomicJson(dataPath('state', 'manifest-summary.json'), { key: manifestKey(stat), counts: manifestCounts });
          }
        } catch { /* A derived summary must never turn a successful manifest write into a failed ingest. */ }
      }
    } finally { await fs.rm(temp, { force: true }); }
  });
  jsonWrites.set(file, pending);
  try { await pending; } finally { if (jsonWrites.get(file) === pending) jsonWrites.delete(file); }
}
export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
export const manifestPath = dataPath('state', 'manifest.json');
export const manifest = () => readJson(manifestPath, {version: 1, documents: {}});
const manifestKey = stat => stat ? `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}` : 'missing';
function countManifest(value) {
  const counts = { documents: 0, indexed: 0, failed: 0, pdf_pages: 0 };
  for (const doc of Object.values(value.documents ?? {})) {
    counts.documents++;
    if (doc.status === 'indexed') counts.indexed++;
    if (doc.status === 'failed') counts.failed++;
    counts.pdf_pages += Number(doc.pages) || 0;
  }
  return counts;
}
let summaryCache, summaryPending;
export async function manifestSummary() {
  if (summaryPending) return summaryPending;
  summaryPending = (async () => {
    const stat = await fs.stat(manifestPath).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    const key = manifestKey(stat);
    if (summaryCache?.key === key) return summaryCache.counts;
    const file = dataPath('state','manifest-summary.json');
    const saved = await readJson(file, null).catch(() => null);
    if (saved?.key === key) { summaryCache = saved; return saved.counts; }
    const snapshot = await manifestSnapshot();
    summaryCache = { key: snapshot.key, counts: snapshot.counts };
    await atomicJson(file, summaryCache);
    return summaryCache.counts;
  })().finally(() => { summaryPending = null; });
  return summaryPending;
}
// Writers keep independent mutable copies. Readers share one mtime-checked snapshot.
let manifestCache, manifestPending;
export async function manifestSnapshot() {
  if (manifestPending) return manifestPending;
  manifestPending = (async () => {
    const stat = await fs.stat(manifestPath).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    const key = manifestKey(stat);
    if (manifestCache?.key === key) return manifestCache;
    const value = await manifest();
    const counts = countManifest(value), bySlug = new Map();
    for (const doc of Object.values(value.documents)) {
      const slug = normalizeSlug(doc.wiki_slug ?? '');
      if (slug && !bySlug.has(slug)) bySlug.set(slug, doc);
    }
    return manifestCache = { key, value, counts, bySlug };
  })().finally(() => { manifestPending = null; });
  return manifestPending;
}
export async function ensureDirs() {
  for (const type of researchSchema.page_types) await fs.mkdir(dataPath('wiki', type.path_prefixes[0]), { recursive: true });
  for (const d of ['raw','parsed','wiki/sources','wiki/concepts','wiki/claims','wiki/hypotheses','wiki/factors','wiki/strategies','wiki/experiments','wiki/datasets','inbox','state','logs','backups','models','cache','runtime']) {
    await fs.mkdir(dataPath(d), {recursive:true});
  }
}
export async function withLock(fn) {
  await ensureDirs();
  const priority=await readJson(dataPath('state','ingest-priority.json'),null).catch(e=>{if(e instanceof SyntaxError)return {pid:null};throw e;});
  if(priority && priority.pid!==process.pid) {
    let active=true;
    if(Number.isInteger(priority.pid)){try{process.kill(priority.pid,0);}catch(e){if(e.code==='ESRCH')active=false;}}
    if(active)throw new Error(`已有导入任务占用锁（PID ${priority.pid ?? '正在登记'}，等待完成文章入库）。`);
  }
  const file = dataPath('state', 'ingest.lock');
  let handle;
  try { handle = await fs.open(file, 'wx'); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const old = await readJson(file, {});
    throw new Error(`已有导入任务占用锁（PID ${old.pid ?? '未知'}）。确认该进程已退出后再清理 ${file}`);
  }
  try { await handle.writeFile(JSON.stringify({pid:process.pid, started_at:now()})); return await fn(); }
  finally { await handle.close(); await fs.unlink(file); }
}
/** Reserve the next ingest slot so continuously running PDF groups cannot starve indexing. */
export async function withIngestPriority(fn) {
  await ensureDirs();
  const file=dataPath('state','ingest-priority.json');let handle;
  try {handle=await fs.open(file,'wx');}
  catch(e) {
    if(e.code!=='EEXIST')throw e;
    const owner=await readJson(file,null);
    let alive=true;
    if(Number.isInteger(owner?.pid)){try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}}
    if(alive)throw new Error(`已有导入任务占用锁（PID ${owner?.pid ?? '未知'}，文章入库等待中）。`);
    await fs.unlink(file);handle=await fs.open(file,'wx');
  }
  try {await handle.writeFile(JSON.stringify({pid:process.pid,started_at:now()}));return await fn();}
  finally {await handle.close();await fs.unlink(file);}
}
export function runtimeEnv() {
  const shared = sharedConnection(config, root);
  return {...process.env,
    GBRAIN_HOME:dataPath('runtime'), GBRAIN_SOURCE:'default', OLLAMA_BASE_URL:(shared?.baseUrl || config.ollamaUrl).replace(/\/$/, '')+'/v1',
    ...(shared ? { OLLAMA_API_KEY:shared.apiKey, WIKI_SHARED_API:'1', GBRAIN_AI_EMBED_TIMEOUT_MS:'210000', GBRAIN_QUERY_EMBED_TIMEOUT_MS:'210000' } : { WIKI_SHARED_API:'0' }),
    HF_HOME:dataPath('models','huggingface'), MODELSCOPE_CACHE:dataPath('models','modelscope'),
    MINERU_TOOLS_CONFIG_JSON:dataPath('runtime','mineru.json'), MINERU_MODEL_SOURCE:config.mineruModelSource,
    PYTHONUTF8:'1', PYTHONIOENCODING:'utf-8', UV_CACHE_DIR:dataPath('cache','uv'),
    BUN_INSTALL_CACHE_DIR:dataPath('cache','bun'), DO_NOT_TRACK:'1'};
}
export function run(executable, args, {env=runtimeEnv(), timeout=600000, cwd=repo, logFile}={}) {
  return new Promise((resolve,reject) => {
    const child=spawn(executable,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',timedOut=false;
    const log=logFile?createWriteStream(logFile,{flags:'w'}):null;
    const timer=setTimeout(()=>{timedOut=true;child.kill();},timeout);
    child.stdout.on('data',x=>{stdout += x;log?.write(x);});
    child.stderr.on('data',x=>{stderr += x;log?.write(x);});
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',async code=>{
      clearTimeout(timer);
      if(log) await new Promise(resolve=>log.end(resolve));
      if(code !== 0 || timedOut) reject(new Error(`${path.basename(executable)} ${args[0] || ''} ${timedOut?'超时':`退出码 ${code}`}：${stderr.slice(-1800) || stdout.slice(-1800)}`));
      else resolve({stdout,stderr});
    });
  });
}
export const bun = path.join(repo,'node_modules','bun','bin',os.platform()==='win32'?'bun.exe':'bun');
export const gbrainCli = path.join(repo,'vendor','gbrain','src','cli.ts');
export const gb = (args,options) => run(bun,['--preload',path.join(repo,'scripts','gbrain-shared-preload.mjs'),gbrainCli,...args],options);
export function assetUrl(file) {
  const rel=slash(path.relative(root,file));
  if(rel.startsWith('../')||path.isAbsolute(rel))throw new Error('文件不在数据目录中');
  return '/assets/'+rel.split('/').map(encodeURIComponent).join('/');
}
export async function filesBelow(dir) {
  const out=[];
  for(const item of await fs.readdir(dir,{withFileTypes:true})) {
    const file=path.join(dir,item.name);
    if(item.isDirectory())out.push(...await filesBelow(file));
    else if(item.isFile())out.push(file);
  }
  return out;
}
