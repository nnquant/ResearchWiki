import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceFailureKind,serviceErrorDetails,serviceRecoveryState,probeArticleService,waitForArticleService} from '../scripts/article-service-recovery.mjs';
const cfg={baseUrl:'https://local-fixture.invalid/v1',model:'local-flash',apiKey:'private-fixture-key'};

test('transport errors and transient HTTP failures recover; credentials, balance and content errors do not',()=>{
  for(const httpStatus of [408,429,500,502,503,504])assert.equal(serviceFailureKind({httpStatus}),'transient');
  for(const httpStatus of [401,402,403])assert.equal(serviceFailureKind({httpStatus}),'fatal');
  const error=new TypeError('fetch failed',{cause:Object.assign(new Error('socket closed'),{code:'ECONNRESET',syscall:'read'})});
  assert.equal(serviceFailureKind(error),'transient');
  assert.equal(serviceErrorDetails(error).causes[0].code,'ECONNRESET');
  assert.equal(serviceFailureKind(Object.assign(new Error('bad evidence'),{code:'VALIDATION'})),'other');
  assert.equal(serviceFailureKind(new SyntaxError('bad JSON')),'other');
  assert.equal(serviceFailureKind({message:'模型请求失败（HTTP 402）'}),'fatal');
});

test('readiness requires a successful model list containing the exact model, and never submits inference',async()=>{
  const requests=[];
  const fetchImpl=async(url,init)=>{requests.push({url,init});return Response.json({data:[{id:cfg.model}]});};
  assert.equal((await probeArticleService(cfg,{fetchImpl})).kind,'healthy');
  assert.equal(requests[0].url,cfg.baseUrl+'/models');
  assert.equal(requests[0].init.body,undefined);
  assert.equal(requests[0].init.redirect,'error');
  assert.equal((await probeArticleService(cfg,{fetchImpl:async()=>Response.json({data:[{id:'other-model'}]})})).kind,'waiting');
  assert.equal((await probeArticleService(cfg,{fetchImpl:async()=>Response.json({data:null})})).kind,'waiting');
  for(const status of [401,402,403])assert.equal((await probeArticleService(cfg,{fetchImpl:async()=>new Response('',{status})})).kind,'fatal');
});

test('an outage backs off, survives serialization and resumes when the model recovers',async()=>{
  let time=0,checks=0,paused=false,saved;
  const updates=[];
  const common={clock:()=>time,sleep:async ms=>{assert.ok(ms<=1000);time+=ms;}};
  const initial=serviceRecoveryState(cfg,'article-1',1,time,new Error('fetch failed'));
  const first=await waitForArticleService(cfg,initial,{...common,shouldPause:async()=>paused,onUpdate:async state=>{
    saved=JSON.stringify(state);updates.push(state.next_probe_at);if(state.attempt===2)paused=true;
  },probe:async()=>{checks++;return {kind:'waiting',error:new Error('fetch failed')};}});
  assert.equal(first.kind,'paused');assert.equal(checks,1);assert.equal(time,30000);
  assert.deepEqual(updates,[new Date(30000).toISOString(),new Date(90000).toISOString()]);
  const restarted=await waitForArticleService(cfg,JSON.parse(saved),{...common,shouldPause:async()=>false,onUpdate:async()=>{},probe:async()=>{checks++;return {kind:'healthy'};}});
  assert.equal(restarted.kind,'recovered');assert.equal(checks,2);assert.equal(time,90000);
  assert.equal(serviceRecoveryState(cfg,'article-1',100,time).delay_ms,300000);
});

test('user pause wins even when a health response succeeds; fatal responses exit without repeated checks',async()=>{
  let paused=false,calls=0;
  const ready={...serviceRecoveryState(cfg,'article-1',1,0),next_probe_at:new Date(0).toISOString()};
  const common={clock:()=>0,onUpdate:async()=>{}};
  const stopped=await waitForArticleService(cfg,ready,{...common,shouldPause:async()=>paused,probe:async()=>{paused=true;return {kind:'healthy'};}});
  assert.equal(stopped.kind,'paused');
  const fatal=await waitForArticleService(cfg,ready,{...common,shouldPause:async()=>false,probe:async()=>{calls++;return {kind:'fatal',error:Object.assign(new Error('HTTP 402'),{httpStatus:402})};}});
  assert.equal(fatal.kind,'fatal');assert.equal(calls,1);
});
