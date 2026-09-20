import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildTagGraph } from '../scripts/server/tag-graph.mjs';

const root = path.resolve('work', `graph-tests-${process.pid}`);
process.env.WIKI_DATA_ROOT = root;
const { graphInventory, readGraphHeader, graphTagOptions } = await import('../scripts/server/graph-inventory.mjs');
const { buildGraphOverview } = await import('../scripts/server/graph-overview.mjs');
const { invalidateScan } = await import('../scripts/server/wiki-files.mjs');
const { createRouter } = await import('../scripts/server/router.mjs');
const { registerGraphRoutes } = await import('../scripts/server/routes/graph.mjs');
const p = (slug, tags, extra = {}) => ({ slug, title: slug, tags, type: 'source', updated_at: '2026-01-01', ...extra });
const sample = [p('sources/a', ['行业:银行', '公司:甲', '行业:银行']), p('claims/b', ['行业:银行', '反证'], { type: 'claim' }), p('sources/c', ['公司:甲']), p('notes/d', [])];
test.after(async () => { await fs.rm(root, { recursive: true, force: true }); });

test('tags generate deterministic membership edges, never document-to-document semantic claims', () => {
  const graph = buildTagGraph(sample);
  assert.equal(graph.nodes.length, 7);
  assert.equal(graph.edges.length, 5);
  assert.equal(graph.scope.untagged, 1);
  assert.equal(graph.nodes.find(n => n.id === 'tag:行业:银行').count, 2);
  assert.equal(graph.nodes.find(n => n.id === 'sources/a').degree, 2);
  assert.ok(graph.edges.every(e => e.link_type === 'has_tag' && e.link_source === 'tags' && e.target.startsWith('tag:')));
  assert.deepEqual(buildTagGraph([...sample].reverse()), graph);
});

test('all, any, none, category and text filters apply before counts and limits', () => {
  assert.equal(buildTagGraph(sample, { tags_all: ['行业:银行', '公司:甲'] }).scope.pages, 1);
  assert.equal(buildTagGraph(sample, { tags_any: ['行业:银行', '公司:甲'], tags_none: ['反证'] }).scope.pages, 2);
  assert.equal(buildTagGraph(sample, { tags_all: ['不存在'] }).nodes.length, 0);
  assert.equal(buildTagGraph(sample, { tags_all: ['公司:甲'], tags_none: ['公司:甲'] }).scope.pages, 0);
  assert.equal(buildTagGraph(sample, { type: 'claim' }).scope.pages, 1);
  assert.equal(buildTagGraph(sample, { q: '银行', limit: 1 }).scope.pages, 2);
  assert.equal(buildTagGraph([p('source/a', [], { category: 'macro' })], { type: 'macro' }).scope.pages, 1);
});

test('overview aggregates all materials, includes untagged categories, and counts shared coverage once per page', () => {
  const index = [...sample, ...Array.from({ length: 500 }, (_, i) => p(`old/${i}`, ['公司:甲', '行业:银行'], { category: 'industry', updated_at: '2000-01-01' }))];
  const graph = buildGraphOverview(index);
  assert.equal(graph.view, 'overview');
  assert.equal(graph.overview.covered_pages, 504);
  assert.equal(graph.nodes.filter(n => n.kind === 'category').reduce((sum, n) => sum + n.count, 0), 504);
  assert.equal(graph.nodes.find(n => n.tag === '公司:甲').count, 502);
  assert.equal(graph.edges.find(e => e.source === 'category:industry' && e.target === 'tag:公司:甲').weight, 500);
  assert.equal(graph.nodes.some(n => n.kind === 'page'), false);
  assert.equal(graph.scope.untagged, 1);
  assert.equal(graph.truncated, false);
  assert.deepEqual(buildGraphOverview(index).nodes, buildGraphOverview([...index].reverse()).nodes);
  const narrowed = buildGraphOverview(index, { tags_all: ['行业:银行'], tags_none: ['反证'], type: 'industry' });
  assert.equal(narrowed.overview.covered_pages, 500);
  assert.equal(buildGraphOverview(index, { q: '没有此材料' }).nodes.length, 0);
});

test('overview bounds featured tags, preserves long-tail totals and distinguishes source labels from topics', () => {
  const index = Array.from({ length: 5000 }, (_, i) => p(`sources/${i}`, ['local', '研报', '主题', '公司:重复公司', `公司:公司${i}`, `领域:产品${i}`, `行业:细分${i}`]));
  const graph = buildGraphOverview(index);
  assert.equal(graph.scope.tags, 15004);
  assert.equal(graph.overview.singleton_tags, 15000);
  assert.ok(graph.overview.featured_tags <= 24);
  assert.equal(graph.overview.other_tags + graph.overview.featured_tags, graph.scope.tags);
  assert.equal(graph.nodes.some(n => n.tag === 'local'), false);
  assert.equal(graph.nodes.find(n => n.tag === '公司:重复公司').count, 5000);
  assert.ok(graph.nodes.some(n => n.tag === '主题'));
  assert.ok(buildGraphOverview(index, { tags_any: ['公司:公司4999', '主题'] }).nodes.some(n => n.tag === '公司:公司4999'));
  const start = performance.now();
  const large = buildGraphOverview(Array.from({ length: 50000 }, (_, i) => p(`s/${i}`, ['公司:共同公司', '行业:银行', `领域:技术${i % 1000}`])));
  assert.equal(large.overview.covered_pages, 50000);
  assert.ok(large.nodes.length <= 25);
  assert.ok(Buffer.byteLength(JSON.stringify(large)) < 50000);
  console.log(`Overview benchmark: 50,000 documents, ${large.nodes.length} nodes, ${large.edges.length} edges, ${Math.round(performance.now() - start)} ms`);
});

