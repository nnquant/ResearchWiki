import fs from 'node:fs/promises';
import path from 'node:path';
import {config,repo,dataPath,readJson,atomicJson,manifest,withLock,sha,now,filesBelow} from './common.mjs';
import {capture,parseRecord,indexWiki} from './ingest.mjs';

const statePath=dataPath('state','directory-import.json');
export function readyFile(stat,previous,download,at,stableMs) {
  if(!stat.size)return false;
  if(download)return download.status==='done'&&Number(download.size)===stat.size;
  return previous?.signature===`${stat.size}:${stat.mtimeMs}`&&at-previous.stable_since>=stableMs;
}
export function completePdf(bytes) {
  return bytes.subarray(0,5).toString()==='%PDF-'&&bytes.subarray(-4096).includes(Buffer.from('%%EOF'));
}
export async function parallelMap(items,concurrency,fn) {
  let cursor=0;const results=new Array(items.length);
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
    for(;;){const i=cursor++;if(i>=items.length)return;results[i]=await fn(items[i],i);}
  }));
  return results;
}
export async function scanDirectory(folder,state,{stableSeconds=60,maxAttempts=3}={}) {
  const downloadState=await readJson(path.join(folder,'_state.json'),{});
  const files=(await filesBelow(folder)).filter(f=>/\.(pdf|md|txt|html?)$/i.test(f));
  const candidates=[],at=Date.now();
  for(const file of files) {
    const stat=await fs.stat(file),signature=`${stat.size}:${stat.mtimeMs}`;
    const old=state.files[file],same=old?.signature===signature;
    const entry=state.files[file]=same?old:{signature,stable_since:at,status:'waiting',attempts:0};
    entry.last_seen=at;
    if(['indexed','duplicate'].includes(entry.status))continue;
    if(!readyFile(stat,entry,downloadState[path.relative(folder,file)],at,stableSeconds*1000))continue;
    if(entry.attempts>=maxAttempts||entry.retry_at>at)continue;
    const bytes=await fs.readFile(file),after=await fs.stat(file);
    if(`${after.size}:${after.mtimeMs}`!==signature||bytes.length!==stat.size)continue;
    if(/\.pdf$/i.test(file)&&!completePdf(bytes)){entry.reason='PDF 尚未完整';continue;}
    entry.sha256=sha(bytes);entry.status='ready';delete entry.reason;
    candidates.push({file,signature,sha256:entry.sha256,size:stat.size,mtime:stat.mtimeMs});
  }
  candidates.sort((a,b)=>a.mtime-b.mtime||a.file.localeCompare(b.file));
  state.discovered=files.length;return candidates;
}
export async function importDirectoryOnce(folder,options={}) {
  folder=path.resolve(folder);
  const cfg={...config.directoryImport,...options};
  if(!Number.isInteger(cfg.concurrency)||cfg.concurrency<1||cfg.concurrency>4)throw new Error('MinerU 并行度应为 1–4');
  const state=await readJson(statePath,{files:{}});
  if(state.folder&&path.resolve(state.folder)!==folder)throw new Error('导入目录与已有状态不一致');
  Object.assign(state,{folder,pid:process.pid,phase:'scanning',updated_at:now(),concurrency:cfg.concurrency});
  try {
    const candidates=await scanDirectory(folder,state,cfg);
    return await withLock(async()=>{
      const batch=[],catalog=await manifest(),byHash=new Map(Object.values(catalog.documents).map(d=>[d.sha256,d]));
      for(const candidate of candidates) {
        const entry=state.files[candidate.file],existing=byHash.get(candidate.sha256);
        if(existing&&['parsed','indexed'].includes(existing.status)) {
          Object.assign(entry,{status:existing.status==='indexed'?'duplicate':'ready',id:existing.id});continue;
        }
        if(batch.length>=cfg.batchSize)continue;
        if(batch.some(b=>b.sha256===candidate.sha256))continue;
        const bytes=await fs.readFile(candidate.file),stat=await fs.stat(candidate.file);
        if(`${stat.size}:${stat.mtimeMs}`!==candidate.signature||sha(bytes)!==candidate.sha256)continue;
        const record=existing||await capture({bytes,filename:path.basename(candidate.file),title:path.basename(candidate.file),source_kind:'local',source_meta:{import_path:candidate.file,import_method:'directory-watch'}});
        Object.assign(entry,{id:record.id,status:'processing',attempts:entry.attempts+1});
        batch.push({...candidate,record});byHash.set(candidate.sha256,record);
      }
      state.phase=batch.length?'processing':'idle';state.active=batch.map(b=>({id:b.record.id,title:b.record.title}));
      state.batch_started_at=now();state.updated_at=now();await atomicJson(statePath,state);
      const results=await parallelMap(batch,cfg.concurrency,async item=>{
        const started=Date.now();console.log(`开始导入：${item.record.title}`);
        try {
          const done=await parseRecord(item.record,{mineruVramGB:cfg.mineruVramGB});
          return {file:item.file,id:done.id,title:done.title,status:done.status,pages:done.pages,elapsed_ms:Date.now()-started};
        } catch(error) {return {file:item.file,id:item.record.id,title:item.record.title,status:'failed',error:error.message.slice(0,1200),elapsed_ms:Date.now()-started};}
      });
      for(const result of results) {
        const entry=state.files[result.file];Object.assign(entry,result);
        if(result.status==='failed')entry.retry_at=Date.now()+15*60*1000*entry.attempts;
      }
      if(Object.values((await manifest()).documents).some(d=>d.status==='parsed')) {
        state.phase='indexing';state.updated_at=now();await atomicJson(statePath,state);
        await indexWiki();
      }
      const current=await manifest();
      for(const entry of Object.values(state.files))if(entry.id&&current.documents[entry.id]?.status==='indexed'&&entry.status!=='duplicate')entry.status='indexed';
      state.last_batch=results;state.active=[];state.phase='idle';state.updated_at=now();delete state.error;
      state.counts=Object.values(state.files).reduce((out,f)=>(out[f.status]=(out[f.status]||0)+1,out),{});
      await atomicJson(statePath,state);
      console.log(JSON.stringify({at:state.updated_at,discovered:state.discovered,counts:state.counts,batch:results}));
      return state;
    });
  } catch(error) {
    state.phase='waiting';state.error=error.message.slice(0,1200);state.updated_at=now();
    await atomicJson(statePath,state);throw error;
  }
}
export async function watchDirectory(folder,options={}) {
  const lockPath=dataPath('state','directory-watch.lock');
  await fs.mkdir(path.dirname(lockPath),{recursive:true});
  const lock=await fs.open(lockPath,'wx');
  await lock.writeFile(JSON.stringify({pid:process.pid,folder,started_at:now()}));
  let stopping=false;process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
  try {
    while(!stopping) {
      const cfg={...(await readJson(path.join(repo,'config.json'),{})).directoryImport,...options};
      if(!cfg.enabled)break;
      try {await importDirectoryOnce(folder,cfg);}catch(error){console.error(`目录导入等待：${error.message}`);}
      // Drain queued files immediately; poll once a minute only when waiting for downloads.
      const state=await readJson(statePath,{});
      const delay=state.counts?.ready&&state.phase==='idle'?1000:(cfg.pollSeconds??60)*1000;
      await new Promise(resolve=>setTimeout(resolve,delay));
    }
  } finally {await lock.close();await fs.unlink(lockPath);}
}
