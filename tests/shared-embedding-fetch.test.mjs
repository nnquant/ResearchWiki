import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createSharedEmbeddingFetch} from '../scripts/shared-embedding-fetch.mjs';
const endpoint='https://fixture.invalid/v1/embeddings';
const request=input=>({method:'POST',headers:{'content-type':'application/json',authorization:'Bearer test'},body:JSON.stringify({model:'bge-m3',input})});
const result=values=>Response.json({data:values.map((v,index)=>({index,embedding:[Number(v),1]})).reverse()});

test('completed sub-batches survive a failed request and restart; order and input stay exact',async()=>{
  const cacheDir=path.resolve('work','embedding-cache-test-'+process.pid);let failure=true;const calls=[],delays=[];
  const options={endpoint,cacheDir,dimensions:2,batchSize:2,attempts:2,sleep:async ms=>delays.push(ms),fetchImpl:async(url,init)=>{
    assert.equal(url,endpoint);assert.equal(init.redirect,'error');
    const input=JSON.parse(init.body).input;calls.push(input);
    return failure&&input.includes('3')?new Response('',{status:503}):result(input);
  }};
  try {
    const first=createSharedEmbeddingFetch(options);
    assert.equal((await first(endpoint,request(['1','2','3','4','5']))).status,503);
    assert.deepEqual(calls,[['1','2'],['3','4'],['3','4']]);
    assert.deepEqual(delays,[2000]);failure=false;calls.length=0;
    const restarted=createSharedEmbeddingFetch(options);
    const body=await (await restarted(endpoint,request(['1','2','3','4','5']))).json();
    assert.deepEqual(calls,[['3','4'],['5']]);
    assert.deepEqual(body.data.map(d=>d.embedding[0]),[1,2,3,4,5]);
  } finally {assert.ok(cacheDir.startsWith(path.resolve('work')+path.sep));await fs.rm(cacheDir,{recursive:true,force:true});}
});

test('authentication rejection is not retried and unrelated hosts are untouched',async()=>{
  let calls=0;
  const fetch=createSharedEmbeddingFetch({endpoint,dimensions:2,fetchImpl:async()=>{calls++;return new Response('',{status:401});}});
  assert.equal((await fetch(endpoint,request(['1']))).status,401);assert.equal(calls,1);
  assert.equal((await fetch('https://other.invalid/health')).status,401);assert.equal(calls,2);
});

test('missing, duplicate or wrong-size vectors never count as success',async()=>{
  for(const data of [[],[{index:0,embedding:[1]}],[{index:0,embedding:[1,1]},{index:0,embedding:[2,1]}]]) {
    let calls=0;
    const fetch=createSharedEmbeddingFetch({endpoint,dimensions:2,attempts:2,sleep:async()=>{},fetchImpl:async()=>{calls++;return Response.json({data});}});
    assert.equal((await fetch(endpoint,request(['1','2']))).status,502);assert.equal(calls,2);
  }
});
