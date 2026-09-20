import { fail, filterSql, integer, keys, strings, text } from './contract.mjs';
import { normalizeEntityName, entityTypes } from './entities.mjs';
import { RELATION_FIELDS } from '../server/slugs.mjs';
import { businessRelationTypes } from './entity-relations.mjs';

export async function graphCoverage(run) {
  const [state] = await run("SELECT value FROM research_query.state WHERE key='graph_index'");
  if (!state) fail('GRAPH_INDEX_NOT_READY', '请运行 npm run research:graph-index 建立实体与关系索引', 503);
  const [pending] = await run(`SELECT count(*)::int AS pending_documents FROM research_query.documents d
    LEFT JOIN research_query.graph_documents g ON g.document_id=d.document_id
    WHERE NOT d.deleted AND (g.revision_id IS DISTINCT FROM d.revision_id OR g.registry_version IS DISTINCT FROM $1)`, [state.value.registry_version]);
  return { ...state.value, ...pending, complete: pending.pending_documents === 0 };
}

export async function resolveEntities(run, input, filters) {
  const q = normalizeEntityName(text(input.q, 'q'));
  if (input.entity_type && !entityTypes.includes(input.entity_type)) fail('INVALID_ARGUMENT', '未知实体类型');
  const params = [q, input.entity_type ?? null], where = filterSql(filters, params);
  const candidates = async exact => run(`WITH ids AS (
    SELECT entity_id FROM research_query.entities WHERE normalized_name ${exact ? '= $1' : 'ILIKE $1'}
    UNION SELECT entity_id FROM research_query.entity_aliases WHERE normalized_alias ${exact ? '= $1' : 'ILIKE $1'}
    UNION SELECT entity_id FROM research_query.entity_context_rules WHERE normalized_alias ${exact ? '= $1' : 'ILIKE $1'} AND ($2::text IS NULL OR entity_type=$2)
  ), matches AS (
    SELECT e.*, ${exact ? 'true' : 'false'} AS exact,
      (e.normalized_name<>$1 AND NOT EXISTS(SELECT 1 FROM research_query.entity_aliases a WHERE a.entity_id=e.entity_id AND a.normalized_alias=$1)
        AND EXISTS(SELECT 1 FROM research_query.entity_context_rules c WHERE c.entity_id=e.entity_id AND c.normalized_alias=$1)) AS requires_context
      FROM research_query.entities e JOIN ids USING(entity_id)
    WHERE e.status<>'retired' AND ($2::text IS NULL OR e.entity_type=$2)
  ), counted AS (
    SELECT m.*, (SELECT count(*)::int FROM research_query.document_entities de JOIN research_query.documents d ON d.document_id=de.document_id AND d.revision_id=de.revision_id
      WHERE de.entity_id=m.entity_id AND NOT d.deleted AND ${where}) AS document_count FROM matches m
  ) SELECT entity_id,entity_type,name,status,details,exact,document_count,requires_context FROM counted WHERE document_count>0 OR status='curated'
    ORDER BY exact DESC,document_count DESC,entity_id LIMIT 1001`, params);
  // Exact aliases use indexed equality. Only a miss scans partial names, once per
  // table, instead of running a correlated alias substring scan for every entity.
  const exactRows = await candidates(true);
  if (!exactRows.length) params[0] = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = exactRows.length ? exactRows : await candidates(false);
  if (rows.length > 1000) fail('RESULT_TOO_LARGE', '实体候选超过 1000，请补充名称或 entity_type', 413);
  const exact = rows.filter(r => r.exact), results = exact.length ? exact : rows;
  return { total: results.length, ambiguous: results.length > 1, matched_by: results.some(r=>r.requires_context)?'alias_and_context_candidates':exact.length ? 'exact_normalized_alias' : 'name_candidate',
    results: results.map(({ details, ...r }) => ({ ...r,exact:r.exact&&!r.requires_context,aliases: details.aliases ?? [], source: details.source, market: details.market ?? null, code: details.code ?? null, issuer_id: details.issuer_id ?? null })) };
}

