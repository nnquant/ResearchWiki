import { matchesTags } from '../query/contract.mjs';

export function graphScope(index, { tags_all = [], tags_any = [], tags_none = [], q = '', type = '' } = {}) {
  const query = q.trim().toLocaleLowerCase();
  return index.filter(p => matchesTags(p.tags ?? [], { tags_all, tags_any, tags_none })
    && (!type || (p.category ?? p.type) === type)
    && (!query || [p.title, p.slug, ...(p.tags ?? [])].join(' ').toLocaleLowerCase().includes(query)));
}

/** A bounded, explainable bipartite graph. Never writes inferred semantic links. */
export function buildTagGraph(index, { tags_all = [], tags_any = [], tags_none = [], q = '', type = '', limit = 80 } = {}) {
  const scope = graphScope(index, { tags_all, tags_any, tags_none, q, type })
    .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')) || a.slug.localeCompare(b.slug));
  const counts = new Map();
  for (const p of scope) for (const tag of new Set(p.tags ?? [])) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const pages = scope.slice(0, limit);
  const visibleCounts = new Map();
  for (const p of pages) for (const tag of new Set(p.tags ?? [])) visibleCounts.set(tag, (visibleCounts.get(tag) ?? 0) + 1);
  const requested = new Set([...tags_all, ...tags_any]);
  const entity = tag => /^(公司|行业|领域)[:：]/.test(tag);
  const ranked = [...visibleCounts].sort(([a, an], [b, bn]) => Number(requested.has(b)) - Number(requested.has(a)) || Number(entity(b)) - Number(entity(a)) || bn - an || a.localeCompare(b));
  const allowed = new Set(ranked.slice(0, 40).map(([tag]) => tag));
  const tagRank = new Map(ranked.map(([tag], i) => [tag, i]));
  const types = new Map();
  for (const p of index) types.set(p.category ?? p.type, (types.get(p.category ?? p.type) ?? 0) + 1);
  const nodes = pages.map(p => ({ id: p.slug, title: p.title, type: p.category ?? p.type, kind: 'page',
    tags: [...new Set(p.tags ?? [])].sort((a, b) => tagRank.get(a) - tagRank.get(b)).slice(0, 80),
    tag_count: new Set(p.tags ?? []).size, degree: 0, level: 0, updated_at: p.updated_at }));
  const edges = [];
  const hubs = new Map();
  let omittedLinks = 0;
  for (const node of nodes) for (const tag of node.tags) {
    if (!allowed.has(tag)) continue;
    if (node.degree >= 10) { omittedLinks++; continue; }
    // ':' cannot occur in normalized page slugs; synthetic IDs cannot collide with pages.
    const id = `tag:${tag}`;
    if (!hubs.has(tag)) hubs.set(tag, { id, title: tag, type: 'tag', kind: 'tag', tag, degree: 0, level: 1, count: counts.get(tag) });
    hubs.get(tag).degree++;
    node.degree++;
    edges.push({ source: node.id, target: id, link_type: 'has_tag', link_source: 'tags', context: `材料标签：${tag}` });
  }
  return { view: 'materials', center: '', nodes: [...nodes, ...hubs.values()], edges, types: [...types].map(([type, n]) => ({ type, n })),
    metadata_errors: index.filter(p => p.metadata_error).length,
    truncated: scope.length > pages.length || ranked.length > allowed.size || omittedLinks > 0,
    scope: { pages: scope.length, tags: counts.size, untagged: scope.filter(p => !p.tags?.length).length,
      shown_pages: pages.length, shown_tags: hubs.size, page_limit: limit, tag_limit: 40, omitted_links: omittedLinks },
  };
}
