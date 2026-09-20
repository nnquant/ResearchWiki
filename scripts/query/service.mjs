import { randomUUID } from 'node:crypto';
import { VERSION, FIELDS, keys, text, integer, strings, validateFilters, filterSql, fail, combine } from './contract.mjs';
import * as store from './store.mjs';
import { embedQuery } from './embedding.mjs';
import { hash } from './blocks.mjs';
import { queryProfile } from './profile.mjs';
import { assetUrl } from '../common.mjs';
import { safeFile } from './index.mjs';
import { graphQuery, graphCoverage, resolveEntities, indexedRelated } from './graph-query.mjs';

const sessions = new Map(), TTL = 10 * 60 * 1000, SESSION_BYTES = 32 * 1024 * 1024;
const BASE = ['filters', 'limit', 'cursor', 'max_response_tokens', 'timeout_ms'];
const ALLOWED = {
  describe: [...BASE, 'section', 'q'], resolve: [...BASE, 'q', 'kind', 'entity_type'],
  query: [...BASE, 'q', 'sort', 'direction', 'fields', 'group_by'],
  search: [...BASE, 'query', 'mode', 'group_by', 'explain', 'expected_id', 'entity_name', 'entity_type'],
  read: ['id', 'revision_id', 'view', 'page', 'block_id', 'start_block', 'limit', 'cursor', 'find', 'neighbors', 'max_response_tokens', 'timeout_ms'],
  related: [...BASE, 'id', 'direction', 'link_types', 'depth'],
  graph: [...BASE, 'operation', 'seed', 'seeds', 'direction', 'relation_types', 'depth', 'max_nodes', 'max_edges', 'group_by','relation_as_of'],
};
const compactMeta = store.CARD_FIELDS;
function card(d, fields = compactMeta) {
  return { document_id: d.document_id, revision_id: d.revision_id, slug: d.slug, title: d.title, family_id: d.family_id,
    metadata: Object.fromEntries(fields.map(k => [k, d.metadata[k] ?? null])), text_available: d.text_chars > 0, indexed_at: d.indexed_at ?? null,
    open_url: '/page/' + d.slug.split('/').map(encodeURIComponent).join('/') };
}
function evidence(b) {
  return { document_id: b.document_id, revision_id: b.revision_id, block_id: b.block_id, pdf_page: b.pdf_page,
    printed_page: null, section: b.section, start_offset: b.start_offset, end_offset: b.end_offset,
    locator_quality: b.pdf_page == null ? 'block_only' : 'parser_page_marker' };
}
function saveSession(operation, request, payload) {
  for (const [id, s] of sessions) if (s.expires < Date.now()) sessions.delete(id);
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  if (bytes > SESSION_BYTES) fail('RESULT_TOO_LARGE', '结果过大，请缩小查询范围或减少返回字段', 413);
  let used = [...sessions.values()].reduce((n, s) => n + s.bytes, 0);
  while (sessions.size && (used + bytes > SESSION_BYTES || sessions.size >= 64)) { const key = sessions.keys().next().value; used -= sessions.get(key).bytes; sessions.delete(key); }
  const id = randomUUID();
  const s = { id, operation, request: { ...request, cursor: undefined }, payload, expires: Date.now() + TTL, bytes,
    queryFields: operation === 'query' && !request.group_by ? request.fields ?? compactMeta : null };
  sessions.set(id, s); return s;
}
async function paginate(session, request, offset = 0, read) {
  const limit = integer(request.limit, 20, 1, 100, 'limit');
  const tokens = integer(request.max_response_tokens, 6000, 512, 32000, 'max_response_tokens');
  const budget = tokens * 2; // conservative multilingual character budget, explicitly an estimate
  const selected = [], all = session.payload.results;
  const page = session.queryFields ? (await read(run => store.hydrateDocumentRefs(run, all.slice(offset, offset + limit)))).map(d => card(d, session.queryFields)) : all.slice(offset, offset + limit);
  let used = JSON.stringify({ ...session.payload, results: [] }).length + 600, pos = offset;
  if (used >= budget) fail('RESULT_TOO_LARGE', '响应元数据超出预算，请增大 max_response_tokens', 413);
  while (pos < all.length && selected.length < limit) {
    const item = page[pos-offset], cost = JSON.stringify(item).length;
    if (used + cost > budget && selected.length) break;
    if (used + cost > budget) fail('RESULT_TOO_LARGE', '单项超出输出预算，请增大 max_response_tokens 或减少 fields', 413);
    selected.push(item); used += cost; pos++;
  }
  return { ...session.payload, results: selected, returned_count: selected.length, truncated: pos < all.length,
    next_cursor: pos < all.length ? Buffer.from(JSON.stringify([session.id, pos])).toString('base64url') : null,
    budget: { max_response_tokens: tokens, estimated_characters: used, method: '2_characters_per_token_estimate' },
    cursor_expires_at: new Date(session.expires).toISOString() };
}