async function seedNode(run, seed, filters) {
  keys(seed, ['kind', 'id'], 'seed');
  const id = text(seed.id, 'seed.id', 500);
  if (seed.kind === 'document') {
    const params = [id], where = filterSql(filters, params);
    const rows = await run(`SELECT document_id AS id,'document' AS kind,title AS label,revision_id,slug FROM research_query.documents d
      WHERE NOT deleted AND (document_id=$1 OR slug=$1) AND ${where} ORDER BY document_id LIMIT 2`, params);
    if (rows.length > 1) fail('AMBIGUOUS_SEED', '页面路径对应多个材料，请使用 document_id');
    if (rows[0]) return rows[0];
  } else if (seed.kind === 'entity') {
    const [node] = await run("SELECT entity_id AS id,'entity' AS kind,name AS label,entity_type,status FROM research_query.entities WHERE entity_id=$1 AND status<>'retired'", [id]);
    if (node) return node;
  } else if (seed.kind === 'tag') {
    const [node] = await run("SELECT tag_id AS id,'tag' AS kind,tag AS label FROM research_query.graph_tags WHERE tag_id=$1", [id]);
    if (node) return node;
  } else fail('INVALID_ARGUMENT', 'seed.kind 应为 document、entity 或 tag');
  fail('SEED_NOT_FOUND', '节点不存在或不在当前筛选范围内', 404);
}
const docNode = alias => `jsonb_build_object('id',${alias}.document_id,'kind','document','label',${alias}.title,'revision_id',${alias}.revision_id,'slug',${alias}.slug)`;

