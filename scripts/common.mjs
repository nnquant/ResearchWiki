import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { researchSchema } from './research-schema.mjs';

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

export async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(temp, file);
}
export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
export const manifestPath = dataPath('state', 'manifest.json');
export const manifest = () => readJson(manifestPath, {version: 1, documents: {}});
export async function ensureDirs() {
  for (const type of researchSchema.page_types) await fs.mkdir(dataPath('wiki', type.path_prefixes[0]), { recursive: true });
  for (const d of ['raw','parsed','wiki/sources','wiki/concepts','wiki/claims','wiki/hypotheses','wiki/factors','wiki/strategies','wiki/experiments','wiki/datasets','inbox','state','logs','backups','models','cache','runtime']) {
    await fs.mkdir(dataPath(d), {recursive:true});
  }
}
export async function withLock(fn) {
  await ensureDirs();
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
export function runtimeEnv() {
  return {...process.env,
    GBRAIN_HOME:dataPath('runtime'), GBRAIN_SOURCE:'default', OLLAMA_BASE_URL:config.ollamaUrl+'/v1',
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
export const gb = (args,options) => run(bun,[gbrainCli,...args],options);
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
