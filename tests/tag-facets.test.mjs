import test from 'node:test';
import assert from 'node:assert/strict';
import { facetTags } from '../scripts/article-entities.mjs';
import { graphTagOptions } from '../scripts/server/tag-options.mjs';
import { filterPageIndex } from '../scripts/server/pages-service.mjs';
import { hasReportDictionaries } from '../scripts/report-dictionaries.mjs';

const page = (slug, tags, fm) => ({ slug, title: slug, type: 'source', tags, facet_tags: facetTags(fm), updated_at: '2026-09-01' });
const index = [
  page('a', ['行业:半导体'], { institutions: ['GoldmanSachs'], authors: ['Michael Snaith'], topic_primary: 'Semis' }),
  page('b', ['公司:宁德时代'], { institutions: ['JPMorgan'], topic_primary: 'Macro' }),
  page('c', ['行业:汽车'], {}),
];

test('facetTags derives 机构/作者/主题 from report identity fields', () => {
  assert.deepEqual(facetTags({ institutions: ['GoldmanSachs', ' '], authors: ['A B'], topic_primary: 'Semis' }), ['机构:GoldmanSachs', '作者:A B', '主题:Semis']);
  assert.deepEqual(facetTags({ topic_primary: null }), []);
});

test('library tag options include facets and match dictionary aliases', { skip: !hasReportDictionaries && 'config/report-dictionaries.json not present' }, () => {
  assert.deepEqual(graphTagOptions(index, '高盛', { facets: true }).tags, [{ tag: '机构:GoldmanSachs', n: 1, label: '高盛' }]);
  assert.deepEqual(graphTagOptions(index, '芯片', { facets: true }).tags.map(t => t.tag), ['主题:Semis']);
  assert.equal(graphTagOptions(index, '高盛').tags.length, 0, 'graph mode keeps plain tags only');
});

test('tag groups cover the whole index regardless of the query', () => {
  const groups = graphTagOptions(index, '行业:', { facets: true }).groups.map(g => g.name).sort();
  assert.deepEqual(groups, ['主题', '作者', '公司', '机构', '行业'].sort());
});

test('library filters and full-text search match facet tags', () => {
  assert.deepEqual(filterPageIndex(index, { tags_all: ['机构:GoldmanSachs'] }).items.map(x => x.slug), ['a']);
  assert.deepEqual(filterPageIndex(index, { tags_none: ['主题:Macro'] }).items.map(x => x.slug).sort(), ['a', 'c']);
  assert.deepEqual(filterPageIndex(index, { q: 'snaith' }).items.map(x => x.slug), ['a']);
});
