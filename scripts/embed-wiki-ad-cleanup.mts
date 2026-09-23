// Target only NULL vectors on this cleanup's marked pages, in one request at a time.
import fs from 'node:fs/promises';import path from 'node:path';
import {config,root,now,atomicJson} from './common.mjs';
import {createSharedClient,sharedConnection,validateEmbeddingInput} from './shared-api-client.mjs';
import {getSql,closeDb} from './server/db.mjs';
import {wrapChunkTextsForStoredMode} from '../vendor/gbrain/src/core/embedding-context.ts';
const folder=path.resolve('work/wiki-ad-cleanup-20260923'),client=createSharedClient(sharedConnection(config,root));
if(config.embeddingDimensions!==1024||config.embeddingModel!=='ollama:bge-m3')throw new Error('Unexpected embedding configuration');
const sql=await getSql(),stats={started_at:now(),embedded:0,batches:0,phase:'running',errors:[] as any[]};
let batchSize=8;
async function embedInputs(inputs:string[]):Promise<any[]>{
 try{
  const http=await client.request('/v1/embeddings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(validateEmbeddingInput({model:'bge-m3',input:inputs}))});
  if(!http.ok){const detail=(await http.text()).slice(0,1000);if(inputs.length===1)await fs.writeFile(path.join(folder,'embedding-last-failure.json'),JSON.stringify({at:now(),input:inputs[0],status:http.status,detail},null,2));throw new Error('Embedding HTTP '+http.status+': '+detail);}
  const response=await http.json();
  if(response.data?.length!==inputs.length)throw new Error('Embedding response count mismatch');
  return inputs.map((_,i)=>response.data.find(v=>v.index===i)?.embedding);
 }catch(e:any){
  if(!/HTTP 502/.test(e.message)||inputs.length===1)throw e;
  const half=Math.ceil(inputs.length/2);batchSize=Math.min(batchSize,half);
  return [...await embedInputs(inputs.slice(0,half)),...await embedInputs(inputs.slice(half))];
 }
}
try{
 for(;;){
  const batch=await sql`SELECT c.id,c.chunk_text,c.chunk_source,md5(c.chunk_text) AS hash,p.title,p.contextual_retrieval_mode FROM content_chunks c JOIN pages p ON p.id=c.page_id WHERE p.source_id='default' AND p.deleted_at IS NULL AND p.frontmatter->'wiki_ad_cleanup'->>'version'='wiki-ads-20260923-v1' AND c.embedding IS NULL ORDER BY c.id LIMIT ${batchSize}`;
  if(!batch.length){
   if(process.argv.includes('--follow-projection')&&!await fs.access(path.join(folder,'content-index-ready.json')).then(()=>true,()=>false)){await new Promise(r=>setTimeout(r,1000));continue;}
   break;
  }
  if(batch.some(r=>r.contextual_retrieval_mode==='per_chunk_synopsis'))throw new Error('Synopsis context requires native per-page re-embedding');
  const inputs=batch.map(r=>wrapChunkTextsForStoredMode(r,[r])[0]);
  const vectors=await embedInputs(inputs);
  const entries=batch.map((r,i)=>{
   const vector=vectors[i];
   if(!Array.isArray(vector)||vector.length!==1024||vector.some(v=>!Number.isFinite(v)))throw new Error('Invalid embedding');
   return {id:r.id,hash:r.hash,title:r.title,mode:r.contextual_retrieval_mode,embedding:JSON.stringify(vector),tokens:Math.ceil(inputs[i].length/4)};
  });
  const saved=await sql`UPDATE content_chunks c SET embedding=x.embedding::vector,model='ollama:bge-m3',embedded_at=now(),embedded_text_hash=md5(c.chunk_text),token_count=x.tokens FROM jsonb_to_recordset(${sql.json(entries)}) AS x(id int,hash text,title text,mode text,embedding text,tokens int),pages p WHERE c.id=x.id AND c.page_id=p.id AND c.embedding IS NULL AND md5(c.chunk_text)=x.hash AND p.title=x.title AND p.contextual_retrieval_mode IS NOT DISTINCT FROM x.mode RETURNING c.id`;
  stats.embedded+=saved.length;stats.batches++;
  if(stats.batches%10===0){console.log(JSON.stringify(stats));await atomicJson(path.join(folder,'embedding-status.json'),stats);}
 }
 stats.phase='complete';await atomicJson(path.join(folder,'embedding-status.json'),{...stats,finished_at:now()});console.log(JSON.stringify(stats));
}catch(e:any){stats.phase='failed';stats.errors.push(e.message);await atomicJson(path.join(folder,'embedding-status.json'),stats);throw e;}finally{await closeDb();}
