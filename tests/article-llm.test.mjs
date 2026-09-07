import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const testRoot=path.resolve('work','llm-tests-'+process.pid);
process.env.WIKI_DATA_ROOT=testRoot;
const {splitArticle,planArticle,groundedMetadata,analyzeArticle}=await import('../scripts/article-llm.mjs');

test('articles are submitted whole and oversized articles are rejected without chunking',()=>{
  const text='Full article content. '.repeat(30000);
  const plan=planArticle(text,{contextTokens:500000,maxInputTokens:450000});
  assert.equal(plan.mode,'fulltext');
  assert.equal(plan.parts.length,1);
  assert.equal(plan.parts[0].text,text);
  assert.throws(()=>planArticle(text,{contextTokens:32000,maxInputTokens:8000}),/未截断或分段/);
});

test('LLM segments cover the full document without omissions or duplicate text',()=>{
  const text='## PDF 第 1 页\n\n'+('First page text. '.repeat(120))+'\n\n## PDF 第 2 页\n\n'+('第二页正文'.repeat(500));
  const parts=splitArticle(text,1000);
  assert.ok(parts.length>2);
  assert.equal(parts.map(p=>p.text).join(''),text);
  for(let i=1;i<parts.length;i++)assert.equal(parts[i].start,parts[i-1].end);
  assert.ok(parts.some(p=>p.start_page===2));
});

test('LLM fields require real source quotations and matching PDF pages; ratings and verification are protected',()=>{
  const text='## PDF 第 1 页\n\nAlice Smith at Example University.\n\n## PDF 第 2 页\n\nThe linear model predicts conditional returns.\n';
  const result=groundedMetadata({metadata:{authors:['Alice Smith'],institutions:['Invented'],methods:['线性模型'],personal_rating:5,review_status:'verified',sample_start:'2026-02-30'},evidence:[
    {field:'authors',quote:'Alice Smith at Example University.',page:1},
    {field:'institutions',quote:'This quote does not exist.',page:1},
    {field:'methods',quote:'The linear model predicts conditional returns.',page:1},
  ]},text);
  assert.deepEqual(result.metadata.authors,['Alice Smith']);
  for(const key of ['institutions','methods','personal_rating','review_status','sample_start'])assert.equal(result.metadata[key],undefined);
  const valid=groundedMetadata({metadata:{methods:['线性模型']},evidence:[{field:'methods',quote:'The linear model predicts conditional returns.',page:2}]},text);
  assert.deepEqual(valid.metadata.methods,['线性模型']);
});

test('partial source dates cannot become invented first-of-month or first-of-year dates',()=>{
  for(const quote of ['August 2026','September 2, 2026','2 September 2026','2026年9月2日','2026-09-02']) {
    const partial=quote==='August 2026';
    const value=partial?'2026-08-01':'2026-09-02';
    const result=groundedMetadata({metadata:{published_at:value},evidence:[{field:'published_at',quote}]},quote);
    assert.equal(result.metadata.published_at,partial?undefined:value);
  }
});

test('source quotations match visible inline footnotes emitted by MinerU',()=>{
  const quote='Ping He†, Shuo Liu‡, Shengxing Zhang§';
  const result=groundedMetadata({metadata:{authors:['Ping He','Shuo Liu','Shengxing Zhang']},evidence:[{field:'authors',quote,page:1}]},'## PDF 第 1 页\n\nPing He<sup>†</sup>, Shuo Liu<sup>‡</sup>, Shengxing Zhang<sup>§</sup>');
  assert.equal(result.metadata.authors.length,3);
});

test('truncated LLM output retries with a larger budget and caches successful full reading',async()=>{
  await fs.mkdir(path.join(testRoot,'runtime'),{recursive:true});
  await fs.writeFile(path.join(testRoot,'runtime/article-llm.json'),JSON.stringify({enabled:true,baseUrl:'https://llm-fixture.invalid/v1',model:'fixture',apiKey:'test-only',maxOutputTokens:2000}));
  const originalFetch=globalThis.fetch,requests=[];
  const text='## PDF 第 1 页\n\nAlice Smith at Example University.\n';
  globalThis.fetch=async(_url,options)=>{
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({choices:[{finish_reason:requests.length===1?'length':'stop',message:{content:requests.length===1?'{':JSON.stringify({metadata:{authors:['Alice Smith']},evidence:[{field:'authors',quote:'Alice Smith at Example University.',page:1}]})}}],usage:{total_tokens:10}}),{status:200});
  };
  try {
    const result=await analyzeArticle({id:'fixture',revision:'revision',title:'Test article'},text);
    assert.deepEqual(result.metadata.authors,['Alice Smith']);
    assert.equal(result.mode,'fulltext');
    assert.equal(result.segments,1);
    for(const request of requests)assert.ok(request.messages[1].content.includes(text));
    assert.deepEqual(requests.map(r=>r.max_tokens),[2000,4000]);
    await analyzeArticle({id:'fixture',revision:'revision',title:'Test article'},text);
    assert.equal(requests.length,2);
  } finally {
    globalThis.fetch=originalFetch;
    assert.ok(testRoot.startsWith(path.resolve('work')+path.sep));
    await fs.rm(testRoot,{recursive:true,force:true});
  }
});
