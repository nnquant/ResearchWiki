import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFilters, filterSql, tagsFilter, matchesTags, tokenText, tsQuery } from '../scripts/query/contract.mjs';
import { makeBlocks, hash } from '../scripts/query/blocks.mjs';
import { agentTools } from '../scripts/agent/tools.mjs';

test('tag intersection, union and exclusions retain exact original names and leading zeroes', () => {
  const docs = [['代码:00700.HK', '领域:AI'], ['代码:00700.HK', '领域:消费'], ['代码:700.HK', '领域:AI'], ['领域:AI', '排除标签']];
  const filters = { tags_all: ['代码:00700.HK'], tags_any: ['领域:AI', '领域:消费'], tags_none: ['领域:消费'] };
  assert.deepEqual(docs.filter(tags => matchesTags(tags, filters)), [docs[0]]);
  assert.deepEqual(docs.filter(tags => matchesTags(tags, { tags_any: ['领域:AI'], tags_none: ['排除标签'] })), [docs[0], docs[2]]);
});
test('filter grammar rejects unknown fields, invalid operators, malformed dates and empty groups', () => {
  for (const f of [{ field: 'sql', op: 'eq', value: 'x' }, { field: 'tags', op: 'gte', value: 'x' }, { field: 'published_at', op: 'eq', value: '2026-02-30' }, { all: [] }, { any: [null] }, { field: 'tags', op: 'contains_all', value: [] }, { field: 'status', op: 'eq', value: 'x', ignore: true }]) assert.throws(() => validateFilters(f));
  assert.ok(validateFilters({ not: { field: 'published_at', op: 'exists', value: true } }));
});
test('SQL filtering binds hostile tag values and applies identical nested conditions', () => {
  const tag = "公司:O'Reilly % _ '); DROP TABLE pages; --";
  const filter = validateFilters({ all: [tagsFilter({ tags_all: [tag] }), { any: [{ field: 'published_at', op: 'gte', value: '2026-01-01' }, { field: 'published_at', op: 'exists', value: false }] }] });
  const params = [], sql = filterSql(filter, params);
  assert.ok(!sql.includes(tag)); assert.ok(params.some(x => Array.isArray(x) && x.includes(tag)));
  assert.match(sql, /\?&/); assert.match(sql, / OR /);
});
test('Chinese/English lexical terms preserve useful tokens and escape query syntax', () => {
  const tokens = tokenText('半导体 AI 00700.HK');
  assert.match(tokens, /半导体/); assert.match(tokens, /ai/); assert.match(tokens, /00700/);
  assert.doesNotMatch(tsQuery("a | b & c"), / & /);
});
test('lossless blocks retain exact page offsets, formulae, tables, and Unicode', () => {
  const body = '## PDF 第 1 页\r\n# 研究\n\n| 年份 | 金额 |\n| 2026 | 12 |\n\n$$a=b$$\n' + '研究😀'.repeat(40) + '\n## PDF 第 2 页\n# 风险\n原文';
  const revision = hash(body), blocks = makeBlocks(body, revision, 70);
  assert.equal(blocks.map(x => x.text).join(''), body);
  for (const b of blocks) {
    assert.equal(body.slice(b.start_offset, b.end_offset), b.text);
    assert.ok(b.block_id.startsWith(revision));
    assert.ok(b.pdf_page === 1 || b.pdf_page === 2);
    assert.ok(!/[\uD800-\uDBFF]$/.test(b.text));
  }
  assert.equal(blocks.at(-1).pdf_page, 2);
  assert.equal(makeBlocks('plain web content', hash('x'))[0].pdf_page, null);
});
test('public MCP surface is six read operations with structured contracts', () => {
  assert.deepEqual(agentTools.map(t => t.name), ['research_describe', 'research_resolve', 'research_query', 'research_search', 'research_read', 'research_related']);
  for (const tool of agentTools) { assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.inputSchema.additionalProperties, false); assert.ok(tool.outputSchema.required.includes('results')); }
});
