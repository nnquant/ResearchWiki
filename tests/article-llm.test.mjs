import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const testRoot=path.resolve('work','llm-tests-'+process.pid);
process.env.WIKI_DATA_ROOT=testRoot;
const {splitArticle,planArticle,groundedMetadata,analyzeArticle}=await import('../scripts/article-llm.mjs');

test('insufficient balance fails immediately without a second request',async()=>{
  const originalFetch=globalThis.fetch;let requests=0;
  globalThis.fetch=async()=>{requests++;return new Response('Insufficient Balance',{status:402});};
  try {
    await assert.rejects(analyzeArticle({id:'balance-fixture',revision:'revision',title:'Balance test'},'## PDF 第 1 页\n\nOriginal article text.',{config:{enabled:true,model:'fixture',baseUrl:'https://fixture.invalid/v1',apiKey:'test-only'}}),/HTTP 402/);
    assert.equal(requests,1);
  }finally{globalThis.fetch=originalFetch;assert.ok(testRoot.startsWith(path.resolve('work')+path.sep));await fs.rm(testRoot,{recursive:true,force:true});}
});

test('a transport failure preserves its cause and defers retry to service recovery',async()=>{
  const originalFetch=globalThis.fetch;let requests=0;
  globalThis.fetch=async()=>{requests++;throw new TypeError('fetch failed',{cause:Object.assign(new Error('connection timeout'),{code:'UND_ERR_CONNECT_TIMEOUT'})});};
  try {
    await assert.rejects(analyzeArticle({id:'network-fixture',revision:'revision',title:'Network test'},'## PDF 第 1 页\n\nOriginal article text.',{config:{enabled:true,model:'fixture',baseUrl:'https://fixture.invalid/v1',apiKey:'test-only'}}),error=>error.code==='LLM_SERVICE_UNAVAILABLE'&&error.cause.cause.code==='UND_ERR_CONNECT_TIMEOUT');
    assert.equal(requests,1);
  }finally{globalThis.fetch=originalFetch;assert.ok(testRoot.startsWith(path.resolve('work')+path.sep));await fs.rm(testRoot,{recursive:true,force:true});}
});

test('off-peak-only extraction rechecks the pricing window before a validation retry',async()=>{
  const originalFetch=globalThis.fetch,originalNow=Date.now;let requests=0;
  let clock=Date.parse('2026-09-14T08:49:29+08:00');Date.now=()=>clock;
  const text='## PDF 第 1 页\nNVIDIA supplies GPU products.';
  const cfg={baseUrl:'https://fixture.invalid',model:'fixture',apiKey:'test',offPeakOnly:true,requestTimeoutMs:600000};
  const record={id:'off-peak-retry',revision:'r1',title:'NVIDIA'};
  globalThis.fetch=async()=>{
    requests++;
    const companies=requests===1?['NVIDIA']:[{name:'NVIDIA',quote:'NVIDIA supplies GPU products.',page:1}];
    clock=Date.parse(requests===1?'2026-09-14T08:49:30+08:00':'2026-09-14T12:00:01+08:00');
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({metadata:{companies,industries:[],subfields:[]},evidence:[]})}}]}));
  };
  try {
    await assert.rejects(analyzeArticle(record,text,{config:cfg,requireEntities:true}),error=>error.code==='OFF_PEAK_WAIT');
    assert.equal(requests,1);
    clock=Date.parse('2026-09-14T12:00:00+08:00');
    const resumed=await analyzeArticle(record,text,{config:cfg,requireEntities:true});
    assert.equal(requests,2);assert.deepEqual(resumed.metadata.companies,['NVIDIA']);
  }finally{globalThis.fetch=originalFetch;Date.now=originalNow;assert.ok(testRoot.startsWith(path.resolve('work')+path.sep));await fs.rm(testRoot,{recursive:true,force:true});}
});

test('field-group fallback stops at the off-peak cutoff and resumes without repeating the truncated request',async()=>{
  const originalFetch=globalThis.fetch,originalNow=Date.now;let requests=0;
  let clock=Date.parse('2026-09-14T13:49:29+08:00');Date.now=()=>clock;
  const text='## PDF 第 1 页\nNVIDIA supplies GPU products.';
  const cfg={baseUrl:'https://fixture.invalid',model:'fixture',apiKey:'test',offPeakOnly:true,requestTimeoutMs:600000};
  const record={id:'off-peak-groups',revision:'r1',title:'NVIDIA'};
  globalThis.fetch=async()=>{
    requests++;
    if(requests===1){clock=Date.parse('2026-09-14T13:49:30+08:00');return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{'}}]}));}
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({metadata:{summary:'原报告介绍GPU产品。',companies:[{name:'NVIDIA',quote:'NVIDIA supplies GPU products.',page:1}],industries:[],subfields:[],analyst_expectations:[]},evidence:[{field:'summary',quote:'NVIDIA supplies GPU products.',page:1}]})}}]}));
  };
  try {
    await assert.rejects(analyzeArticle(record,text,{config:cfg,requireEntities:true}),error=>error.code==='OFF_PEAK_WAIT');
    assert.equal(requests,1);
    clock=Date.parse('2026-09-14T18:00:00+08:00');
    const resumed=await analyzeArticle(record,text,{config:cfg,requireEntities:true});
    assert.equal(requests,5);assert.equal(resumed.output_mode,'field_groups');
    assert.deepEqual(resumed.metadata.companies,['NVIDIA']);
  }finally{globalThis.fetch=originalFetch;Date.now=originalNow;assert.ok(testRoot.startsWith(path.resolve('work')+path.sep));await fs.rm(testRoot,{recursive:true,force:true});}
});

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