export async function execute(operation, input = {}, { signal } = {}) {
  if (!ALLOWED[operation]) fail('UNKNOWN_OPERATION', '未知研究操作', 404);
  keys(input, ALLOWED[operation]);
  integer(input.limit, 20, 1, 100, 'limit');
  integer(input.max_response_tokens, 6000, 512, 32000, 'max_response_tokens');
  const timeout = integer(input.timeout_ms, 15000, 100, 120000, 'timeout_ms');
  const combinedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
  const started = Date.now();
  const filters = validateFilters(input.filters);
  const timings = {};
  const read = async (fn, options = {}) => {
    try { return await store.withRead(fn, { timeoutMs: Math.max(1, timeout - (Date.now() - started)), signal: combinedSignal, timings, ...options }); }
    catch (e) { e.queryTimings = { ...timings }; throw e; }
  };
  if (input.cursor) {
    let id, offset;
    try { [id, offset] = JSON.parse(Buffer.from(text(input.cursor, 'cursor', 500), 'base64url').toString()); } catch { fail('INVALID_CURSOR', '无效游标'); }
    const s = sessions.get(id);
    if (!s || s.expires < Date.now()) fail('CURSOR_EXPIRED', '查询快照已过期，请重新执行查询', 410);
    if (s.operation !== operation || !Number.isInteger(offset) || offset < 0 || offset > s.payload.results.length) fail('INVALID_CURSOR', '游标不属于当前操作');
    for (const key of Object.keys(input).filter(k => !['cursor', 'limit', 'max_response_tokens', 'timeout_ms'].includes(k))) {
      if (JSON.stringify(input[key]) !== JSON.stringify(s.request[key])) fail('CURSOR_MISMATCH', '翻页时不能改变查询条件');
    }
    return { ...await paginate(s, input, offset, read), schema_version: VERSION, request_id: randomUUID(), latency_ms: Date.now() - started };
  }
  let payload;
  if (operation === 'search') payload = await search(input, filters, read, combinedSignal, timings);
  else payload = await read(async run => {
    const coverage = await store.coverage(run, filters);
    const base = { coverage, snapshot_id: coverage.snapshot_id, query_plan: { operation, filters, missing_values: 'excluded_from_positive_filters' }, degraded: coverage.complete ? [] : [{ stage: 'catalog', reason: coverage.building ? 'index_building' : 'index_incomplete' }] };
    if (operation === 'describe') {
      if (input.section && !['capabilities', 'tags'].includes(input.section)) fail('INVALID_ARGUMENT', 'section 应为 capabilities 或 tags');
      const q = input.q == null ? '' : text(input.q, 'q');
      if (input.section === 'tags') {
        const tags = await store.tagDictionary(run, { q, filters });
        return { ...base, total: tags.length, count_unit: 'distinct_document', results: tags.map(t => ({ ...t, tag_id: `tag:${hash(t.tag).slice(0, 24)}`, category: t.tag.split(/[:：]/).length > 1 ? t.tag.split(/[:：]/)[0] : null, provenance: 'unknown' })) };
      }
      return { ...base, results: [{ profile: queryProfile.name, operations: Object.keys(ALLOWED), fields: FIELDS, modes: ['lexical', 'hybrid', 'deep'],
        deep_capabilities: { increased_candidate_pool: true, llm_expansion: false, cross_encoder_reranking: false },
        tags: { dictionary: 'describe(section=tags)', resolve: 'resolve(kind=tag)', operators: ['contains_all', 'contains_any', 'contains_none'], provenance_filter: false },
        entities: { resolve: 'resolve(kind=entity)', filter_field: 'entity_ids', ambiguity: 'returns_candidates_without_guessing', observed_names_are_verified_identities: false, search_fallback:'search(entity_name, entity_type, query): confirmed scope plus original name, user filters preserved' },
        graph: { operations: ['overview', 'neighbors', 'intersection'], max_depth: 2, max_nodes: 400, max_edges: 1000, shared_tags_are_semantic_relations: false,
          business_relations:['issued_by','subsidiary_of','product_of','supplies_to'],relation_as_of:'known validity and observed_at on or before date; unknown validity excluded' },
        read: { views: ['metadata', 'outline', 'blocks'], locator: 'revision + block_id', pdf_page: '1-based physical page from parser markers' },
        limits: { max_results_per_page: 100, max_filter_nodes: 100, cursor_ttl_seconds: 600 },
        indexing: { command: 'npm run research:index', models_called: false, historical_cutoff: 'publication_date_only' } }] };
    }
    if (operation === 'resolve') {
      const q = text(input.q, 'q');
      const kind = input.kind ?? 'document';
      if (!['tag', 'document', 'entity'].includes(kind)) fail('INVALID_ARGUMENT', 'kind 应为 tag、document 或 entity');
      if (kind === 'entity') return { ...base, graph_index: await graphCoverage(run), ...await resolveEntities(run, input, filters) };
      if (input.entity_type) fail('INVALID_ARGUMENT', 'entity_type 仅用于 kind=entity');
      if (kind === 'tag') {
        const rows = await store.tagDictionary(run, { q, filters });
        return { ...base, total: rows.length, ambiguous: rows.length > 1, results: rows.map(r => ({ ...r, tag_id: `tag:${hash(r.tag).slice(0, 24)}`, exact: r.tag === q })) };
      }
      const rows = await store.listDocuments(run, { filters, q, sort: 'title', direction: 'asc', limit: 10001, fields: compactMeta });
      rows.sort((a, b) => Number(b.title === q || b.slug === q || b.document_id === q) - Number(a.title === q || a.slug === q || a.document_id === q));
      return { ...base, total: rows.length, ambiguous: rows.length > 1, results: rows.map(d => card(d)) };
    }
    if (operation === 'query') {
      const sort = input.sort ?? 'published_at', direction = input.direction ?? 'desc';
      if (!['title', ...Object.keys(FIELDS).filter(k => FIELDS[k] === 'date')].includes(sort) || !['asc', 'desc'].includes(direction)) fail('INVALID_ARGUMENT', '排序字段或方向无效');
      const fields = input.fields ? strings(input.fields, 'fields') : compactMeta;
      if (fields.some(f => !Object.hasOwn(FIELDS, f))) fail('INVALID_ARGUMENT', 'fields 包含未知字段');
      if (input.group_by && !Object.hasOwn(FIELDS, input.group_by)) fail('INVALID_ARGUMENT', '未知分组字段');
      const rows = await store.listDocuments(run, { filters, q: input.q == null ? null : text(input.q, 'q'), sort, direction, limit: 100001, fields: input.group_by ? [input.group_by] : fields, referencesOnly: !input.group_by });
      if (rows.length > 100000) fail('RESULT_TOO_LARGE', '查询超过 100000 份材料，请缩小范围', 413);
      if (input.group_by) {
        if (!Object.hasOwn(FIELDS, input.group_by)) fail('INVALID_ARGUMENT', '未知分组字段');
        const groups = new Map();
        for (const row of rows) for (const v of new Set([row.metadata[input.group_by] ?? null].flat())) groups.set(v, (groups.get(v) ?? 0) + 1);
        return { ...base, total_documents: rows.length, results: [...groups].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count) };
      }
      return { ...base, total: rows.length, results: rows };
    }
    if (operation === 'read') return { ...base, ...await readDocument(run, input) };
    if (operation === 'related') return { ...base, ...await indexedRelated(run, input, filters) };
    if (operation === 'graph') return { ...base, ...await graphQuery(run, input, filters) };
  });
  const session = saveSession(operation, input, payload);
  return { ...await paginate(session, input, 0, read), schema_version: VERSION, request_id: randomUUID(), latency_ms: Date.now() - started };
}

