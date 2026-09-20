import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileNames, securityKey } from '../scripts/query/entity-reconciliation.mjs';
import { compileRegistry, resolveMention } from '../scripts/query/entities.mjs';

const company = (id, name, aliases = []) => ({ entity_id: `entity:company:${id}`, type: 'company', name, aliases, source: 'official fixture' });
const alpha = company('alpha', 'Alpha Corporation', ['阿尔法', 'ABC']);
const parent = company('parent', 'Alpha Holdings');
const stock = { entity_id: 'entity:security:us:alpha', type: 'security', name: 'US:ALFA', aliases: [], market: 'US', code: 'ALFA', exchange: 'Nasdaq', issuer_id: alpha.entity_id, source: 'official fixture' };
const hk = { entity_id: 'entity:security:hk:00700', type: 'security', name: 'HK:00700', aliases: [], market: 'HK', code: '00700', source: 'official fixture' };
const master = { entities: [alpha, parent, stock, hk] };
const current = { version: 1, entities: [] }, reviewed = { entities: [] };
const rows = (type, names) => names.map(normalized_name => ({ entity_type: type, normalized_name: normalized_name.toLowerCase(), documents: 1 }));

test('official names and typography map; suffix-only, subsidiaries and acronyms need review', () => {
  const names = rows('company', ['Alpha Corporation', '阿尔法', 'Alpha Corporation.', 'Alpha', 'Alpha Cloud', 'ABC']);
  const r = reconcileNames(names, current, master, reviewed);
  assert.deepEqual(r.decisions.map(d => d.action), ['mapped', 'mapped', 'mapped', 'review', 'review', 'review']);
  assert.equal(r.proposal.entities[0].aliases.includes('ABC'), false);
});

test('company name and security issuer must independently agree, including bare codes', () => {
  const names = rows('company', ['Alpha Corp (ALFA)', 'Alpha (ALFA.O)', 'Alpha (ALFA.N)', 'Alpha Holdings (ALFA)', 'Other (ALFA)', 'Alpha (WRONG)']);
  const r = reconcileNames(names, current, master, reviewed);
  assert.deepEqual(r.decisions.map(d => d.action), ['mapped', 'mapped', 'review', 'review', 'review', 'review']);
  assert.ok(r.decisions.slice(0, 2).every(d => d.entity_id === alpha.entity_id));
});

test('market code normalization never infers market from bare ticker', () => {
  assert.deepEqual(securityKey('700.HK'), { market: 'HK', code: '00700' });
  assert.equal(securityKey('700'), null);
  assert.deepEqual(securityKey('600000.CH'), { market: 'CN', code: '600000' });
  const names = rows('security', ['700.HK', '00700 HK', 'ALFA.O', 'ALFA.N', 'ALFA', '700']);
  const r = reconcileNames(names, current, master, reviewed);
  assert.deepEqual(r.decisions.map(d => d.action), ['mapped', 'mapped', 'mapped', 'review', 'review', 'review']);
  assert.ok(r.proposal.entities.some(e => e.entity_id === alpha.entity_id));
});

test('reviewed crosswalk preserves existing IDs and proposal is repeatable', () => {
  const seed = { ...company('stable', '阿尔法', ['Alpha']), master_ids: [alpha.entity_id] };
  const names = [...rows('company', ['Alpha', 'Alpha (ALFA)', '阿尔法']), ...rows('security', ['ALFA.O']), ...rows('company', ['Alpha (ALFA)(ALFA)'])];
  const r = reconcileNames(names, { version: 1, entities: [seed] }, master, { entities: [seed] });
  assert.ok(r.decisions.slice(0, 3).every(d => d.entity_id === seed.entity_id));
  assert.equal(r.proposal.entities.find(e => e.type === 'security').issuer_id, seed.entity_id);
  assert.deepEqual(reconcileNames(names, r.proposal, master, { entities: [seed] }).proposal, r.proposal);
});

test('shared exact aliases retain ambiguity rather than selecting one identity', () => {
  const shared = { entities: [company('a', 'Company A', ['Shared']), company('b', 'Company B', ['Shared'])] };
  const r = reconcileNames(rows('company', ['Shared']), current, shared, reviewed);
  assert.equal(r.decisions[0].action, 'review');
  assert.equal(r.summary.ambiguous_aliases, 1);
  assert.equal(r.proposal.entities.length, 2);
});

test('new material reuses qualified security formats before any reconciliation job', () => {
  const registry = compileRegistry({version:1,entities:[alpha,stock,hk]});
  for (const name of ['00700 HK','700HK','0700.hk','HK:700']) {
    assert.equal(resolveMention({type:'security',name,normalized:name.toLowerCase()},registry).entity.entity_id,hk.entity_id);
  }
  assert.equal(resolveMention({type:'security',name:'ALFA.OQ',normalized:'alfa.oq'},registry).entity.entity_id,stock.entity_id);
  for (const name of ['700','ALFA','ALFA.N']) assert.equal(resolveMention({type:'security',name,normalized:name.toLowerCase()},registry).status,'observed');
  assert.equal(securityKey('HK:ABC'),null);
  assert.equal(securityKey('TW:123456'),null);
  assert.deepEqual(securityKey('2330TT'),{market:'TW',code:'2330'});
});

test('market formatting retains cross-market identity and dual-counter distinctions', () => {
  const other={...hk,entity_id:'entity:security:hk:80700',name:'HK:80700',code:'80700'};
  const registry=compileRegistry({version:1,entities:[hk,other]});
  assert.notDeepEqual(registry.aliases.get('security:700.hk'),registry.aliases.get('security:80700.hk'));
  const names=rows('security',['700HK','00700 HK','80700.HK']);
  const result=reconcileNames(names,current,{entities:[hk,other]},reviewed);
  assert.deepEqual(result.decisions.map(d=>d.entity_id),[hk.entity_id,hk.entity_id,other.entity_id]);
  assert.deepEqual(reconcileNames(names,result.proposal,{entities:[hk,other]},reviewed).proposal,result.proposal);
});
