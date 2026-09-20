import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {loadArticleRuntime,selectArticleRuntime} from '../scripts/article-runtime.mjs';

test('official 16 and local 1 follow both weekday boundaries, request margin and weekends',()=>{
  const settings={official:{model:'official',requestTimeoutMs:600000,offPeakOnly:true},local:{model:'local',offPeakOnly:false}};
  for(const [time,name,count] of [
    ['2026-09-17T08:49:29+08:00','official_off_peak',16],['2026-09-17T08:49:30+08:00','local_peak',1],
    ['2026-09-17T11:59:59+08:00','local_peak',1],['2026-09-17T12:00:00+08:00','official_off_peak',16],
    ['2026-09-17T13:49:30+08:00','local_peak',1],['2026-09-17T18:00:00+08:00','official_off_peak',16],
    ['2026-09-19T10:00:00+08:00','official_off_peak',16]]){
    const selected=selectArticleRuntime(settings,Date.parse(time));assert.equal(selected.name,name,time);assert.equal(selected.concurrency,count,time);
  }
  const inFlight=selectArticleRuntime(settings,Date.parse('2026-09-17T08:00:00+08:00'));
  selectArticleRuntime(settings,Date.parse('2026-09-17T09:00:00+08:00'));
  assert.equal(inFlight.cfg.model,'official'); // A later selection cannot mutate a running group's config.
});

test('loads profile references, enforces official guard, and retains legacy single-provider config',async()=>{
  const dir=await fs.mkdtemp(path.resolve('work/runtime-test-'));
  const write=(name,value)=>fs.writeFile(path.join(dir,name),JSON.stringify(value));
  try{
    await write('official.json',{model:'deepseek-flash',baseUrl:'https://api.deepseek.com',apiKey:'fixture',concurrency:8,offPeakOnly:false});
    await write('local.json',{model:'local',baseUrl:'http://127.0.0.1:4000/v1',apiKey:'fixture',concurrency:1});
    await write('schedule.json',{schedule:{type:'deepseek-peak-switch',officialConfig:'official.json',localConfig:'local.json'}});
    const settings=await loadArticleRuntime(path.join(dir,'schedule.json'));
    assert.equal(settings.official.concurrency,16);assert.equal(settings.official.offPeakOnly,true);assert.equal(settings.local.offPeakOnly,false);
    assert.equal(selectArticleRuntime(await loadArticleRuntime(path.join(dir,'local.json'))).name,'single');
    await write('local.json',{model:'wrong',baseUrl:'https://api.deepseek.com/v1',apiKey:'fixture'});
    await assert.rejects(loadArticleRuntime(path.join(dir,'schedule.json')),/高峰配置/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