async function readDocument(run, input) {
  const id = text(input.id, 'id', 500);
  const revisionId = input.revision_id == null ? undefined : text(input.revision_id, 'revision_id', 64);
  const view = input.view ?? 'outline';
  if (!['metadata', 'outline', 'blocks'].includes(view)) fail('INVALID_ARGUMENT', 'view 应为 metadata、outline 或 blocks');
  const { doc, revision, blocks } = await store.documentRevision(run, id, revisionId, { view });
  const base = { document: card({ ...doc, revision_id: revision.revision_id, metadata: revision.metadata }), revision_id: revision.revision_id, current_revision: doc.revision_id === revision.revision_id, provenance: revision.provenance };
  const raw = await safeFile(revision.provenance.raw_path).catch(() => null);
  base.provenance = { ...revision.provenance, raw_url: raw ? assetUrl(raw.file) : null };
  if (view === 'metadata') return { ...base, results: [{ ...revision.metadata, provenance: revision.provenance }] };
  if (view === 'outline') {
    const seen = new Set();
    return { ...base, results: blocks.filter(b => { const k = JSON.stringify([b.pdf_page, b.section]); if (seen.has(k)) return false; seen.add(k); return true; }).map(b => ({ ...evidence(b), ordinal: b.ordinal })) };
  }
  const start = integer(input.start_block, 0, 0, 1000000, 'start_block');
  const neighbors = integer(input.neighbors, 0, 0, 3, 'neighbors');
  if (input.page != null) integer(input.page, 1, 1, 100000, 'page');
  if (input.block_id != null) text(input.block_id, 'block_id', 100);
  const find = input.find == null ? null : text(input.find, 'find').toLowerCase();
  const selected = new Set();
  for (const b of blocks) {
    if (b.ordinal < start || (input.page != null && b.pdf_page !== input.page) || (input.block_id && b.block_id !== input.block_id) || (find && !b.text.toLowerCase().includes(find))) continue;
    for (let n = b.ordinal - neighbors; n <= b.ordinal + neighbors; n++) selected.add(n);
  }
  if (input.block_id && !blocks.some(b => b.block_id === input.block_id)) fail('BLOCK_NOT_FOUND', '此版本中不存在该正文块', 404);
  return { ...base, results: blocks.filter(b => selected.has(b.ordinal)).map(b => ({ ...evidence(b), ordinal: b.ordinal, text: b.text })), total_blocks: blocks.length };
}

