import test from 'node:test';
import assert from 'node:assert/strict';
import { compileRegistry, entityMentions } from '../scripts/query/entities.mjs';
import { resolveDocumentMention } from '../scripts/query/entity-context.mjs';
const registry=compileRegistry({version:1,entities:['converter','drug'].map(name=>({entity_id:`entity:${name}`,type:'subfield',name,aliases:[],source:'fixture'})),context_rules:[
  {type:'subfield',alias:'ADC',entity_id:'entity:converter',definitions:['analog-to-digital converter'],source:'fixture'},
  {type:'subfield',alias:'ADC',entity_id:'entity:drug',definitions:['antibody-drug conjugate'],source:'fixture'}]});
const mention=entityMentions({subfields:['ADC']})[0];
const resolve=(text,complete=true)=>resolveDocumentMention(mention,registry,{complete,blocks:[{block_id:'b1',pdf_page:3,text}]});
test('explicit document definition resolves only that document and keeps locator',()=>{
  const r=resolve('Analog-to-digital converter (ADC) converts signals.');
  assert.equal(r.entity.entity_id,'entity:converter');assert.equal(r.evidence[0].block_id,'b1');
  assert.equal(resolve('antibody-drug conjugate（ADC）').entity.entity_id,'entity:drug');
  assert.equal(registry.aliases.has('subfield:adc'),false);
});
test('co-occurrence, multiple meanings and incomplete context never confirm',()=>{
  for(const text of ['ADC and analog-to-digital converter','ADC (analog-to-digital converter); antibody-drug conjugate','ADC']) assert.notEqual(resolve(text).status,'curated');
  assert.notEqual(resolve('ADC (analog-to-digital converter)',false).status,'curated');
});
