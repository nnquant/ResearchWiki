import test from 'node:test';
import assert from 'node:assert/strict';
import { compileRegistry } from '../scripts/query/entities.mjs';
import { businessRelations } from '../scripts/query/entity-relations.mjs';
const company={entity_id:'entity:a',type:'company',name:'Alpha',aliases:[],source:'https://example.com/a'};
const security={entity_id:'entity:s',type:'security',name:'Alpha HK',aliases:[],source:'https://example.com/list',market:'HK',code:'00001',issuer_id:company.entity_id};
const registry=compileRegistry({version:1,entities:[company,security]});
test('issuer source snapshots keep time unknown unless a source date exists',()=>{
  assert.equal(businessRelations(registry).length,0);
  const [r]=businessRelations(registry,{sources:[{url:security.source,retrieved_at:'2026-09-18T00:00:00Z',sha256:'fixture'}]});
  assert.equal(r.observed_at,'2026-09-18');assert.equal(r.valid_from,null);assert.equal(r.relation_type,'issued_by');
});
test('manual relations require source, literal evidence, compatible entities and ordered dates',()=>{
  const r={source_id:security.entity_id,target_id:company.entity_id,relation_type:'issued_by',source:'https://example.com/list',observed_at:'2026-09-18',valid_from:'2026-01-01',evidence:{quote:'Alpha issued security 00001'}};
  assert.equal(businessRelations(registry,{relations:[r]}).length,1);
  for(const change of [{source:'javascript:alert(1)'},{evidence:{}},{valid_to:'2025-01-01'},{observed_at:'2026-02-30'},{relation_type:'supplies_to'}])
    assert.throws(()=>businessRelations(registry,{relations:[{...r,...change}]}));
});
