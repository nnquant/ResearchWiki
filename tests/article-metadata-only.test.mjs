import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
const root=path.resolve('work','metadata-only-test-'+process.pid);
process.env.WIKI_DATA_ROOT=root;
const {stageMetadataArticle}=await import('../scripts/enrich-articles.mjs');
const {withLock,withIngestPriority}=await import('../scripts/common.mjs');
const {invalidateScan}=await import('../scripts/server/wiki-files.mjs');

test('metadata-only processing submits the entire article once, preserves its body, and creates no translation',async()=>{
  await fs.mkdir(path.join(root,'wiki','sources'),{recursive:true});await fs.mkdir(path.join(root,'parsed'),{recursive:true});
  const text='## PDF 第 1 页\n\nThe report forecasts higher investment in power infrastructure.\n\n## PDF 第 2 页\n\n'+('Additional evidence. '.repeat(2000));
  await fs.writeFile(path.join(root,'parsed','article.md'),text);
  const original='---\ntitle: Test\ntype: source\ntags: [local]\n---\n'+text;
  await fs.writeFile(path.join(root,'wiki','sources','fixture.md'),original);
  const originalFetch=globalThis.fetch,requests=[];
  globalThis.fetch=async(_url,init)=>{requests.push(JSON.parse(init.body));return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({metadata:{companies:null,industries:null,subfields:null,summary:'报告预计电力基础设施投资增加。',tags:['电力'],key_findings:['电力基础设施投资增加']},evidence:['summary','tags','key_findings'].map(field=>({field,quote:'The report forecasts higher investment in power infrastructure.',page:1}))})}}]}));};
  try {
    const staging=path.join(root,'staging');
    const result=await stageMetadataArticle({id:'fixture',title:'Test',revision:'v1',parsed_path:'parsed/article.md',wiki_slug:'sources/fixture'},{model:'fixture',baseUrl:'https://fixture.invalid/v1',apiKey:'test'},staging);
    assert.equal(requests.length,1);assert.ok(requests[0].messages[1].content.includes(text));
    assert.equal(result.translation_mode,'skipped');assert.equal(result.translation_slug,null);
    assert.deepEqual(await fs.readdir(path.join(staging,'fixture','wiki','sources')),['fixture.md']);
    const saved=matter(await fs.readFile(path.join(staging,'fixture','wiki','sources','fixture.md'),'utf8'));
    assert.equal(saved.content,matter(original).content);assert.equal(saved.data.summary,result.metadata.summary);
    // An indexing failure may leave the staged page already written to the wiki.
    // Resume that same stage rather than spending another LLM request.
    await fs.writeFile(path.join(root,'wiki','sources','fixture.md'),await fs.readFile(path.join(staging,'fixture','wiki','sources','fixture.md')));
    const resumed=await stageMetadataArticle({id:'fixture',title:'Test',revision:'v1',parsed_path:'parsed/article.md',wiki_slug:'sources/fixture'},{model:'fixture',baseUrl:'https://fixture.invalid/v1',apiKey:'test'},staging);
    assert.equal(requests.length,1);
    assert.equal(resumed.completed_at,result.completed_at);
    // Enabling strict output must not reuse a legacy staged response, but an
    // already validated strict stage remains reusable after an indexing retry.
    globalThis.fetch=async(_url,init)=>{
      const request=JSON.parse(init.body);requests.push(request);
      assert.equal(request.response_format.type,'json_schema');
      const metadata=Object.fromEntries(Object.keys(request.response_format.json_schema.schema.properties.metadata.properties).map(key=>[key,['companies','industries','subfields'].includes(key)?[]:null]));
      Object.assign(metadata,{summary:'报告预计电力基础设施投资增加。',tags:['电力'],key_findings:['电力基础设施投资增加']});
      return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({metadata,evidence:['summary','tags','key_findings'].map(field=>({field,quote:'The report forecasts higher investment in power infrastructure.',page:1,item:null}))})}}]});
    };
    const record={id:'fixture',title:'Test',revision:'v1',parsed_path:'parsed/article.md',wiki_slug:'sources/fixture'};
    const strictConfig={model:'fixture',baseUrl:'https://fixture.invalid/v1',apiKey:'test',structuredOutputs:'json_schema'};
    const strictResult=await stageMetadataArticle(record,strictConfig,staging);
    assert.equal(requests.length,2);assert.equal(strictResult.output_schema_version,'article-output-schema-v1');
    await stageMetadataArticle(record,strictConfig,staging);
    assert.equal(requests.length,2);
  } finally {globalThis.fetch=originalFetch;await fs.rm(root,{recursive:true,force:true});}
});

test('index priority reserves the next ingest slot without blocking its own owner',async()=>{
  try {
    await withIngestPriority(async()=>{
      let entered=false;await withLock(async()=>{entered=true;});assert.equal(entered,true);
      assert.equal(JSON.parse(await fs.readFile(path.join(root,'state','ingest-priority.json'),'utf8')).pid,process.pid);
    });
    await assert.rejects(fs.access(path.join(root,'state','ingest-priority.json')));
    await fs.writeFile(path.join(root,'state','ingest-priority.json'),JSON.stringify({pid:process.ppid}));
    await assert.rejects(withLock(async()=>{throw new Error('must not enter');}),/已有导入任务占用锁/);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('company expectations backfill preserves the original summary, tags and body',async()=>{
  await fs.mkdir(path.join(root,'wiki','sources'),{recursive:true});await fs.mkdir(path.join(root,'parsed'),{recursive:true});
  const text='## PDF 第 1 页\n\nExample Inc. (EX). Rating: Buy. Price target US$25.';
  await fs.writeFile(path.join(root,'parsed','company.md'),text);
  const original=matter.stringify(text,{title:'Example Inc. (EX)',type:'source',summary:'保留人工确认的摘要',tags:['人工标签'],companies:['Example Inc.'],key_findings:['保留原结论']});
  await fs.writeFile(path.join(root,'wiki','sources','company.md'),original);
  invalidateScan();
  const originalFetch=globalThis.fetch,requests=[];
  globalThis.fetch=async(_url,init)=>{requests.push(JSON.parse(init.body));return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({metadata:{summary:'不应覆盖原摘要',analyst_expectations:[{company:'Example Inc.',evidence:[{quote:'Example Inc. (EX).',page:1}],target_price:{value:'25',currency:'USD',evidence:[{quote:'Rating: Buy. Price target US$25.',page:1}]}}]},evidence:[]})}}]});};
  try {
    const result=await stageMetadataArticle({id:'company',title:'Example Inc. (EX)',revision:'r1',parsed_path:'parsed/company.md',wiki_slug:'sources/company',llm:{status:'complete',entity_version:'article-entities-v1'}},{model:'fixture',baseUrl:'https://fixture.invalid/v1',apiKey:'test'},path.join(root,'staging'));
    assert.equal(result.expectations_only,true);assert.equal(result.supplemental,true);
    assert.equal(requests.length,1);assert.match(requests[0].messages[0].content,/只补抽 analyst_expectations/);
    const saved=matter(await fs.readFile(path.join(root,'staging/company/wiki/sources/company.md'),'utf8'));
    assert.equal(saved.content,matter(original).content);assert.equal(saved.data.summary,'保留人工确认的摘要');
    assert.ok(saved.data.tags.includes('人工标签'));assert.deepEqual(saved.data.key_findings,['保留原结论']);
    assert.equal(saved.data.analyst_expectations[0].target_price.value,'25');
  }finally{globalThis.fetch=originalFetch;await fs.rm(root,{recursive:true,force:true});}
});
