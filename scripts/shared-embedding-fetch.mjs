import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {validateEmbeddingInput} from './shared-api-client.mjs';
import {atomicRename} from './atomic-rename.mjs';

const wait=(ms,signal)=>new Promise((resolve,reject)=>{
  signal?.throwIfAborted();
  const abort=()=>{clearTimeout(timer);reject(signal.reason);};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
  signal?.addEventListener('abort',abort,{once:true});
});
function orderedVectors(body,count,dimensions) {
  if(!Array.isArray(body?.data)||body.data.length!==count)throw new Error('共享向量响应数量错误');
  const rows=[...body.data].sort((a,b)=>a.index-b.index);
  if(rows.some((row,i)=>row.index!==i||!Array.isArray(row.embedding)||row.embedding.length!==dimensions||row.embedding.some(x=>!Number.isFinite(x))))throw new Error('共享向量响应索引或维度错误');
  return rows.map(row=>row.embedding);
}

/** Bound retries to one small sub-batch and reuse completed work after a CLI restart. */
export function createSharedEmbeddingFetch({fetchImpl,endpoint,cacheDir,dimensions=1024,batchSize=8,attempts=3,sleep=wait,onRetry=()=>{}}) {
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>32||!Number.isInteger(attempts)||attempts<1||attempts>6)throw new Error('Invalid shared embedding batch/retry limits');
  let queue=Promise.resolve();
  async function batch(input,request) {
    const payload=validateEmbeddingInput({model:'bge-m3',input});
    const key=createHash('sha256').update(JSON.stringify({version:1,endpoint,dimensions,payload})).digest('hex');
    const file=cacheDir?path.join(cacheDir,key+'.json'):null;
    if(file) {
      try {const cached=JSON.parse(await fs.readFile(file,'utf8'));return orderedVectors(cached,input.length,dimensions);}
      catch(error){if(error.code && error.code!=='ENOENT')throw error;}
    }
    for(let attempt=0;attempt<attempts;attempt++) {
      request.signal.throwIfAborted();
      let response;
      try {
        response=await fetchImpl(endpoint,{method:'POST',headers:request.headers,body:JSON.stringify(payload),signal:request.signal,redirect:'error'});
      } catch(error) {
        if(request.signal.aborted||attempt===attempts-1)throw error;
        onRetry({attempt:attempt+1,kind:'network'});
        await sleep(2000*2**attempt,request.signal);continue;
      }
      if(!response.ok) {
        if(![429,502,503,504].includes(response.status)||attempt===attempts-1) {
          if(cacheDir) {
            await fs.mkdir(cacheDir,{recursive:true});
            await fs.writeFile(path.join(cacheDir,'last-failure.json'),JSON.stringify({at:new Date().toISOString(),status:response.status,attempts:attempt+1,payload}));
          }
          return {failure:response};
        }
        const retrySeconds=Number(response.headers.get('retry-after'));
        const delay=Number.isFinite(retrySeconds)&&retrySeconds>0?retrySeconds*1000:2000*2**attempt;
        await response.body?.cancel();onRetry({attempt:attempt+1,status:response.status});
        await sleep(delay,request.signal);continue;
      }
      let vectors;
      try {vectors=orderedVectors(await response.json(),input.length,dimensions);}
      catch(error) {
        if(attempt===attempts-1)return {failure:Response.json({error:{message:error.message}},{status:502})};
        await sleep(2000*2**attempt,request.signal);continue;
      }
      if(file) {
        await fs.mkdir(cacheDir,{recursive:true});
        const temp=file+'.'+randomUUID()+'.tmp';
        try {
          await fs.writeFile(temp,JSON.stringify({data:vectors.map((embedding,index)=>({index,embedding}))}));
          await atomicRename(temp,file);
        } finally {await fs.rm(temp,{force:true});}
      }
      return vectors;
    }
  }
  return async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    if(url!==endpoint)return fetchImpl(input,init);
    const request=new Request(input,init);
    const payload=validateEmbeddingInput(await request.json());
    const run=queue.then(async()=>{
      const vectors=[];
      for(let start=0;start<payload.input.length;start+=batchSize) {
        const part=await batch(payload.input.slice(start,start+batchSize),request);
        if(part.failure)return part.failure;
        vectors.push(...part);
      }
      return Response.json({object:'list',model:'bge-m3',data:vectors.map((embedding,index)=>({object:'embedding',index,embedding}))});
    });
    queue=run.then(()=>undefined,()=>undefined);
    return run;
  };
}