async function search(input, filters, read, signal, times) {
  if(input.entity_name==null) {
    if(input.entity_type!=null) fail('INVALID_ARGUMENT','entity_type 需要 entity_name');
    return searchBase(input,filters,read,signal,times);
  }
  const name=text(input.entity_name,'entity_name',500);
  if(input.mode!=null&&!['lexical','hybrid','deep'].includes(input.mode))fail('INVALID_ARGUMENT','mode 应为 lexical、hybrid 或 deep');
  const resolution=await read(run=>resolveEntities(run,{q:name,entity_type:input.entity_type},filters));
  const exact=resolution.results.filter(e=>e.exact&&e.status==='curated');
  const confirmed=resolution.results.length===1&&exact.length===1?exact[0]:null;
  const scoped=confirmed?combine(filters,{field:'entity_ids',op:'contains_all',value:[confirmed.entity_id]}):filters;
  text(input.query,'query');
  const primary=await searchBase(confirmed?input:{...input,query:name,mode:'lexical'},scoped,read,signal,times);
  const fallback=confirmed?await searchBase({...input,query:name,mode:'lexical'},filters,read,signal,{}):primary;
  const results=[],seen=new Set(),passages=new Map();
  for(const [batch,route] of [[primary,confirmed?'confirmed_entity_scope':'raw_name_fallback'],[fallback,'raw_name_fallback']]) {
    for(const hit of batch.results) {
      const key=input.group_by==='document_family'?hit.family_id:input.group_by==='passage'?`${hit.document_id}:${hit.evidence?.block_id??''}`:hit.document_id;
      if(seen.has(key)||(input.group_by==='passage'&&(passages.get(hit.document_id)??0)>=3)) continue;seen.add(key);
      passages.set(hit.document_id,(passages.get(hit.document_id)??0)+1);
      results.push({...hit,identity_status:route==='confirmed_entity_scope'?'confirmed_membership':'needs_evidence',retrieval_route:route});
    }
  }
  return {...primary,query:input.query,results,candidate_count:results.length,empty_reason:results.length?null:primary.empty_reason,
    degraded:[...primary.degraded,...(fallback===primary?[]:fallback.degraded)],
    entity_retrieval:{name,entity_id:confirmed?.entity_id??null,status:confirmed?'resolved':'unresolved_or_ambiguous',
      candidates:resolution.results.slice(0,20).map(({entity_id,name,entity_type,status,exact,requires_context})=>({entity_id,name,entity_type,status,exact,requires_context})),candidates_truncated:resolution.results.length>20,
      fallback_query:name,research_query:input.query,fallback_mode:'lexical_metadata_and_fulltext',filters_preserved:filters,
      warning:'Fallback results are discovery leads, not verified entity identity. Read cited blocks before use.'},
    query_plan:{...primary.query_plan,entity_fallback:true,candidate_count_unit:'merged_results_after_grouping',fallback_candidate_count:fallback.candidate_count},total_is_exhaustive:false};
}

