import * as store from './store.mjs';
import {text,integer,strings,filterSql,fail} from './contract.mjs';
import {RELATION_FIELDS as researchRelations} from '../server/slugs.mjs';

export async function related(run, input, filters) {
  const { doc } = await store.documentRevision(run, text(input.id, 'id', 500));
  const direction = input.direction ?? 'both', depth = integer(input.depth, 1, 1, 2, 'depth');
  if (!['incoming', 'outgoing', 'both'].includes(direction)) fail('INVALID_ARGUMENT', '关系方向无效');
  const types = input.link_types ? strings(input.link_types) : [];
  if (types.some(t => !researchRelations.includes(t))) fail('INVALID_ARGUMENT', '未知关系类型');
  const all = await store.listDocuments(run, { sort: 'title', direction: 'asc' });
  const bySlug = new Map(all.map(x => [x.slug, x]));
  const allowedParams = [], where = filterSql(filters, allowedParams);
  const allowed = new Set((await run(`SELECT document_id FROM research_query.documents d WHERE NOT deleted AND ${where}`, allowedParams)).map(d => d.document_id));
  const edges = [];
  for (const d of all) for (const [type, values] of Object.entries(d.metadata.relations ?? {})) {
    if (types.length && !types.includes(type)) continue;
    for (const slug of values) { const to = bySlug.get(slug); if (to && allowed.has(d.document_id) && allowed.has(to.document_id)) edges.push({ source: d.document_id, target: to.document_id, link_type: type, declared_in: { document_id: d.document_id, revision_id: d.revision_id, field: type }, provenance: 'frontmatter', verification: 'not_inferred_by_query_service' }); }
  }
  const visited = new Set([doc.document_id]), result = new Map();
  let frontier = new Set(visited), capped = false;
  for (let level = 0; level < depth; level++) {
    const next = new Set();
    for (const e of edges) if ((direction !== 'incoming' && frontier.has(e.source)) || (direction !== 'outgoing' && frontier.has(e.target))) {
      if (result.size >= 500) { capped = true; break; }
      result.set(JSON.stringify(e), e);
      for (const id of [e.source, e.target]) if (!visited.has(id)) { next.add(id); visited.add(id); }
    }
    frontier = next;
  }
  const titles = new Map(all.map(d => [d.document_id, d.title]));
  return { results: [...result.values()].map(e => ({ ...e, source_title: titles.get(e.source), target_title: titles.get(e.target) })), traversal_truncated: capped };
}