test('entity validation retry gives concrete feedback and accepts attached proof without weakening grounding',async()=>{
  const originalFetch=globalThis.fetch,requests=[];
  const text='## PDF 第 1 页\nNVIDIA supplies GPU products.';
  globalThis.fetch=async(_url,options)=>{
    const req=JSON.parse(options.body);requests.push(req);
    const companies=requests.length===1?['NVIDIA']:[{name:'NVIDIA',quote:'NVIDIA supplies GPU products.',page:1}];
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({metadata:{companies,industries:[],subfields:[]},evidence:[{field:'companies',quote:'NVIDIA supplies GPU products.',page:1}]})}}]}));
  };
  try {
    const result=await analyzeArticle({id:'retry-inline',revision:'r1',title:'NVIDIA'},text,{config:{baseUrl:'https://fixture.invalid',model:'fixture',apiKey:'test'},requireEntities:true});
    assert.equal(requests.length,2);
    assert.match(requests[1].messages.at(-1).content,/companies/);
    assert.match(requests[1].messages.at(-1).content,/name,quote,page/);
    assert.deepEqual(result.metadata.companies,['NVIDIA']);
  } finally {globalThis.fetch=originalFetch;await fs.rm(testRoot,{recursive:true,force:true});}
});

test('evidence tolerates typographic apostrophes but not altered words',()=>{
  const text='## PDF 第 1 页\n\nThe Fed’s inflation mandate remains unchanged.';
  const result=groundedMetadata({metadata:{summary:'通胀目标不变'},evidence:[{field:'summary',quote:"The Fed's inflation mandate remains unchanged.",page:1}]},text);
  assert.equal(result.metadata.summary,'通胀目标不变');
  assert.equal(groundedMetadata({metadata:{summary:'目标改变'},evidence:[{field:'summary',quote:"The Fed's inflation mandate has changed.",page:1}]},text).metadata.summary,undefined);
});

test('truncated output switches to cached field groups without repeating the oversized request',async()=>{
  await fs.mkdir(path.join(testRoot,'runtime'),{recursive:true});
  await fs.writeFile(path.join(testRoot,'runtime/article-llm.json'),JSON.stringify({enabled:true,baseUrl:'https://llm-fixture.invalid/v1',model:'fixture',apiKey:'test-only',maxOutputTokens:2000}));
  const originalFetch=globalThis.fetch,requests=[];
  const text='## PDF 第 1 页\n\nAlice Smith at Example University.\n';
  globalThis.fetch=async(_url,options)=>{
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({choices:[{finish_reason:requests.length===1?'length':'stop',message:{content:requests.length===1?'{':JSON.stringify({metadata:{authors:['Alice Smith'],companies:[],industries:[],subfields:[],analyst_expectations:[]},evidence:[{field:'authors',quote:'Alice Smith at Example University.',page:1}]})}}],usage:{total_tokens:10}}),{status:200});
  };
  try {
    const result=await analyzeArticle({id:'fixture',revision:'revision',title:'Test article'},text);
    assert.deepEqual(result.metadata.authors,['Alice Smith']);
    assert.equal(result.mode,'fulltext');
    assert.equal(result.segments,1);
    for(const request of requests)assert.ok(request.messages[1].content.includes(text));
    assert.equal(result.output_mode,'field_groups');
    assert.equal(requests.length,5);
    assert.equal(requests.filter(r=>!r.messages[0].content.includes('本次执行字段分组')).length,1);
    await analyzeArticle({id:'fixture',revision:'revision',title:'Test article'},text);
    assert.equal(requests.length,5);
    const officialConfig={enabled:true,baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:'test-only',thinking:'disabled'};
    await analyzeArticle({id:'fixture',revision:'revision',title:'Test article'},text,{config:officialConfig});
    assert.deepEqual(requests.at(-1).thinking,{type:'disabled'});
    assert.equal(requests.at(-1).chat_template_kwargs,undefined);
    await analyzeArticle({id:'fixture',revision:'revision',title:'Test article'},text,{config:{...officialConfig,thinking:'enabled',reasoningEffort:'high'}});
    assert.equal(requests.length,7,'different thinking modes must not share cached results');
    assert.deepEqual(requests.at(-1).thinking,{type:'enabled'});
    assert.equal(requests.at(-1).reasoning_effort,'high');
  } finally {
    globalThis.fetch=originalFetch;
    assert.ok(testRoot.startsWith(path.resolve('work')+path.sep));
    await fs.rm(testRoot,{recursive:true,force:true});
  }
});
