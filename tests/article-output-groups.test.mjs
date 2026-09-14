import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {runArticleOutputGroups,outputLimitError,mergeArticleGroups} from '../scripts/article-output-groups.mjs';
const fixture=spec=>({metadata:spec.id==='core'?{summary:'Saved summary'}:{},evidence:[]});
async function inFolder(name,fn){const folder=path.resolve('work','output-group-test-'+process.pid+'-'+name);try{await fn(folder);}finally{assert.ok(folder.startsWith(path.resolve('work')+path.sep));await fs.rm(folder,{recursive:true,force:true});}}

test('resuming a service interruption reuses completed groups',()=>inFolder('resume',async folder=>{
  const calls=[];let interrupted=false;
  const run=async spec=>{calls.push(spec.id);if(spec.id==='entities'&&!interrupted){interrupted=true;throw Object.assign(new Error('offline'),{code:'LLM_SERVICE_UNAVAILABLE'});}return {parsed:fixture(spec)};};
  await assert.rejects(runArticleOutputGroups({folder,run,validate:x=>x}),/offline/);
  const result=await runArticleOutputGroups({folder,run,validate:x=>x});
  assert.equal(result.metadata.summary,'Saved summary');assert.equal(calls.filter(id=>id==='core').length,1);assert.equal(calls.filter(id=>id==='entities').length,2);
}));

test('a truncated leaf exhausts a finite branch and is not reissued after restart',()=>inFolder('limit',async folder=>{
  const calls=[];const run=async spec=>{calls.push(spec.id);if(spec.id.startsWith('entities'))throw outputLimitError();return {parsed:fixture(spec)};};
  for(let i=0;i<2;i++)await assert.rejects(runArticleOutputGroups({folder,run,validate:x=>x}),e=>e.code==='ARTICLE_OUTPUT_FAILED');
  assert.deepEqual(calls,['core','entities','entities-companies']);
}));

test('manual pause keeps completed fields and stops before another request',()=>inFolder('pause',async folder=>{
  const calls=[];let paused=false;
  await assert.rejects(runArticleOutputGroups({folder,validate:x=>x,shouldPause:async()=>paused,run:async spec=>{calls.push(spec.id);paused=true;return {parsed:fixture(spec)};}}),e=>e.code==='ARTICLE_PAUSED');
  assert.deepEqual(calls,['core']);assert.equal(JSON.parse(await fs.readFile(path.join(folder,'group-core.json'))).metadata.summary,'Saved summary');
}));

test('programmatic merge preserves forecasts and rejects conflicting target prices',()=>{
  const company={company:'Example',ticker:'EX',evidence:[]};
  const rows=[{metadata:{analyst_expectations:[{...company,rating:{label:'Buy'},target_price:{value:'10'}}]}},{metadata:{analyst_expectations:[{...company,forecasts:[{period:'2027E',value:'1'}]}]}}];
  const merged=mergeArticleGroups(rows).metadata.analyst_expectations;
  assert.equal(merged.length,1);assert.equal(merged[0].rating.label,'Buy');assert.equal(merged[0].forecasts.length,1);
  assert.throws(()=>mergeArticleGroups([...rows,{metadata:{analyst_expectations:[{...company,target_price:{value:'20'}}]}}]),/冲突/);
});
