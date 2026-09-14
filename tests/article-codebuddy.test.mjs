import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import {decodeCodebuddyOutput,codebuddyFailure,codebuddyCompletion,codebuddyEventError,parseCodebuddyCredits} from '../scripts/article-codebuddy.mjs';
import {serviceFailureKind,probeArticleService} from '../scripts/article-service-recovery.mjs';
import {enrichmentQueue} from '../scripts/article-enrichment-state.mjs';
const model='deepseek-v4.1-flash';
const envelope=()=>[{type:'message',role:'assistant',id:'one',status:'completed',providerData:{model,rawUsage:{credit:0.09}},content:[{type:'output_text',text:'{"ok":true}'}]},{type:'result',subtype:'success',is_error:false,result:'{"ok":true}',usage:{input_tokens:100},session_id:'fixture'}];

test('CLI envelopes preserve real credits and reject model fallback and incomplete results',()=>{
  assert.equal(decodeCodebuddyOutput(JSON.stringify(envelope()),model).usage.codebuddy_credits,0.09);
  const wrong=envelope();wrong[0].providerData.model='different';
  assert.throws(()=>decodeCodebuddyOutput(JSON.stringify(wrong),model),/模型不一致/);
  const partial=envelope();partial[0].status='incomplete';
  assert.throws(()=>decodeCodebuddyOutput(JSON.stringify(partial),model),/未完整结束/);
  const tool=envelope();tool.unshift({type:'function_call'});
  assert.throws(()=>decodeCodebuddyOutput(JSON.stringify(tool),model),/意外调用工具/);
  const unknown=envelope();delete unknown[0].providerData.rawUsage;
  assert.equal(decodeCodebuddyOutput(JSON.stringify(unknown),model).usage.codebuddy_credits,null);
});

test('credit/auth errors stop immediately; temporary failures retry without inference probes',async()=>{
  assert.equal(serviceFailureKind(codebuddyFailure('Insufficient credits')),'fatal');
  assert.equal(serviceFailureKind(codebuddyFailure('Please login')),'fatal');
  assert.equal(serviceFailureKind(codebuddyFailure('unknown CLI option')),'fatal');
  assert.equal(serviceFailureKind(codebuddyFailure('fetch failed ECONNRESET')),'transient');
  assert.equal(serviceFailureKind(codebuddyFailure('429 rate limit')),'transient');
  assert.equal((await probeArticleService({transport:'codebuddy-cli'},{fetchImpl:()=>{throw new Error('Must not call HTTP');}})).kind,'healthy');
});

test('stream length limits and synthetic retry messages are truncation, not model mismatch',()=>{
  assert.equal(codebuddyEventError({type:'stream_event',event:{type:'message_delta',delta:{stop_reason:'max_tokens'}}},model).code,'OUTPUT_LIMIT');
  const synthetic={type:'message',role:'assistant',status:'incomplete',content:[{type:'output_text',text:'Response was truncated due to length limit. Please try again.'}]};
  assert.throws(()=>decodeCodebuddyOutput(JSON.stringify([...envelope(),synthetic]),model),e=>e.code==='OUTPUT_LIMIT');
  assert.equal(codebuddyEventError({type:'stream_event',event:{type:'message_start',message:{model:'another-model'}}},model).code,'CODEBUDDY_CONFIG');
});

test('CLI log credits are scoped to the process and deduplicated by request',()=>{
  const line=(pid,id,n)=>`[pid=${pid}] [SessionManager][credit] Credit received: rootRequestId=${id}, source=raw_model_stream_event, credit=${n}`;
  assert.equal(parseCodebuddyCredits([line(1,'a',1.2),line(1,'a',1.2),line(1,'b',0.3),line(2,'c',100)].join('\n'),1),1.5);
  assert.equal(parseCodebuddyCredits('',1),null);
  assert.equal(parseCodebuddyCredits('[2026/9/11 12:00:00.000] '+line(1,'a',5)+'\n[2026/9/11 13:00:00.000] '+line(1,'b',2),1,Date.parse('2026/9/11 12:30:00')),2);
});

test('a streamed output limit kills the CLI before a follow-up inference',async()=>{
  const dir=path.resolve('work','codebuddy-stream-limit-'+process.pid);let killed=0;
  try {
    const spawnImpl=()=>{
      const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
      child.kill=()=>{killed++;child.emit('close',1);};
      child.stdin.on('finish',()=>{
        child.stdout.write(JSON.stringify({type:'stream_event',event:{type:'message_start',message:{model}}})+'\n');
        child.stdout.write(JSON.stringify({type:'stream_event',event:{type:'message_delta',delta:{stop_reason:'max_tokens'}}})+'\n');
      });return child;
    };
    await assert.rejects(codebuddyCompletion({cliPath:path.resolve('mock-cli.js'),model,cliWorkingDirectory:dir},[{role:'user',content:'synthetic'}],{requestFile:path.join(dir,'request.json'),spawnImpl}),e=>e.code==='OUTPUT_LIMIT');
    assert.equal(killed,1);
    const diagnostics=JSON.parse(await fs.readFile(path.join(dir,(await fs.readdir(dir)).find(n=>n.includes('.cli-'))),'utf8'));
    assert.equal(diagnostics.error_code,'OUTPUT_LIMIT');assert.equal(diagnostics.events.filter(e=>e.event_type==='message_start').length,1);
    assert.equal(diagnostics.usage.codebuddy_credits,null);
  } finally {assert.ok(dir.startsWith(path.resolve('work')+path.sep));await fs.rm(dir,{recursive:true,force:true});}
});

test('long and shell-like document content goes unchanged over stdin; tools, hooks and fallback are disabled',async()=>{
  const dir=path.resolve('work','codebuddy-test-'+process.pid);await fs.mkdir(dir,{recursive:true});
  const doc='`$(do-not-execute) " & | 中文\n'.repeat(4000);
  try {
    let sent='';
    const spawnImpl=(exe,args,options)=>{
      assert.equal(exe,process.execPath);assert.equal(options.shell,false);assert.equal(options.windowsHide,true);
      assert.equal(args[args.indexOf('--tools')+1],'');assert.ok(args.includes('--strict-mcp-config'));
      assert.equal(JSON.parse(args[args.indexOf('--settings')+1]).disableAllHooks,true);
      assert.ok(!args.includes('--fallback-model'));assert.ok(!args.includes(doc));
      const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
      child.stdin.on('data',d=>sent+=d);child.stdin.on('finish',()=>{child.stdout.write(JSON.stringify(envelope()));child.emit('close',0);});return child;
    };
    const result=await codebuddyCompletion({cliPath:path.resolve('mock-cli.js'),model,cliWorkingDirectory:dir},[{role:'system',content:'JSON only'},{role:'user',content:doc}],{requestFile:path.join(dir,'request.json'),spawnImpl});
    assert.equal(sent,doc);assert.equal(result.model,model);assert.equal(await fs.readFile(path.join(dir,'request.system.txt'),'utf8'),'JSON only');
  } finally {assert.ok(dir.startsWith(path.resolve('work')+path.sep));await fs.rm(dir,{recursive:true,force:true});}
});

test('switching to the promotion skips completed and previously failed historical reports',()=>{
  const docs=[{id:'complete',status:'indexed',llm:{status:'complete'}},{id:'failed',revision:'r1'},{id:'new',revision:'r1'}];
  assert.deepEqual(enrichmentQueue(docs,{failed:{status:'failed',model:'old'}},{skipPreviouslyFailed:true},'v2').ready.map(d=>d.id),['new']);
});