test('large inventory keeps payload and edges bounded; selected rare tags survive hub ranking', () => {
  const index = Array.from({ length: 50000 }, (_, i) => p(`sources/${String(i).padStart(6, '0')}`, ['共同', ...Array.from({ length: 15 }, (_, t) => `领域:${(i + t) % 120}`), ...(i === 0 ? ['罕见'] : [])]));
  const start = performance.now();
  const graph = buildTagGraph(index, { limit: 200 });
  const elapsed = performance.now() - start;
  assert.equal(graph.scope.pages, 50000);
  assert.ok(graph.nodes.length <= 240);
  assert.ok(graph.edges.length <= 2000);
  assert.ok(graph.truncated);
  assert.ok(graph.scope.omitted_links > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(graph)) < 1024 * 1024);
  assert.ok(graph.edges.every(e => graph.nodes.some(n => n.id === e.source) && graph.nodes.some(n => n.id === e.target)));
  const selected = buildTagGraph(index, { tags_any: ['共同', '罕见'] });
  assert.ok(selected.nodes.some(n => n.tag === '罕见'));
  console.log(`Graph benchmark: 50,000 documents, ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${Math.round(elapsed)} ms, ${Math.round(Buffer.byteLength(JSON.stringify(graph)) / 1024)} KiB`);
  const tags = graphTagOptions(index, '罕见');
  assert.deepEqual(tags.tags, [{ tag: '罕见', n: 1 }]);
});

test('inventory reads headers of large documents without DB, follows edits and removals, and bounds tag lookup', async () => {
  const dir = path.join(root, 'wiki', 'sources');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'large.md');
  await fs.writeFile(file, '---\ntitle: 大型材料\ntype: source\nresearch_category: company\ntags: [自定义]\ncompanies: [甲]\n---\n' + '正文'.repeat(3_000_000));
  const header = await readGraphHeader(file);
  assert.equal(header.frontmatter.title, '大型材料');
  invalidateScan();
  const [a, b] = await Promise.all([graphInventory(), graphInventory()]);
  assert.equal(a, b);
  assert.deepEqual(a[0].tags, ['自定义', '公司:甲']);
  assert.equal(a[0].category, 'company');
  assert.ok(a[0].entity_mentions.some(m => m.type === 'company' && m.name === '甲'));
  const router = createRouter(); registerGraphRoutes(router);
  const handler = router.match('GET', '/api/graph/sources/large').handler;
  const input = { params: { wild: 'sources/large' }, url: new URL('http://local/api/graph/sources/large?link_types=has_tag') };
  const local = await handler(input);
  assert.equal(local.view, 'neighborhood');
  assert.equal(local.nodes.find(n => n.id === 'sources/large').title, '大型材料');
  assert.equal(local.edges.length, 2); // Works without a legacy DB index or full-text reads.
  await fs.writeFile(file, '---\ntitle: 更新\ntags: [新标签]\n---\n正文');
  invalidateScan();
  assert.deepEqual((await graphInventory())[0].tags, ['新标签']);
  const changed = await handler(input);
  assert.equal(changed.edges.length, 1);
  assert.ok(changed.nodes.some(n => n.tag === '新标签'));
  await fs.writeFile(path.join(dir, 'bad.md'), '---\ntags: [broken\n---\n');
  invalidateScan();
  assert.equal(buildTagGraph(await graphInventory()).metadata_errors, 1);
  await fs.unlink(file);
  invalidateScan();
  assert.equal((await graphInventory()).some(p => p.slug === 'sources/large'), false);
  assert.equal(graphTagOptions([p('a', Array.from({ length: 1000 }, (_, i) => `tag-${i}`))]).tags.length, 200);
});

test('graph API validates bounds and keeps existing neighborhood route available', async () => {
  const router = createRouter(); registerGraphRoutes(router);
  const handler = router.match('GET', '/api/graph').handler;
  for (const limit of ['0', '201', '1.5', 'NaN']) await assert.rejects(() => handler({ url: new URL(`http://local/api/graph?limit=${limit}`) }), e => e.status === 400);
  const graph = await handler({ url: new URL('http://local/api/graph?tags_all=不存在') });
  assert.equal(graph.scope.pages, 0);
  assert.equal(graph.view, 'materials');
  assert.equal((await handler({ url: new URL('http://local/api/graph') })).view, 'overview');
  assert.equal((await handler({ url: new URL('http://local/api/graph?view=materials') })).view, 'materials');
  await assert.rejects(() => handler({ url: new URL('http://local/api/graph?view=bad') }), e => e.status === 400);
  assert.ok(router.match('GET', '/api/graph/sources/page'));
  assert.ok(router.match('GET', '/api/graph-tags'));
});