/** Each arm is restricted by the frontier and document filters before LIMIT. */
export async function adjacentEdges(run, frontier, { filters, direction = 'both', relationTypes = [], remaining = 501, relationAsOf = null }) {
  const params = [frontier, relationTypes, remaining], where = filterSql(filters, params, 'd'), targetWhere = filterSql(filters, params, 't');
  params.push(relationAsOf);const dateParam=`$${params.length}`;
  const traversable = (source, target) => direction === 'incoming' ? `${target}=ANY($1::text[])` : direction === 'outgoing' ? `${source}=ANY($1::text[])` : `(${source}=ANY($1::text[]) OR ${target}=ANY($1::text[]))`;
  return run(`SELECT * FROM (
    SELECT ${docNode('d')} AS source,jsonb_build_object('id',e.entity_id,'kind','entity','label',e.name,'entity_type',e.entity_type,'status',e.status) AS target,
      'has_entity' AS relation_type,jsonb_build_object('document_id',d.document_id,'revision_id',d.revision_id,'raw_values',de.raw_values,'source','metadata','verification','recorded_metadata','identity_resolution',e.status) AS provenance
    FROM research_query.document_entities de JOIN research_query.documents d ON d.document_id=de.document_id AND d.revision_id=de.revision_id
      JOIN research_query.entities e ON e.entity_id=de.entity_id
    WHERE NOT d.deleted AND e.status<>'retired' AND ${where} AND ${traversable('de.document_id', 'de.entity_id')} AND (cardinality($2::text[])=0 OR 'has_entity'=ANY($2::text[]))
    UNION ALL
    SELECT ${docNode('d')},jsonb_build_object('id',g.tag_id,'kind','tag','label',g.tag),'has_tag',
      jsonb_build_object('document_id',d.document_id,'revision_id',d.revision_id,'field','tags','raw_value',g.tag,'source','metadata','verification','recorded_tag')
    FROM research_query.document_tags dt JOIN research_query.documents d ON d.document_id=dt.document_id AND d.revision_id=dt.revision_id JOIN research_query.graph_tags g ON g.tag_id=dt.tag_id
    WHERE NOT d.deleted AND ${where} AND ${traversable('dt.document_id', 'dt.tag_id')} AND (cardinality($2::text[])=0 OR 'has_tag'=ANY($2::text[]))
    UNION ALL
    SELECT ${docNode('d')},${docNode('t')},r.link_type,
      jsonb_build_object('document_id',d.document_id,'revision_id',d.revision_id,'field',r.link_type,'source','frontmatter','verification','not_inferred_by_query_service')
    FROM research_query.document_relations r JOIN research_query.documents d ON d.document_id=r.document_id AND d.revision_id=r.revision_id
      JOIN research_query.documents t ON t.slug=r.target_slug
    WHERE NOT d.deleted AND NOT t.deleted AND ${where} AND ${targetWhere} AND ${traversable('d.document_id', 't.document_id')} AND (cardinality($2::text[])=0 OR r.link_type=ANY($2::text[]))
    UNION ALL
    SELECT jsonb_build_object('id',a.entity_id,'kind','entity','label',a.name,'entity_type',a.entity_type,'status',a.status),
      jsonb_build_object('id',b.entity_id,'kind','entity','label',b.name,'entity_type',b.entity_type,'status',b.status),r.relation_type,
      jsonb_build_object('relation_id',r.relation_id,'source',r.source,'verification','source_backed_registry','observed_at',r.observed_at,
        'valid_from',r.valid_from,'valid_to',r.valid_to,'evidence',r.evidence,'validity_known',r.valid_from IS NOT NULL)
    FROM research_query.entity_relations r JOIN research_query.entities a ON a.entity_id=r.source_id JOIN research_query.entities b ON b.entity_id=r.target_id
    WHERE a.status='curated' AND b.status='curated' AND ${traversable('r.source_id','r.target_id')}
      AND (cardinality($2::text[])=0 OR r.relation_type=ANY($2::text[]))
      AND (${dateParam}::date IS NULL OR (r.valid_from IS NOT NULL AND r.valid_from<=${dateParam}::date AND (r.valid_to IS NULL OR r.valid_to>=${dateParam}::date) AND r.observed_at<=${dateParam}::date))
      ${filters?`AND EXISTS(SELECT 1 FROM research_query.document_entities de JOIN research_query.documents d ON d.document_id=de.document_id AND d.revision_id=de.revision_id
        WHERE NOT d.deleted AND ${where} AND de.entity_id=r.source_id)
      AND EXISTS(SELECT 1 FROM research_query.document_entities de JOIN research_query.documents d ON d.document_id=de.document_id AND d.revision_id=de.revision_id
        WHERE NOT d.deleted AND ${where} AND de.entity_id=r.target_id)`:''}
  ) edges ORDER BY source->>'id',target->>'id',relation_type,provenance->>'relation_id' LIMIT $3`, params);
}

