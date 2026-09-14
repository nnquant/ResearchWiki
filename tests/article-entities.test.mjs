import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
const root=path.resolve('work','entity-tests-'+process.pid);
process.env.WIKI_DATA_ROOT=root;
const {groundedMetadata}=await import('../scripts/article-llm.mjs');
const {stageMetadataArticle}=await import('../scripts/enrich-articles.mjs');
const {ENTITY_VERSION,withEntityTags,needsEntityBackfill}=await import('../scripts/article-entities.mjs');
const {filterPageIndex}=await import('../scripts/server/pages-service.mjs');

test('each entity needs its own evidence on the correct source page',()=>{
  const text='## PDF 第 1 页\nNVIDIA demand for GPU and HBM remains strong.\n';
  const checked=groundedMetadata({metadata:{companies:['NVIDIA','Fabricated'],industries:null,subfields:['GPU','HBM','CPU']},evidence:[
    {field:'companies',item:'NVIDIA',quote:'NVIDIA demand for GPU and HBM remains strong.',page:1},
    {field:'subfields',item:'GPU',quote:'NVIDIA demand for GPU and HBM remains strong.',page:1},
    {field:'subfields',item:'HBM',quote:'NVIDIA demand for GPU and HBM remains strong.',page:2},
    {field:'subfields',quote:'NVIDIA demand for GPU and HBM remains strong.',page:1},
  ]},text);
  assert.deepEqual(checked.metadata.companies,['NVIDIA']);
  assert.deepEqual(checked.metadata.subfields,['GPU']);
  assert.equal(checked.discarded.length,3);
});

test('entity tags preserve other tags, replace old entity tags, and support library lookup',()=>{
  const fields=withEntityTags({tags:['研报','公司:Old','领域:CPU'],companies:['New'],industries:['半导体'],subfields:['GPU']},{companies:['Old'],subfields:['CPU']});
  assert.deepEqual(fields.tags,['研报','公司:New','行业:半导体','领域:GPU']);
  const page={slug:'sources/test',title:'报告',type:'source',tags:fields.tags};
  assert.equal(filterPageIndex([page],{tag:'领域:GPU'}).total,1);
  assert.equal(filterPageIndex([page],{q:'GPU'}).total,1);
  assert.equal(needsEntityBackfill({llm:{status:'complete'}}),true);
  assert.equal(needsEntityBackfill({llm:{status:'complete',entity_version:ENTITY_VERSION}}),false);
});

test('backfill only changes entities and derived tags, retaining summary, findings and full original body',async()=>{
  await fs.mkdir(path.join(root,'wiki','sources'),{recursive:true});
  await fs.mkdir(path.join(root,'parsed'),{recursive:true});
  const body='## PDF 第 1 页\nNVIDIA demand for GPU and HBM remains strong.\n';
  await fs.writeFile(path.join(root,'parsed','doc.md'),body);
  await fs.writeFile(path.join(root,'wiki','sources','doc.md'),matter.stringify(body,{title:'Test',type:'source',summary:'原有摘要',key_findings:['原有结论'],tags:['研报']}));
  const originalFetch=globalThis.fetch;
  const requests=[];
  globalThis.fetch=async(_url,init)=>{
    const req=JSON.parse(init.body);requests.push(req);
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({metadata:{companies:['NVIDIA'],industries:null,subfields:['GPU','HBM','CPU'],summary:'不能覆盖'},evidence:[
      {field:'companies',item:'NVIDIA',quote:'NVIDIA demand for GPU and HBM remains strong.',page:1},
      ...['GPU','HBM'].map(item=>({field:'subfields',item,quote:'NVIDIA demand for GPU and HBM remains strong.',page:1})),
    ]})}}]}));
  };
  try {
    const result=await stageMetadataArticle({id:'doc',revision:'v1',parsed_path:'parsed/doc.md',wiki_slug:'sources/doc',llm:{status:'complete'}},{model:'fixture',baseUrl:'https://fixture.invalid/v1',apiKey:'test'},path.join(root,'staged'));
    assert.equal(requests.length,1);
    assert.ok(requests[0].messages[1].content.includes(body));
    assert.equal(result.metadata.summary,'原有摘要');
    assert.deepEqual(result.metadata.key_findings,['原有结论']);
    assert.deepEqual(result.metadata.subfields,['GPU','HBM']);
    assert.ok(result.metadata.tags.includes('领域:GPU'));
    assert.equal(result.entity_version,ENTITY_VERSION);
    assert.equal(result.entities_only,true);
    assert.equal(result.translation_slug,null);
    assert.equal(matter(await fs.readFile(path.join(root,'staged','doc','wiki','sources','doc.md'),'utf8')).content,body);
  } finally {globalThis.fetch=originalFetch;await fs.rm(root,{recursive:true,force:true});}
});
