import test from 'node:test';
import assert from 'node:assert/strict';
import {articleConcurrency,startArticleBatch} from '../scripts/article-concurrency.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('article concurrency is bounded at sixteen and preserves the serial default',()=>{
  assert.equal(articleConcurrency(),1);
  assert.equal(articleConcurrency('4'),4);
  assert.equal(articleConcurrency('8'),8);
  assert.equal(articleConcurrency('16'),16);
  for(const value of [0,17,-1,1.5,'bad'])assert.throws(()=>articleConcurrency(value),/1–16/);
});

test('sixteen actual extractions overlap without admitting a seventeenth',async()=>{
  const gate=deferred();let active=0,maximum=0;
  const jobs=startArticleBatch(Array.from({length:20},(_,id)=>({id})),{concurrency:16,stage:async()=>{maximum=Math.max(maximum,++active);await gate.promise;active--;return {};}});
  await tick();assert.equal(active,16);assert.equal(maximum,16);assert.equal(jobs.length,16);
  gate.resolve();await Promise.all(jobs.map(job=>job.ready));assert.equal(active,0);
});

test('eight extractions start concurrently without admitting a ninth article',async()=>{
  const records=Array.from({length:10},(_,id)=>({id})),gate=deferred();
  let active=0,maximum=0;const started=[];
  const jobs=startArticleBatch(records,{concurrency:8,stage:async record=>{
    started.push(record.id);maximum=Math.max(maximum,++active);
    await gate.promise;active--;return {id:record.id};
  }});
  await tick();assert.deepEqual(started,[0,1,2,3,4,5,6,7]);assert.equal(active,8);assert.equal(maximum,8);
  gate.resolve();const outcomes=await Promise.all(jobs.map(job=>job.ready));
  assert.equal(active,0);assert.equal(outcomes.length,8);assert.ok(outcomes.every(row=>row.staged));
});

test('four extractions overlap, later records wait, and publication can stay ordered and serial',async()=>{
  const records=Array.from({length:7},(_,id)=>({id}));
  const gates=records.map(deferred),started=[],completed=[];
  let inFlight=0,maximum=0,publishing=0,maxPublishing=0;
  const jobs=startArticleBatch(records,{concurrency:4,stage:async record=>{
    started.push(record.id);maximum=Math.max(maximum,++inFlight);
    await gates[record.id].promise;
    inFlight--;completed.push(record.id);return {id:record.id};
  }});
  await tick();
  assert.deepEqual(started,[0,1,2,3]);assert.equal(maximum,4);assert.equal(jobs.length,4);
  for(const id of [3,2,1,0]){gates[id].resolve();await tick();}
  assert.deepEqual(completed,[3,2,1,0]);
  const published=[];
  for(const job of jobs){const outcome=await job.ready;maxPublishing=Math.max(maxPublishing,++publishing);await tick();published.push(outcome.staged.id);publishing--;}
  assert.deepEqual(published,[0,1,2,3]);assert.equal(maxPublishing,1);
  assert.equal(inFlight,0);assert.deepEqual(started,[0,1,2,3]);
});

test('one failed extraction does not lose other completed artifacts and all started jobs drain',async()=>{
  const gates=[deferred(),deferred(),deferred(),deferred()],errors=[];
  const jobs=startArticleBatch([0,1,2,3].map(id=>({id})),{concurrency:4,
    stage:record=>gates[record.id].promise,onError:async(error,record)=>errors.push({id:record.id,code:error.code})});
  await tick();
  gates[2].reject(Object.assign(new Error('No credits'),{code:'CODEBUDDY_BALANCE'}));
  gates[0].resolve({cache:'saved-0'});gates[3].resolve({cache:'saved-3'});
  let drained=false;const drain=Promise.all(jobs.map(job=>job.ready)).then(result=>{drained=true;return result;});
  await tick();assert.equal(drained,false);
  gates[1].resolve({cache:'saved-1'});
  const result=await drain;
  assert.deepEqual(errors,[{id:2,code:'CODEBUDDY_BALANCE'}]);
  assert.equal(result[2].error.code,'CODEBUDDY_BALANCE');
  assert.deepEqual(result.filter(row=>row.staged).map(row=>row.staged.cache),['saved-0','saved-1','saved-3']);
});

test('a pause prevents new extraction calls and retains resumable outcomes for every selected record',async()=>{
  let starts=0,calls=0;
  const jobs=startArticleBatch([0,1,2,3].map(id=>({id})),{concurrency:4,shouldPause:async()=>true,
    onStart:async()=>{starts++;},stage:async()=>{calls++;}});
  const outcomes=await Promise.all(jobs.map(job=>job.ready));
  assert.equal(starts,0);assert.equal(calls,0);assert.equal(outcomes.length,4);
  assert.ok(outcomes.every(row=>row.error.code==='ARTICLE_PAUSED'));
});
