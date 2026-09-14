import test from 'node:test';
import assert from 'node:assert/strict';
import { metadataFor } from '../scripts/query/index.mjs';
import { queryProfile } from '../scripts/query/profile.mjs';
import { FIELDS } from '../scripts/query/contract.mjs';
import registry from '../config/query-fields.json' with { type: 'json' };

test('field contract is loaded from the shared registry',()=>assert.deepEqual(FIELDS,registry));
test('quant entities retain their types and explicit research relations',()=>{
  for(const type of ['factor','strategy','experiment','dataset','hypothesis']) {
    const result=metadataFor({type,tags:['频率:日度','代码:000001'],uses_dataset:['[[datasets/prices|价格]]'],published_at:'2026-09-14'},{},type+'/fixture');
    assert.equal(result.page_type,type);assert.equal(result.research_category,type);
    assert.deepEqual(result.tags,['频率:日度','代码:000001']);assert.deepEqual(result.relations.uses_dataset,['datasets/prices']);
    assert.equal(result.published_at,'2026-09-14');
  }
});
test('investment inference is an explicit profile adapter, not a dependency of the quant core',()=>{
  const result=metadataFor({type:'source',title:'半导体行业研究',companies:['示例公司'],industries:['半导体'],subfields:['DRAM'],tags:['人工标签'],analyst_expectations:[{ticker:'000001'}]},{});
  if(queryProfile.name==='investment') {
    assert.equal(queryProfile.webTypeField,'research_category');assert.equal(result.research_category,'industry');
    assert.ok(result.tags.includes('领域:DRAM'));assert.ok(result.tags.includes('公司:示例公司'));assert.deepEqual(result.tickers,['000001']);
  } else {
    assert.equal(queryProfile.name,'quant');assert.equal(queryProfile.webTypeField,'page_type');assert.equal(result.research_category,'source');
    assert.deepEqual(result.tags,['人工标签']);assert.deepEqual(result.tickers,[]);
  }
});
