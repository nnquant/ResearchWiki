import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { compileRegistry } from '../scripts/query/entities.mjs';
import { createPageGraphIndex, buildPageGraph } from '../scripts/server/page-graph.mjs';

const registry = compileRegistry({ version: 1, entities: [{ entity_id: 'entity:company:nvidia', type: 'company', name: 'NVIDIA', aliases: ['英伟达'], source: 'fixture' }] });
const p = (slug, tags, extra = {}) => ({ slug, title: slug, type: 'source', tags, updated_at: '2026-09-17', ...extra });
const pages = [p('sources/a', ['公司:英伟达', '研报']), p('sources/b', ['公司:NVIDIA']), p('sources/c', ['公司:其他']),
  p('claims/d', [], { relations: { supported_by: ['sources/a'] } })];

test('file-only reports discover shared entities through aliases without legacy links', () => {
  const graph = buildPageGraph(createPageGraphIndex(pages, registry), 'sources/a');
  assert.ok(graph.nodes.some(n => n.id === 'sources/b'));
  assert.ok(!graph.nodes.some(n => n.id === 'sources/c'));
  assert.ok(graph.edges.some(e => e.source === 'sources/a' && e.target === 'entity:company:nvidia' && e.context.includes('英伟达')));
  assert.ok(graph.edges.some(e => e.source === 'sources/b' && e.target === 'entity:company:nvidia' && e.context.includes('NVIDIA')));
  assert.ok(graph.edges.some(e => e.source === 'claims/d' && e.target === 'sources/a' && e.link_type === 'supported_by'));
  assert.ok(!graph.edges.some(e => e.source === 'sources/a' && e.target === 'sources/b'));
  assert.ok(!graph.nodes.some(n => n.title === '研报'));
});

test('one hop, relation filtering and isolated reports retain the center', () => {
  const index = createPageGraphIndex(pages, registry);
  const one = buildPageGraph(index, 'sources/a', { depth: 1 });
  assert.ok(!one.nodes.some(n => n.id === 'sources/b'));
  assert.equal(one.discovery.related_pages, 1);
  const typed = buildPageGraph(index, 'sources/a', { linkTypes: ['supported_by'] });
  assert.equal(typed.edges.length, 1);
  const entity = buildPageGraph(index, 'sources/a', { linkTypes: ['has_entity'] });
  assert.ok(entity.edges.every(e => e.link_type === 'has_entity'));
  assert.equal(buildPageGraph(index, 'missing'), null);
  const isolated = buildPageGraph(createPageGraphIndex([p('sources/empty', [])], registry), 'sources/empty');
  assert.equal(isolated.nodes.length, 1); assert.equal(isolated.edges.length, 0);
});

test('ambiguous aliases remain raw tag membership, never arbitrary confirmed identities', () => {
  const ambiguous = compileRegistry({ version: 1, entities: ['one', 'two'].map(id => ({ entity_id: `entity:company:${id}`, type: 'company', name: id, aliases: ['同名'], source: 'fixture' })) });
  const graph = buildPageGraph(createPageGraphIndex([p('sources/a', ['公司:同名']), p('sources/b', ['公司:同名'])], ambiguous), 'sources/a');
  assert.ok(graph.nodes.some(n => n.id === 'sources/b'));
  assert.equal(graph.nodes.some(n => n.kind === 'entity'), false);
});

test('large libraries use bounded neighborhoods, preserve edge endpoints and metadata changes', () => {
  const data = Array.from({ length: 20000 }, (_, i) => p(`sources/${i}`, ['公司:NVIDIA', '共同主题', `领域:${i % 1000}`]));
  const start = performance.now(), index = createPageGraphIndex(data, registry);
  const ready = performance.now(), graph = buildPageGraph(index, 'sources/0');
  assert.ok(graph.nodes.length <= 83); assert.ok(graph.edges.length <= 1000); assert.ok(graph.truncated);
  assert.equal(graph.discovery.related_pages, 19999);
  const ids = new Set(graph.nodes.map(n => n.id));
  assert.ok(graph.edges.every(e => ids.has(e.source) && ids.has(e.target)));
  assert.ok(Buffer.byteLength(JSON.stringify(graph)) < 200000);
  const small = buildPageGraph(index, 'sources/0', { limit: 4 });
  assert.ok(small.nodes.length <= 4); assert.ok(small.truncated);
  assert.equal(buildPageGraph(createPageGraphIndex([p('sources/0', [])], registry), 'sources/0').edges.length, 0);
  console.log(`Page graph: 20k materials, build ${Math.round(ready - start)} ms, query ${Math.round(performance.now() - ready)} ms, ${graph.nodes.length} nodes`);
});