export async function traverse(run, seed, input, filters) {
  const depth = integer(input.depth, 1, 1, 2, 'depth'), maxNodes = integer(input.max_nodes, 100, 2, 400, 'max_nodes');
  const maxEdges = integer(input.max_edges, 300, 1, 1000, 'max_edges'), direction = input.direction ?? 'both';
  if (!['incoming', 'outgoing', 'both'].includes(direction)) fail('INVALID_ARGUMENT', '未知 direction');
  const relationTypes = input.relation_types ? strings(input.relation_types) : [];
  if (relationTypes.some(t => !['has_tag', 'has_entity', ...RELATION_FIELDS,...businessRelationTypes].includes(t))) fail('INVALID_ARGUMENT', '未知关系类型');
  const relationAsOf=input.relation_as_of??null;
  if(relationAsOf!==null&&(typeof relationAsOf!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(relationAsOf)||!Number.isFinite(Date.parse(relationAsOf))||new Date(relationAsOf).toISOString().slice(0,10)!==relationAsOf))fail('INVALID_ARGUMENT','relation_as_of 必须为有效 YYYY-MM-DD');
  let frontier = [seed.id], stopped = false, levels = 0;
  const visited = new Set(frontier), edges = new Map();
  for (let level = 0; level < depth && frontier.length; level++) {
    const candidates = await adjacentEdges(run, frontier, { filters, direction, relationTypes, remaining: maxEdges + 1,relationAsOf });
    const next = new Set(); levels++;
    for (const edge of candidates) {
      const key = JSON.stringify([edge.source.id, edge.target.id, edge.relation_type,edge.provenance?.relation_id??null]);
      if (edges.has(key)) continue;
      const unseen = [...new Set([edge.source.id, edge.target.id])].filter(id => !visited.has(id));
      if (edges.size >= maxEdges || visited.size + unseen.length > maxNodes) { stopped = true; break; }
      edges.set(key, { ...edge, level: level + 1 });
      for (const id of unseen) { visited.add(id); next.add(id); }
    }
    if (candidates.length > maxEdges) stopped = true;
    if (stopped) break;
    frontier = [...next];
  }
  return { seed, results: [...edges.values()], node_count: visited.size, edge_count: edges.size, depth_reached: levels,
    traversal_truncated: stopped, truncation_reason: stopped ? 'node_or_edge_budget; narrow filters or query a returned node' : null,
    limits: { depth, max_nodes: maxNodes, max_edges: maxEdges }, count_unit: 'edge' };
}

async function overview(run, input, filters) {
  if (input.group_by && !['entity', 'tag', 'category'].includes(input.group_by)) fail('INVALID_ARGUMENT', 'group_by 应为 entity、tag 或 category');
  const params = [], where = filterSql(filters, params), group = input.group_by ?? 'entity';
  const from = group === 'entity' ? `JOIN research_query.document_entities de ON de.document_id=d.document_id AND de.revision_id=d.revision_id JOIN research_query.entities e ON e.entity_id=de.entity_id AND e.status<>'retired'`
    : group === 'tag' ? 'JOIN research_query.document_tags dt ON dt.document_id=d.document_id AND dt.revision_id=d.revision_id JOIN research_query.graph_tags g ON g.tag_id=dt.tag_id' : '';
  const id = group === 'entity' ? 'e.entity_id' : group === 'tag' ? 'g.tag_id' : "coalesce(d.metadata->>'research_category','unknown')";
  const label = group === 'entity' ? 'e.name' : group === 'tag' ? 'g.tag' : id;
  const results = await run(`SELECT ${id} AS id,${label} AS label,'${group}' AS kind,count(DISTINCT d.document_id)::int AS document_count,
    count(DISTINCT d.family_id)::int AS document_family_count,count(*) OVER()::int AS total_groups
    FROM research_query.documents d ${from} WHERE NOT d.deleted AND ${where} GROUP BY ${id},${label}
    ORDER BY document_count DESC,id LIMIT 1001`, params);
  const total = results[0]?.total_groups ?? 0;
  return { results: results.slice(0, 1000).map(({ total_groups, ...r }) => r), total_groups: total, traversal_truncated: total > 1000,
    truncation_reason: total > 1000 ? 'top_1000_groups; narrow filters' : null, count_unit: 'distinct_document', family_count_note: 'document_family is a deduplication hint, not independent-source verification' };
}

