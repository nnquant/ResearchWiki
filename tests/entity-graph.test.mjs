import test from 'node:test';
import assert from 'node:assert/strict';
import { compileRegistry, entityMentions, resolveMention, normalizeEntityName } from '../scripts/query/entities.mjs';
import { filterSql, validateFilters } from '../scripts/query/contract.mjs';
import { traverse } from '../scripts/query/graph-query.mjs';

const config = { version: 1, entities: [
  { entity_id: 'entity:company:a', type: 'company', name: 'Alpha', aliases: ['阿尔法', '同名公司'], source: 'test' },
  { entity_id: 'entity:company:b', type: 'company', name: 'Beta', aliases: ['同名公司'], source: 'test' },
] };
test('confirmed aliases merge; ambiguous names never attach to an arbitrary entity', () => {
  const registry = compileRegistry(config);
  const items = entityMentions({ companies: [' Ａｌｐｈａ ', '阿尔法', '同名公司', 'Alpha子公司'] }).map(m => resolveMention(m, registry));
  assert.equal(items[0].entity.entity_id, items[1].entity.entity_id);
  assert.equal(items[2].entity, null); assert.equal(items[2].status, 'ambiguous'); assert.equal(items[2].candidates.length, 2);
  assert.equal(items[3].status, 'observed'); assert.notEqual(items[3].entity.entity_id, items[0].entity.entity_id);
});
test('normalization preserves punctuation, ticker leading zeroes, concept boundaries and raw labels', () => {
  assert.notEqual(normalizeEntityName('00700.HK'), normalizeEntityName('700.HK'));
  assert.notEqual(normalizeEntityName('A-B'), normalizeEntityName('AB'));
  const registry = compileRegistry({ version: 1, entities: [] });
  const raw = '公司：  Ａｌｐｈａ  ';
  const mentions = entityMentions({ tags: [raw, '领域:AI', '领域:生成式AI', '普通主题'] });
  assert.equal(mentions[0].raw, raw); assert.equal(mentions.length, 3);
  assert.equal(mentions[0].normalized, 'alpha');
  assert.notEqual(resolveMention(mentions[1], registry).entity.entity_id, resolveMention(mentions[2], registry).entity.entity_id);
});
test('issuer and security identities remain separate; configuration validates references', () => {
  const company = config.entities[0];
  const security = { entity_id: 'entity:security:a', type: 'security', name: 'A股票', market: 'HK', code: '00700', issuer_id: company.entity_id, aliases: [], source: 'test' };
  const r = compileRegistry({ version: 1, entities: [company, security] });
  assert.equal(r.aliases.get('security:hk:00700').values().next().value, security.entity_id);
  assert.throws(() => compileRegistry({ version: 1, entities: [security] }), /issuer_id/);
  assert.throws(() => compileRegistry({ version: 1, entities: [company, company] }), /重复/);
  assert.throws(() => compileRegistry({ version: 1, entities: [{ ...security, code: 700 }] }), /字符串/);
});
test('entity filters use bound membership queries for intersections, exclusions and presence', () => {
  for (const op of ['contains_all', 'contains_any', 'contains_none', 'eq', 'exists']) {
    const params = [], value = op === 'exists' ? false : op === 'eq' ? "entity:a';DROP" : ["entity:a';DROP"];
    const sql = filterSql(validateFilters({ field: 'entity_ids', op, value }), params);
    assert.match(sql, /document_entities/); assert.match(sql, /revision_id/); assert.ok(!sql.includes('DROP'));
    if (op === 'contains_all') assert.match(sql, /unnest/);
  }
});
test('bounded traversal deduplicates cycles, reports caps and validates relationship names', async () => {
  const a = { id: 'a', kind: 'document' }, b = { id: 'b', kind: 'tag' }, c = { id: 'c', kind: 'document' };
  const ab = { source: a, target: b, relation_type: 'has_tag' }, cb = { source: c, target: b, relation_type: 'has_tag' };
  let calls = 0;
  const run = async () => ++calls === 1 ? [ab] : [ab, cb];
  const graph = await traverse(run, a, { depth: 2 }, null);
  assert.equal(graph.results.length, 2); assert.equal(graph.node_count, 3); assert.equal(graph.traversal_truncated, false);
  const capped = await traverse(async () => [ab, cb], a, { max_nodes: 2 }, null);
  assert.equal(capped.results.length, 1); assert.equal(capped.traversal_truncated, true);
  await assert.rejects(traverse(run, a, { depth: 3 }, null));
  await assert.rejects(traverse(run, a, { relation_types: ['invented_causality'] }, null));
});
