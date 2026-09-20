import test from 'node:test';
import assert from 'node:assert/strict';
import {articleOutputSchema,validateOutputSchema,schemaResponseFormat} from '../scripts/article-output-schema.mjs';
import {serviceFailureKind} from '../scripts/article-service-recovery.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {analyzeArticle} from '../scripts/article-llm.mjs';
test('output schema fixes evidence nesting, types and entity proofs',()=>{
  const schema=articleOutputSchema({fields:['summary','companies']});
  const value={metadata:{summary:'摘要',companies:[{name:'ACME',quote:'ACME supplies equipment.',page:1}]},evidence:[{field:'summary',quote:'ACME supplies equipment.',page:1,item:null}]};
  assert.equal(validateOutputSchema(value,schema),value);
  assert.throws(()=>validateOutputSchema({...value,metadata:{...value.metadata,evidence:[]}},schema),/schema/);
  assert.throws(()=>validateOutputSchema({...value,metadata:{...value.metadata,companies:['ACME']}},schema),/schema/);
  assert.throws(()=>validateOutputSchema({...value,extra:1},schema),/schema/);
  assert.throws(()=>validateOutputSchema({...value,evidence:[{field:'summary',quote:'a',page:'1',item:null}]},schema),/schema/);
  assert.equal(schemaResponseFormat(schema).json_schema.strict,true);
});
test('field groups forbid unrelated fields, while nullable unknowns remain valid',()=>{
  for(const groupId of ['ratings','forecasts','forecasts-profit','expectation-context','expectation-notes']){
    const s=articleOutputSchema({fields:['analyst_expectations'],groupId});
    assert.doesNotThrow(()=>validateOutputSchema({metadata:{analyst_expectations:[]},evidence:[]},s));
    if(groupId.startsWith('forecasts'))assert.equal(s.$defs.expectation.properties.rating,undefined);
    else assert.equal(s.$defs.expectation.properties.forecasts,undefined);
  }
  assert.equal(serviceFailureKind({code:'STRUCTURED_OUTPUT_CONFIG'}),'fatal');
});

test('extraction sends the schema on the wire and treats rejected schemas as fatal without fallback',async()=>{
  const dir=await fs.mkdtemp(path.resolve('work/schema-wire-test-'));
  const original=globalThis.fetch;let calls=0;
  const quote='NVIDIA supplies GPU products.';
  const cfg={enabled:true,model:'fixture',baseUrl:'http://test.invalid/v1',apiKey:'fixture',structuredOutputs:'json_schema'};
  try{
    globalThis.fetch=async(url,init)=>{
      calls++;const body=JSON.parse(init.body);assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.strict,true);
      const s=body.response_format.json_schema.schema;
      const metadata=Object.fromEntries(Object.keys(s.properties.metadata.properties).map(k=>[k,['companies','industries','subfields'].includes(k)?[]:null]));metadata.summary='英伟达供应 GPU 产品。';
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({metadata,evidence:[{field:'summary',quote,page:1,item:null}]})}}]}),{headers:{'content-type':'application/json'}});
    };
    const result=await analyzeArticle({id:'fixture',revision:'r1',title:'Fixture'},'## PDF 第 1 页\n'+quote,{config:cfg,cacheRoot:dir,requiredFields:['summary']});
    assert.equal(result.status,'complete');assert.equal(calls,1);
    globalThis.fetch=async()=>{calls++;return new Response('Grammar error',{status:400});};
    await assert.rejects(analyzeArticle({id:'unsupported',revision:'r1',title:'Fixture'},'## PDF 第 1 页\n'+quote,{config:cfg,cacheRoot:dir}),e=>e.code==='STRUCTURED_OUTPUT_CONFIG');
    assert.equal(calls,2);
  }finally{globalThis.fetch=original;await fs.rm(dir,{recursive:true,force:true});}
});
