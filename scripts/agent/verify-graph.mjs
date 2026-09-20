import assert from 'node:assert/strict';
import { agentRequest } from './client.mjs';

// Read-only live acceptance. Run after deployment; no material or registry writes.
const checks = [], times = {};
async function call(op, input) { const start = Date.now(); const r = await agentRequest(op, input); times[`${op}_${Object.keys(times).length}`] = Date.now() - start; return r; }
try {
  const caps = await call('describe', {}); assert.ok(caps.results[0].operations.includes('graph')); checks.push('graph_discoverable');
  const a = await call('resolve', { kind: 'entity', q: '英伟达', entity_type: 'company' });
  const b = await call('resolve', { kind: 'entity', q: 'NVIDIA', entity_type: 'company' });
  assert.equal(a.results[0].entity_id, b.results[0].entity_id); assert.equal(a.ambiguous, false); checks.push('cross_language_alias_resolution');
  const id = a.results[0].entity_id;
  const filters = { field: 'entity_ids', op: 'contains_all', value: [id] };
  const docs = await call('query', { filters, fields: ['entity_ids', 'tags'], limit: 2 });
  assert.ok(docs.results.length); assert.ok(docs.results.every(d => d.metadata.entity_ids.includes(id))); checks.push('entity_scope_query');
  const request = { operation: 'neighbors', seed: { kind: 'entity', id }, relation_types: ['has_entity'], max_nodes: 20, max_edges: 20, limit: 1 };
  let graph = await call('graph', request), all = [...graph.results];
  const expected = graph.edge_count, snapshot = graph.graph_snapshot_id;
  if (graph.next_cursor) await assert.rejects(call('graph', { cursor: graph.next_cursor, depth: 2 }), e => e.code === 'CURSOR_MISMATCH');
  while (graph.next_cursor) {
    graph = await call('graph', { cursor: graph.next_cursor, limit: 10 });
    assert.equal(graph.graph_snapshot_id, snapshot); all.push(...graph.results);
  }
  assert.equal(all.length, expected); assert.equal(new Set(all.map(e => JSON.stringify([e.source.id, e.target.id, e.relation_type]))).size, all.length);
  assert.ok(all.every(e => e.target.id === id && e.provenance.revision_id)); checks.push('frozen_pagination_no_duplicates_and_provenance');
  const empty = await call('query', { filters: { all: [filters, { field: 'entity_ids', op: 'contains_none', value: [id] }] } });
  assert.equal(empty.total, 0); checks.push('entity_exclusion');
  const tags = await call('resolve', { kind: 'tag', q: '公司:NVIDIA', limit: 100 });
  const tag = tags.results.find(t => t.tag === '公司:NVIDIA'); assert.ok(tag);
  const shared = await call('graph', { operation: 'intersection', seeds: [{ kind: 'entity', id }, { kind: 'tag', id: tag.tag_id }], limit: 2 });
  assert.ok(shared.total_documents > 0); checks.push('intersection');
  const related = await call('related', { id: docs.results[0].document_id }); assert.ok(Array.isArray(related.results)); checks.push('indexed_explicit_relations');
  console.log(JSON.stringify({ ok: true, checks, covered_materials: docs.total, shared_materials: shared.total_documents, times_ms: times }, null, 2));
} catch (e) { console.error(JSON.stringify({ ok: false, checks, error: e.message, code: e.code })); process.exitCode = 1; }
