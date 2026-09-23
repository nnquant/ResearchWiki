// Refresh only existing GBrain projections of the reviewed Wiki migration.
// Reuse vectors only for byte-identical chunks; changed text must be re-embedded.
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import {loadConfig,toEngineConfig} from '../vendor/gbrain/src/core/config.ts';
import {createEngine} from '../vendor/gbrain/src/core/engine-factory.ts';
import {configureGateway} from '../vendor/gbrain/src/core/ai/gateway.ts';
import {buildGatewayConfig} from '../vendor/gbrain/src/core/ai/build-gateway-config.ts';
import {importFromContent} from '../vendor/gbrain/src/core/import-file.ts';
import {embedStalePages} from '../vendor/gbrain/src/core/embed-stale.ts';
import {embedBatchWithBackoff} from '../vendor/gbrain/src/core/embed-retry.ts';
import {dataPath,sha,atomicJson,now} from './common.mjs';

const folder=path.resolve('work/wiki-ad-cleanup-20260923');
const deferEmbeddings=process.argv.includes('--defer-embeddings');
const result=JSON.parse(await fs.readFile(path.join(folder,'result.json'),'utf8'));
if(result.errors.length)throw new Error('Wiki migration is incomplete');
if(process.argv.includes('--only-projection-errors')){
 const issues=JSON.parse(await fs.readFile(path.join(folder,'projection-preview.json'),'utf8')).errors;
 const slugs=new Set(issues.map(x=>x.slug));result.documents=result.documents.filter(x=>slugs.has(x.slug));
}
const journal=path.join(folder,'gbrain-progress.jsonl');
const scope=new Set(result.documents.map(r=>r.slug));
const done=new Set((await fs.readFile(journal,'utf8').catch(()=>'' )).split('\n').filter(Boolean).map(s=>JSON.parse(s)).filter(r=>scope.has(r.slug)&&(r.status==='complete'||r.status==='not_indexed'||(deferEmbeddings&&r.status==='content_synced'))).map(r=>r.slug));
const config=loadConfig();if(!config)throw new Error('Missing GBrain configuration');
configureGateway(buildGatewayConfig(config));
const engine=await createEngine(toEngineConfig(config));
const sourceId=process.env.GBRAIN_SOURCE||'default';
const stats={started_at:now(),mode:deferEmbeddings?'content_only':'complete',total:result.documents.length,processed:done.size,reused:0,embedded:0,pending_embeddings:0,not_indexed:0,errors:[] as any[]};
// One in-flight embedding request, batching across independent pages (up to 32).
const pending:any[]=[];let pumping=false;
async function pump(){
 if(pumping)return;pumping=true;
 try{while(pending.length){const batch=pending.splice(0,32);try{const vectors=await embedBatchWithBackoff(batch.map(x=>x.text));if(vectors.length!==batch.length)throw new Error('Embedding count mismatch');batch.forEach((x,i)=>x.resolve(vectors[i]));}catch(e){batch.forEach(x=>x.reject(e));}}}finally{pumping=false;}
}
const batchedEmbed=(texts:string[])=>Promise.all(texts.map(text=>new Promise<Float32Array>((resolve,reject)=>{pending.push({text,resolve,reject});setTimeout(pump,20);})));
let cursor=0,halt=false;
try{
 await engine.connect(toEngineConfig(config));
 async function worker(){while(cursor<result.documents.length&&!halt){
  const record=result.documents[cursor++];
  if(done.has(record.slug))continue;
  try{
   const file=dataPath('wiki',record.slug+'.md'),text=await fs.readFile(file,'utf8');
   if(sha(text)!==record.after_sha256)throw new Error('Wiki changed since cleanup');
   const page=await engine.getPage(record.slug,{sourceId});
   const old=page?await engine.getChunks(record.slug,{sourceId,includeEmbedding:true}):[];
   if(!page){stats.not_indexed++;stats.processed++;await fs.appendFile(journal,JSON.stringify({slug:record.slug,status:'not_indexed'})+'\n');continue;}
   // importFromContent creates a native page version before replacing stored content.
   await importFromContent(engine,record.slug,text,{sourceId,noEmbed:true,sourcePath:file});
   matter.clearCache();
   const current=await engine.getChunks(record.slug,{sourceId});
   const byText=new Map(old.filter(c=>c.embedding).map(c=>[c.chunk_source+'\0'+c.chunk_text,c]));
   let reused=0;
   const merged=current.map(c=>{
     const hit=byText.get(c.chunk_source+'\0'+c.chunk_text);
     if(!hit)return c;
     reused++;return {...c,embedding:hit.embedding,model:hit.model,embedded_at:hit.embedded_at,embedded_text_hash:hit.embedded_text_hash,token_count:hit.token_count};
   });
   if(reused)await engine.upsertChunks(record.slug,merged,{sourceId});
   const embedded=deferEmbeddings?{embedded:0}:await embedStalePages(engine,[record.slug],sourceId,{embedFn:batchedEmbed});
   const verified=await engine.getChunks(record.slug,{sourceId});
   const missing=verified.filter(c=>c.embedding_is_null).length;
   if(missing&&!deferEmbeddings)throw new Error('Embedding incomplete; resumable');
   if(old.length&& !verified.length)throw new Error('Unexpected loss of all chunks');
   stats.pending_embeddings+=missing;
   stats.reused+=reused;stats.embedded+=embedded.embedded;stats.processed++;
   await fs.appendFile(journal,JSON.stringify({slug:record.slug,status:missing?'content_synced':'complete',reused,embedded:embedded.embedded,chunks:verified.length,pending_embeddings:missing})+'\n');
   if(stats.processed%50===0){console.log(JSON.stringify(stats));await atomicJson(path.join(folder,'gbrain-status.json'),stats);}
  }catch(e:any){halt=true;stats.errors.push({slug:record.slug,error:e.message});await atomicJson(path.join(folder,'gbrain-status.json'),stats);}
 }}
 await Promise.all(Array.from({length:8},()=>worker()));
 if(halt)throw new Error('Index refresh stopped; see gbrain-status.json');
 await atomicJson(path.join(folder,'gbrain-status.json'),{...stats,finished_at:now()});console.log(JSON.stringify(stats));
}finally{await engine.disconnect();}
