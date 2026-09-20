import { entityMentions, resolveMention } from '../query/entities.mjs';
import { normalizeSlug, RELATION_FIELDS } from './slugs.mjs';

// Exact recorded tags and confirmed identity aliases; no inferred semantic claims.
const genericTags = new Set(['local', '研报', '文献', 'pdf', 'report', 'article', 'source']);
export function createPageGraphIndex(inventory, registry) {
  const pages = new Map(inventory.map(p => [p.slug, p]));
  const hubs = new Map(), memberships = new Map(), explicit = new Map();
  for (const page of inventory) {
    const links = new Map(); memberships.set(page.slug, links);
    const add = (node, raw, field) => {
      if (!hubs.has(node.id)) hubs.set(node.id, { ...node, pages: new Set() });
      hubs.get(node.id).pages.add(page.slug);
      if (!links.has(node.id)) links.set(node.id, []);
      const evidence = links.get(node.id);
      if (evidence.length < 3) evidence.push({ field, value: raw });
    };
    for (const tag of new Set(page.tags ?? [])) {
      if (genericTags.has(tag.toLowerCase())) continue;
      add({ id: `tag:${tag}`, title: tag, kind: 'tag', type: 'tag', tag }, tag, 'tags');
    }
    for (const mention of page.entity_mentions ?? entityMentions({ tags: page.tags ?? [] })) {
      const match = resolveMention(mention, registry);
      if (match.status !== 'curated') continue;
      const e = match.entity;
      add({ id: e.entity_id, entity_id: e.entity_id, title: e.name, kind: 'entity', type: e.type, identity_status: e.status }, mention.raw, mention.field);
    }
    for (const type of RELATION_FIELDS) for (const target of page.relations?.[type] ?? []) {
      if (typeof target !== 'string') continue;
      const slug = normalizeSlug(target);
      if (!pages.has(slug) || slug === page.slug) continue;
      const edge = { source: page.slug, target: slug, link_type: type, link_source: 'frontmatter', context: `材料元数据：${type}` };
      for (const id of [page.slug, slug]) { if (!explicit.has(id)) explicit.set(id, []); explicit.get(id).push(edge); }
    }
  }
  return { pages, hubs, memberships, explicit };
}

export function buildPageGraph(index, slug, { depth = 2, limit = 150, linkTypes = [], legacy = null } = {}) {
  const center = index.pages.get(slug);
  if (!center) return null;
  const allowed = type => !linkTypes.length || linkTypes.includes(type);
  const nodes = new Map(), edges = new Map();
  let truncated = Boolean(legacy?.truncated);
  const pageNode = (p, level) => ({ id: p.slug, title: p.title, type: p.category ?? p.type, kind: 'page', tags: (p.tags ?? []).slice(0, 80), degree: 0, level });
  nodes.set(slug, pageNode(center, 0));
  const addNode = node => {
    if (nodes.has(node.id)) return true;
    if (nodes.size >= limit) { truncated = true; return false; }
    nodes.set(node.id, node); return true;
  };
  const addEdge = edge => {
    const key = JSON.stringify([edge.source, edge.target, edge.link_type]);
    if (edges.has(key)) return true;
    if (edges.size >= 1000) { truncated = true; return false; }
    edges.set(key, edge); return true;
  };
  // Preserve explicit incoming/outgoing relations even for file-only pages.
  let frontier = new Set([slug]);
  const explicitEdges = new Map();
  for (let level = 0; level < Math.min(depth, 2); level++) {
    const next = new Set();
    scanEdges: for (const id of frontier) for (const edge of index.explicit.get(id) ?? []) {
      if (!allowed(edge.link_type)) continue;
      explicitEdges.set(JSON.stringify([edge.source, edge.target, edge.link_type]), edge);
      const other = edge.source === id ? edge.target : edge.source;
      if (explicitEdges.size >= 1000) { truncated = true; break scanEdges; }
      if (next.size < 50) next.add(other); else truncated = true;
    }
    frontier = next;
  }
  for (const edge of legacy?.edges ?? []) if (allowed(edge.link_type)) explicitEdges.set(JSON.stringify([edge.source, edge.target, edge.link_type]), edge);
  const legacyNodes = new Map((legacy?.nodes ?? []).map(n => [n.id, n]));
  for (const edge of explicitEdges.values()) {
    const missing = [edge.source, edge.target].filter(id => !nodes.has(id));
    if (nodes.size + missing.length > Math.min(limit, 51)) { truncated = true; continue; }
    for (const id of missing) {
      const p = index.pages.get(id), old = legacyNodes.get(id);
      if (p) addNode(pageNode(p, id === slug ? 0 : 1));
      else if (old) addNode({ ...old, kind: 'page' });
    }
    if (nodes.has(edge.source) && nodes.has(edge.target)) addEdge(edge);
  }
  const candidates = [...index.memberships.get(slug).keys()].map(id => index.hubs.get(id))
    .filter(h => allowed(h.kind === 'entity' ? 'has_entity' : 'has_tag'))
    .sort((a, b) => Number(b.kind === 'entity') - Number(a.kind === 'entity') || a.pages.size - b.pages.size || a.id.localeCompare(b.id));
  const selected = candidates.slice(0, 32);
  if (candidates.length > selected.length) truncated = true;
  const shownHubs = [];
  const connect = (pageSlug, hub) => {
    const evidence = index.memberships.get(pageSlug)?.get(hub.id);
    if (!evidence) return;
    addEdge({ source: pageSlug, target: hub.id, link_type: hub.kind === 'entity' ? 'has_entity' : 'has_tag', link_source: 'metadata',
      context: `${hub.kind === 'entity' ? '实体别名匹配' : '材料标签'}：${evidence.map(e => `${e.field}=${e.value}`).join('；')}` });
  };
  for (const hub of selected) {
    if (edges.size >= 1000) { truncated = true; break; }
    const { pages, ...node } = hub;
    if (addNode({ ...node, count: pages.size, degree: 0, level: 1 })) { shownHubs.push(hub); connect(slug, hub); }
  }
  const ranked = new Map();
  for (const hub of shownHubs) for (const id of hub.pages) {
    if (id === slug) continue;
    const score = (hub.kind === 'entity' ? 2 : 1) / Math.log2(2 + hub.pages.size);
    ranked.set(id, (ranked.get(id) ?? 0) + score);
  }
  if (depth >= 2) {
    const related = [...ranked].sort(([a, x], [b, y]) => y - x || String(index.pages.get(b).updated_at ?? '').localeCompare(String(index.pages.get(a).updated_at ?? '')) || a.localeCompare(b));
    let added = 0;
    for (const [id] of related) {
      if (nodes.has(id)) continue;
      if (added >= 50 || nodes.size >= limit || edges.size + shownHubs.length > 1000) { truncated = true; break; }
      if (addNode(pageNode(index.pages.get(id), 2))) { added++; for (const hub of shownHubs) connect(id, hub); }
    }
  }
  for (const node of nodes.values()) if (node.kind === 'page' && node.id !== slug) for (const hub of shownHubs) connect(node.id, hub);
  for (const edge of edges.values()) { nodes.get(edge.source).degree++; nodes.get(edge.target).degree++; }
  return { center: slug, view: 'neighborhood', nodes: [...nodes.values()], edges: [...edges.values()], truncated,
    metadata_errors: center.metadata_error ? 1 : 0,
    discovery: { related_pages: ranked.size, shown_pages: [...nodes.values()].filter(n => n.kind === 'page' && n.id !== slug).length,
      hubs: shownHubs.length, available_hubs: index.memberships.get(slug).size, hub_limit: 32, related_limit: 50, node_limit: limit } };
}