async function intersection(run, input, filters) {
  if (!Array.isArray(input.seeds) || input.seeds.length < 2 || input.seeds.length > 5) fail('INVALID_ARGUMENT', 'intersection 需要 2–5 个 entity/tag 节点');
  const seeds = [];
  for (const s of input.seeds) {
    if (!['entity', 'tag'].includes(s?.kind)) fail('INVALID_ARGUMENT', '交集仅支持 entity/tag 节点');
    seeds.push(await seedNode(run, s, filters));
  }
  if (new Set(seeds.map(s => s.id)).size !== seeds.length) fail('INVALID_ARGUMENT', '交集节点不可重复');
  const params = [], where = filterSql(filters, params);
  const clauses = seeds.map(s => {
    params.push(s.id); const p = `$${params.length}`;
    const table = s.kind === 'entity' ? 'document_entities' : 'document_tags', column = s.kind === 'entity' ? 'entity_id' : 'tag_id';
    return `EXISTS(SELECT 1 FROM research_query.${table} m WHERE m.document_id=d.document_id AND m.revision_id=d.revision_id AND m.${column}=${p})`;
  });
  const results = await run(`SELECT d.document_id,d.revision_id,d.title,d.slug,d.family_id FROM research_query.documents d
    WHERE NOT d.deleted AND ${where} AND ${clauses.join(' AND ')} ORDER BY d.document_id LIMIT 10001`, params);
  if (results.length > 10000) fail('RESULT_TOO_LARGE', '交集超过 10000 份材料，请缩小范围', 413);
  return { seeds, total_documents: results.length, count_unit: 'distinct_document', results: results.map(d => ({ ...d, matched_seeds: seeds.map(s => s.id),
    provenance: { source: 'indexed_metadata_intersection', document_id: d.document_id, revision_id: d.revision_id }, open_url: '/page/' + d.slug.split('/').map(encodeURIComponent).join('/') })), traversal_truncated: false };
}

export async function graphQuery(run, input, filters) {
  const operation = input.operation ?? 'neighbors';
  const specific = { overview: ['group_by'], neighbors: ['seed', 'depth', 'direction', 'relation_types', 'max_nodes', 'max_edges','relation_as_of'], intersection: ['seeds'] };
  if (!specific[operation]) fail('INVALID_ARGUMENT', 'operation 应为 overview、neighbors 或 intersection');
  keys(input, ['operation', 'filters', 'limit', 'cursor', 'max_response_tokens', 'timeout_ms', ...specific[operation]]);
  const graph_index = await graphCoverage(run);
  const common = { graph_index, graph_snapshot_id: graph_index.snapshot_id, relation_warning: 'shared tags/entities are research leads, not causal or verified support relations',
    business_relation_scope:'With material filters both endpoints must occur in scope. relation_as_of excludes unknown validity and facts observed later; this is not complete historical replay.' };
  if (operation === 'overview') return { ...common, ...await overview(run, input, filters) };
  if (operation === 'intersection') return { ...common, ...await intersection(run, input, filters) };
  return { ...common, ...await traverse(run, await seedNode(run, input.seed, filters), input, filters) };
}

export async function indexedRelated(run, input, filters) {
  const types = input.link_types ? strings(input.link_types) : [...RELATION_FIELDS];
  if (types.some(t => !RELATION_FIELDS.includes(t))) fail('INVALID_ARGUMENT', '未知关系类型');
  const graph = await graphQuery(run, { seed: { kind: 'document', id: input.id }, depth: input.depth, direction: input.direction,
    relation_types: types.length ? types : [...RELATION_FIELDS], max_nodes: 400, max_edges: 500 }, filters);
  return { graph_index: graph.graph_index, traversal_truncated: graph.traversal_truncated, results: graph.results.map(e => ({
    source: e.source.id, target: e.target.id, source_title: e.source.label, target_title: e.target.label, link_type: e.relation_type,
    declared_in: { document_id: e.provenance.document_id, revision_id: e.provenance.revision_id, field: e.provenance.field },
    provenance: 'frontmatter', verification: 'not_inferred_by_query_service' })) };
}

export async function entityScopeSlugs(run, entityId) {
  text(entityId, 'entity_id', 200);
  const graph_index = await graphCoverage(run);
  const rows = await run(`SELECT d.slug FROM research_query.document_entities de JOIN research_query.documents d
    ON d.document_id=de.document_id AND d.revision_id=de.revision_id WHERE NOT d.deleted AND de.entity_id=$1`, [entityId]);
  return { slugs: new Set(rows.map(r => r.slug)), graph_index };
}
