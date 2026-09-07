import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const testRoot=path.resolve('work','fulltext-tests-'+process.pid);
process.env.WIKI_DATA_ROOT=testRoot;
const {planArticle,analyzeArticle}=await import('../scripts/article-llm.mjs');

test('256K planning uses full text and refuses excess input',()=>{
  const text='English research text. '.repeat(11000);
  const whole=planArticle(text,{chunkChars:24000});
  assert.equal(whole.mode,'fulltext');
  assert.equal(whole.parts.length,1);
  assert.equal(whole.parts[0].text,text);
  assert.throws(()=>planArticle(text.repeat(4)),/未截断或分段/);
  assert.throws(()=>planArticle(text,{contextTokens:32000}),/未截断或分段/);
});

test('full reading preserves text and caches results; context rejection does not split or retry',async()=>{
  await fs.mkdir(path.join(testRoot,'runtime'),{recursive:true});
  await fs.writeFile(path.join(testRoot,'runtime/article-llm.json'),JSON.stringify({enabled:true,baseUrl:'https://llm-fixture.invalid/v1',model:'fixture',apiKey:'test-only',chunkChars:1000}));
  const originalFetch=globalThis.fetch,requests=[];
  const text='Alice Smith at Example University. '.repeat(80);
  let rejectContext=false;
  globalThis.fetch=async(_url,options)=>{
    requests.push(JSON.parse(options.body));
    if(rejectContext){rejectContext=false;return new Response(JSON.stringify({error:{message:'maximum context length exceeded'}}),{status:400});}
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({metadata:{authors:['Alice Smith']},evidence:[{field:'authors',quote:'Alice Smith at Example University.'}]})}}]}),{status:200});
  };
  try {
    const record={id:'full-fixture',revision:'revision',title:'Long article'};
    const whole=await analyzeArticle(record,text);
    assert.equal(whole.mode,'fulltext');
    assert.equal(requests.length,1);
    assert.ok(requests[0].messages[1].content.includes(text));
    await analyzeArticle(record,text);
    assert.equal(requests.length,1);
    requests.length=0;
    rejectContext=true;
    record.id='context-fixture';
    await assert.rejects(()=>analyzeArticle(record,text),/未截断或分段/);
    assert.equal(requests.length,1);
    assert.ok(requests[0].messages[1].content.includes(text));
  } finally {
    globalThis.fetch=originalFetch;
    assert.ok(testRoot.startsWith(path.resolve('work')+path.sep));
    await fs.rm(testRoot,{recursive:true,force:true});
  }
});