async function searchBase(input, filters, read, signal, times) {
  const query = text(input.query, 'query'), mode = input.mode ?? 'hybrid';
  if (!['lexical', 'hybrid', 'deep'].includes(mode)) fail('INVALID_ARGUMENT', 'mode 应为 lexical、hybrid 或 deep');
  if (input.group_by && !['document', 'document_family', 'passage'].includes(input.group_by)) fail('INVALID_ARGUMENT', 'group_by 无效');
  if (input.explain != null && typeof input.explain !== 'boolean') fail('INVALID_ARGUMENT', 'explain 应为布尔值');
  const candidateLimit = mode === 'deep' ? 300 : 120;
  const degraded = [], started = Date.now();
  const lexicalStart = Date.now();
  const initial = await read(async run => {
    let stage = Date.now();
    const coverage = await store.coverage(run, filters); times.coverage_ms = Date.now() - stage;
    stage = Date.now();
    const hits = await store.lexical(run, query, filters, candidateLimit); times.lexical_query_ms = Date.now() - stage;
    stage = Date.now();
    const rows = await store.hydrate(run, [...new Set(hits.map(x => x.document_id))], filters,
      hits.filter(x => x.channel === 'lexical').map(x => ({ document_id: x.document_id, ordinal: Number(x.ordinal) })));
    times.lexical_hydrate_ms = Date.now() - stage;
    return { coverage, hits, rows };
  });
  times.lexical_ms = Date.now() - lexicalStart;
  const lexicalRows = initial.rows;
  let vector = [];
  if (mode !== 'lexical' && initial.coverage.documents) {
    const vectorStart = Date.now();
    // Bound the optional stage as a whole, leaving time to return lexical evidence.
    const semanticSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
    try {
      const embedded = await embedQuery(query, semanticSignal);
      vector = await read(run => store.vectorCandidates(run, embedded.vector, filters, candidateLimit, embedded.model), { signal: semanticSignal });
    } catch (e) {
      degraded.push({ stage: 'embedding_or_vector', reason: e.data?.code ?? e.message });
    }
    times.vector_ms = Date.now() - vectorStart;
  }
  if (!initial.coverage.complete) degraded.push({ stage: 'catalog', reason: initial.coverage.building ? 'index_building' : 'index_incomplete' });
  if (mode === 'deep') degraded.push({ stage: 'deep', reason: 'llm_expansion_and_reranker_not_configured; increased_candidate_pool_only' });
  // Candidates carry ranking evidence; hydration rechecks the active revision and filters.
  let rows = lexicalRows;
  if (vector.length && !signal.aborted) {
    const hydrateStart = Date.now();
    try { rows = [...lexicalRows, ...await read(run => store.hydrate(run, [...new Set(vector.map(x => x.document_id))], filters, null,
      vector.map(x => ({ document_id: x.document_id, text: x.chunk_text.trim() }))))]; }
    catch (e) { degraded.push({ stage: 'evidence', reason: e.data?.code ?? 'hydration_failed' }); vector = []; }
    times.vector_hydrate_ms = Date.now() - hydrateStart;
  }
  const byDoc = new Map();
  for (const row of rows) { if (!byDoc.has(row.document_id)) byDoc.set(row.document_id, []); byDoc.get(row.document_id).push(row); }
  const candidates = new Map();
  const add = (hit, rank, channel) => {
    const blocks = byDoc.get(hit.document_id); if (!blocks) return;
    let block;
    if (channel === 'vector') {
      const probe = hit.chunk_text.trim();
      block = blocks.find(b => b.text && (b.text.includes(probe) || probe.includes(b.text.trim())));
      // Never invent a citation when GBrain chunks span differently. Document-level
      // semantic relevance survives, while read/outline is the required next step.
    } else if (channel === 'metadata') {
      const passage = initial.hits.find(h => h.document_id === hit.document_id && h.channel === 'lexical');
      if (passage) block = blocks.find(b => b.ordinal === Number(passage.ordinal));
    } else block = blocks.find(b => b.block_id && b.ordinal === Number(hit.ordinal));
    const d = block ?? blocks[0], key = `${d.document_id}:${block?.ordinal ?? 'document'}`;
    const entry = candidates.get(key) ?? { ...card(d), evidence: block ? evidence(block) : null,
      snippet: (block?.text ?? '').slice(0, 700), score: 0, channels: [], content_kind: d.provenance.content_kind,
      citation_status: block ? 'available' : 'read_required' };
    entry.score += 1 / (60 + rank + 1); entry.channels.push({ channel, rank: rank + 1, score: Number(hit.score) });
    candidates.set(key, entry);
  };
  initial.hits.forEach((hit, i) => add(hit, i, hit.channel)); vector.forEach((hit, i) => add(hit, i, 'vector'));
  const sorted = [...candidates.values()].sort((a, b) => b.score - a.score || a.document_id.localeCompare(b.document_id));
  const counts = new Map(), results = [];
  for (const hit of sorted) {
    const group = input.group_by === 'document_family' ? hit.family_id : hit.document_id;
    const max = input.group_by === 'passage' ? 3 : 1;
    if ((counts.get(group) ?? 0) >= max) continue;
    counts.set(group, (counts.get(group) ?? 0) + 1); results.push(hit);
  }
  const expected = input.expected_id ? { id: input.expected_id, in_lexical_candidates: initial.hits.some(x => x.document_id === input.expected_id), in_vector_candidates: vector.some(x => x.document_id === input.expected_id), in_results: results.some(x => x.document_id === input.expected_id) } : undefined;
  return { query, mode, results, candidate_count: sorted.length, total_is_exhaustive: false,
    snapshot_id: initial.coverage.snapshot_id, coverage: initial.coverage, degraded,
    empty_reason: results.length ? null : !initial.coverage.documents ? 'no_documents_match_filters' : degraded.length ? 'retrieval_incomplete' : 'no_match_in_searched_text',
    query_plan: { operation: 'search', query, mode, filters, group_by: input.group_by ?? 'document', candidate_limit: candidateLimit, vector_scan: 'exact_filtered_set', score: 'RRF_not_probability',
      lexical_strategy: 'document_recall_then_passage_rank', lexical_match: 'any_term',
      matched_documents: initial.hits[0]?.matched_documents ?? 0,
      candidate_truncated: (initial.hits[0]?.matched_documents ?? 0) > candidateLimit,
      ...(input.explain ? { timings: times, total_ms: Date.now() - started, lexical_candidates: initial.hits.length, vector_candidates: vector.length, expected } : {}) } };
}
