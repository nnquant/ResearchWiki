import { graphScope } from './tag-graph.mjs';
import { TYPE_LABELS } from './slugs.mjs';

const GROUPS = [
  { key: 'company', label: '公司' }, { key: 'industry', label: '行业' },
  { key: 'field', label: '领域' }, { key: 'topic', label: '主题' },
];
const tagGroup = tag => tag.startsWith('公司:') ? 'company' : tag.startsWith('行业:') ? 'industry' : tag.startsWith('领域:') ? 'field' : 'topic';
// Source / format labels are retained in inventory counts and searchable, but are not research topics.
const SOURCE_TAGS = new Set(['local', '研报', '论文', '网页', 'pdf', 'PDF']);

/** Aggregate EVERY matching material. No article sampling and no document-pair expansion. */
export function buildGraphOverview(index, filters = {}) {
  const scope = graphScope(index, filters);
  const types = new Map(), categories = new Map(), counts = new Map();
  for (const p of index) types.set(p.category ?? p.type, (types.get(p.category ?? p.type) ?? 0) + 1);
  for (const p of scope) {
    const category = p.category ?? p.type;
    categories.set(category, (categories.get(category) ?? 0) + 1);
    for (const tag of new Set(p.tags ?? [])) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const selectedTags = new Set([...(filters.tags_all ?? []), ...(filters.tags_any ?? [])]);
  const compare = ([a, an], [b, bn]) => Number(selectedTags.has(b)) - Number(selectedTags.has(a)) || bn - an || a.localeCompare(b);
  const groupStats = GROUPS.map(group => ({ ...group, distinct: 0, singletons: 0, featured: [] }));
  const byGroup = new Map(groupStats.map(group => [group.key, group]));
  // Maintain only six candidates per group; avoid sorting tens of thousands of long-tail names.
  for (const [tag, n] of counts) {
    const group = byGroup.get(tagGroup(tag));
    group.distinct++; if (n === 1) group.singletons++;
    if (!selectedTags.has(tag) && (n < 2 || SOURCE_TAGS.has(tag))) continue;
    const candidate = [tag, n];
    if (group.featured.length === 6 && compare(candidate, group.featured[5]) >= 0) continue;
    group.featured.push(candidate); group.featured.sort(compare);
    if (group.featured.length > 6) group.featured.pop();
  }
  const categoryNodes = [...categories].sort(([a, an], [b, bn]) => bn - an || a.localeCompare(b)).map(([category, count]) => ({
    id: `category:${category}`, title: TYPE_LABELS[category] ?? category, type: category, kind: 'category', category,
    count, degree: 0, level: 0,
  }));
  const tagNodes = groupStats.flatMap(group => group.featured.map(([tag, count]) => ({
    id: `tag:${tag}`, title: tag, type: 'tag', kind: 'tag', tag, group: group.key, count, degree: 0, level: 1,
  })));
  const tagIds = new Set(tagNodes.map(n => n.tag));
  const edgeCounts = new Map();
  for (const p of scope) for (const tag of new Set(p.tags ?? [])) {
    if (!tagIds.has(tag)) continue;
    const key = JSON.stringify([p.category ?? p.type, tag]);
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  }
  const byId = new Map([...categoryNodes, ...tagNodes].map(n => [n.id, n]));
  const edges = [...edgeCounts].sort(([a], [b]) => a.localeCompare(b)).map(([key, weight]) => {
    const [category, tag] = JSON.parse(key);
    const source = `category:${category}`, target = `tag:${tag}`;
    byId.get(source).degree++; byId.get(target).degree++;
    return { source, target, weight, link_type: 'aggregate', link_source: 'tags', context: `${TYPE_LABELS[category] ?? category}中 ${weight} 份材料包含「${tag}」` };
  });
  return {
    view: 'overview', center: '', nodes: [...categoryNodes, ...tagNodes], edges, truncated: false,
    types: [...types].map(([type, n]) => ({ type, n })), metadata_errors: index.filter(p => p.metadata_error).length,
    scope: { pages: scope.length, tags: counts.size, untagged: scope.filter(p => !p.tags?.length).length,
      shown_pages: 0, shown_tags: tagNodes.length, page_limit: 0, tag_limit: 24, omitted_links: 0 },
    overview: {
      covered_pages: scope.length, categories: categoryNodes.length, featured_tags: tagNodes.length,
      other_tags: counts.size - tagNodes.length, singleton_tags: groupStats.reduce((sum, group) => sum + group.singletons, 0),
      groups: groupStats.map(({ featured, ...group }) => ({ ...group, shown: featured.length })),
    },
  };
}
