import { getReadSql } from '../server/db.mjs';
import { createReadGate } from './read-gate.mjs';
import { FIELDS, filterSql, tsQuery, terms, fail } from './contract.mjs';
import { graphCoverage } from './graph-query.mjs';

const metadataWithEntities = `d.metadata || jsonb_build_object('entity_ids',COALESCE((SELECT jsonb_agg(em.entity_id ORDER BY em.entity_id)
  FROM research_query.document_entities em WHERE em.document_id=d.document_id AND em.revision_id=d.revision_id),'[]'::jsonb))`;
const acquireRead = createReadGate(4);
export const CARD_FIELDS = ['page_type', 'research_category', 'document_type', 'tags', 'entity_ids', 'tickers', 'companies', 'industries', 'institutions', 'language', 'published_at', 'research_stage', 'review_status', 'status'];
function metadataExpression(params, fields) {
  if (!fields) return metadataWithEntities;
  if (fields.some(f => !Object.hasOwn(FIELDS, f))) fail('INVALID_ARGUMENT', '未知字段');
  const entityIds = `jsonb_build_object('entity_ids',COALESCE((SELECT jsonb_agg(em.entity_id ORDER BY em.entity_id)
    FROM research_query.document_entities em WHERE em.document_id=d.document_id AND em.revision_id=d.revision_id),'[]'::jsonb))`;
  if (fields.length === 1 && fields[0] === 'entity_ids') return entityIds;
  params.push(fields);
  const projection = `COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(d.metadata) WHERE key=ANY($${params.length}::text[])),'{}'::jsonb)`;
  return fields.includes('entity_ids') ? `${projection} || ${entityIds}` : projection;
}

export async function withRead(fn, { timeoutMs = 15000, signal, timings } = {}) {
  const started = Date.now();
  signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  let release;
  try {
    release = await acquireRead(signal);
    if (timings) timings.pool_wait_ms = (timings.pool_wait_ms ?? 0) + Date.now() - started;
    const sql = await getReadSql();
    signal.throwIfAborted();
    return await sql.begin('read only isolation level repeatable read', async tx => {
      await tx`SELECT set_config('statement_timeout', ${String(Math.max(1, timeoutMs - (Date.now() - started)))}, true)`;
      // postgres.js cancels the active query on abort, including an exact vector scan.
      const run = async (query, params = []) => {
        signal?.throwIfAborted();
        const pending = tx.unsafe(query, params);
        const queryStarted = Date.now();
        const abort = () => { Promise.resolve(pending.cancel()).catch(() => {}); };
        signal?.addEventListener('abort', abort, { once: true });
        try { return await pending; } finally {
          signal?.removeEventListener('abort', abort);
          if (timings) { timings.sql_ms = (timings.sql_ms ?? 0) + Date.now() - queryStarted; timings.sql_queries = (timings.sql_queries ?? 0) + 1; }
        }
      };
      return fn(run);
    });
  } catch (e) {
    if (e.code === '42P01' || e.code === '3F000') fail('INDEX_NOT_READY', '请运行 npm run research:index 建立查询索引', 503);
    if (e.code === '57014' || signal?.aborted) fail('TIMEOUT', '请求已取消或超过查询预算', 504);
    throw e;
  } finally { release?.(); }
}
export async function coverage(run, filters = null) {
  const params = [], where = filterSql(filters, params);
  const [counts] = await run(`SELECT count(*)::int AS documents,count(*) FILTER(WHERE text_chars>0)::int AS text_ready,
    count(*) FILTER(WHERE (CASE WHEN catalog_fields_ready THEN catalog_status ELSE metadata->>'status' END)='parsed')::int AS parsed,
    count(*) FILTER(WHERE (CASE WHEN catalog_fields_ready THEN catalog_status ELSE metadata->>'status' END)='indexed')::int AS manifest_indexed,
    count(*) FILTER(WHERE text_chars>0 AND s.revision_id IS DISTINCT FROM d.revision_id)::int AS lexical_pending
    FROM research_query.documents d LEFT JOIN research_query.search_documents s ON s.document_id=d.document_id
    WHERE NOT deleted AND ${where}`, params);
  const state = await run('SELECT key,value FROM research_query.state');
  const values = Object.fromEntries(state.map(x => [x.key, x.value]));
  const usesEntities = f => Boolean(f && (f.field === 'entity_ids' || f.all?.some(usesEntities) || f.any?.some(usesEntities) || usesEntities(f.not)));
  const entity_index = usesEntities(filters) ? await graphCoverage(run) : null;
  return { ...counts, lexical_ready: counts.text_ready - counts.lexical_pending, vector_ready: null, vector_basis: 'not_measured', scope: 'registered_documents_matching_filters',
    last_index: values.last_index ?? null, building: values.building ?? null,
    snapshot_id: values.last_index?.snapshot_id ?? null, ...(entity_index ? { entity_index } : {}),
    complete: Boolean(values.last_index && !values.last_index.failed && !values.building && !counts.lexical_pending && (!entity_index || entity_index.complete)) };
}
export async function listDocuments(run, { filters, q, sort = 'published_at', direction = 'desc', limit = 100000, fields = null, referencesOnly = false }) {
  const params = [], where = filterSql(filters, params);
  let name = '';
  if (q) { params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); name = `AND (d.document_id ILIKE $${params.length} ESCAPE '\\' OR d.title ILIKE $${params.length} ESCAPE '\\' OR d.slug ILIKE $${params.length} ESCAPE '\\' OR d.metadata::text ILIKE $${params.length} ESCAPE '\\')`; }
  const ordering = sort === 'title' ? 'd.title' : sort === 'published_at' ? "CASE WHEN d.catalog_fields_ready THEN d.catalog_published_at ELSE d.metadata->>'published_at' END" : `d.metadata->>'${sort}'`;
  const metadata = referencesOnly ? (fields?.includes('entity_ids') ? metadataExpression(params, ['entity_ids']) : "'{}'::jsonb") : metadataExpression(params, fields);
  return run(`SELECT d.document_id,d.revision_id,d.slug,d.title,d.family_id,${metadata} AS metadata,d.text_chars,d.indexed_at FROM research_query.documents d
    WHERE NOT d.deleted AND ${where} ${name} ORDER BY ${ordering} ${direction} NULLS LAST,d.document_id LIMIT ${Number(limit)}`, params);
}
export async function hydrateDocumentRefs(run, refs) {
  if (!refs.length) return [];
  // Use pinned revisions and frozen graph memberships, even if ingestion updates
  // the current document between cursor pages. No transaction is held by a cursor.
  const rows = await run(`SELECT r.document_id,r.revision_id,r.metadata FROM research_query.revisions r
    JOIN jsonb_to_recordset($1::jsonb) wanted(document_id text,revision_id text)
    ON r.document_id=wanted.document_id AND r.revision_id=wanted.revision_id`, [refs.map(({document_id,revision_id})=>({document_id,revision_id}))]);
  const byId = new Map(rows.map(r => [r.document_id, r]));
  return refs.map(ref => {
    const revision = byId.get(ref.document_id);
    if (!revision) fail('REVISION_UNAVAILABLE', '查询快照的版本已不可用，请重新查询', 410);
    return { ...ref, metadata: { ...revision.metadata, ...ref.metadata } };
  });
}
export async function tagDictionary(run, { q = '', filters } = {}) {
  const params = [], where = filterSql(filters, params);
  params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
  return run(`SELECT t.tag,count(DISTINCT d.document_id)::int AS n FROM research_query.documents d,
    LATERAL jsonb_array_elements_text(d.metadata->'tags') t(tag)
    WHERE NOT deleted AND ${where} AND t.tag ILIKE $${params.length} ESCAPE '\\' GROUP BY t.tag ORDER BY n DESC,t.tag`, params);
}
export async function lexical(run, query, filters, candidateLimit) {
  const params = [], where = filterSql(filters, params);
  params.push(tsQuery(query)); const ts = `$${params.length}`;
  params.push(`%${query.replace(/[\\%_]/g, '\\$&')}%`); const phrase = `$${params.length}`;
  params.push([...new Set(terms(query))].slice(0,80).map(term => tsQuery(term))); const termQueries = '$' + params.length;
  // GIN eligibility avoids detoasting/ranking every full document vector.
  // GIN term matches provide document-level term coverage; passage scoring follows.
  const [settings] = await run("SELECT current_setting('enable_seqscan') AS seqscan,current_setting('jit') AS jit");
  await run("SET LOCAL enable_seqscan=off"); await run("SET LOCAL jit=off");
  let failed = false;
  try {
    return await run(`WITH body_recall AS MATERIALIZED (
    SELECT s.document_id,s.revision_id,count(*) * 0.1 AS score
    FROM unnest(${termQueries}::text[]) term(query) CROSS JOIN LATERAL (
      SELECT document_id,revision_id FROM research_query.search_documents
      WHERE search_vector @@ to_tsquery('simple',term.query) OFFSET 0
    ) s GROUP BY s.document_id,s.revision_id
  ), header_ids AS MATERIALIZED (
    SELECT document_id FROM research_query.documents WHERE NOT deleted AND search_vector @@ to_tsquery('simple',${ts})
    UNION SELECT document_id FROM research_query.documents WHERE NOT deleted AND title ILIKE ${phrase} ESCAPE '\\'
  ), header_recall AS MATERIALIZED (
    SELECT d.document_id,d.revision_id,4 + ts_rank_cd(d.search_vector,to_tsquery('simple',${ts}))
      + CASE WHEN d.title ILIKE ${phrase} ESCAPE '\\' THEN 8 ELSE 0 END AS score
    FROM research_query.documents d JOIN header_ids h USING(document_id)
  ), recalled AS MATERIALIZED (
    SELECT document_id,revision_id,sum(score) AS score FROM (SELECT * FROM body_recall UNION ALL SELECT * FROM header_recall) all_hits GROUP BY document_id,revision_id
  ), shortlist AS MATERIALIZED (
    SELECT d.document_id,d.revision_id,count(*) OVER()::int AS matched_documents FROM recalled r
    JOIN research_query.documents d ON d.document_id=r.document_id AND d.revision_id=r.revision_id
    WHERE NOT d.deleted AND ${where} ORDER BY r.score DESC,d.document_id LIMIT ${candidateLimit}
  ), candidates AS (
    SELECT d.document_id,b.ordinal,b.score,'lexical' AS channel
    FROM shortlist d CROSS JOIN LATERAL (
      SELECT ordinal,ts_rank_cd(b.search_vector,to_tsquery('simple',${ts})) + CASE WHEN b.text ILIKE ${phrase} ESCAPE '\\' THEN 1 ELSE 0 END AS score FROM research_query.blocks b
      WHERE b.document_id=d.document_id AND b.revision_id=d.revision_id AND b.search_vector @@ to_tsquery('simple',${ts})
      ORDER BY score DESC,ordinal LIMIT 3
    ) b
    UNION ALL
    SELECT h.document_id,0,h.score,'metadata'
    FROM header_recall h JOIN shortlist s USING(document_id)
  ), ranked AS (SELECT *,row_number() OVER(PARTITION BY document_id ORDER BY score DESC,ordinal) AS rn FROM candidates)
  SELECT r.*,s.matched_documents FROM ranked r JOIN shortlist s USING(document_id) WHERE rn<=3 ORDER BY r.score DESC,document_id,ordinal`, params);
  } catch (error) { failed = true; throw error; }
  finally {
    // Failed/cancelled transactions roll back settings; preserve the original error.
    if (!failed) await run("SELECT set_config('enable_seqscan',$1,true),set_config('jit',$2,true)",[settings.seqscan,settings.jit]);
  }
}
export async function vectorCandidates(run, vector, filters, candidateLimit, model) {
  const params = [], where = filterSql(filters, params);
  params.push(JSON.stringify(vector)); const v = `$${params.length}`;
  params.push(model); const modelParam = `$${params.length}`;
  // MATERIALIZED eligible vectors forces exact ranking over the filtered set. This avoids
  // HNSW post-filter starvation; statement_timeout bounds the cost on a large corpus.
  return run(`WITH eligible AS MATERIALIZED (
    SELECT d.document_id,c.chunk_text,c.chunk_index,c.embedding
    FROM research_query.documents d JOIN pages p ON p.slug=d.slug AND p.source_id='default' AND p.deleted_at IS NULL
    JOIN content_chunks c ON c.page_id=p.id
    WHERE NOT d.deleted AND ${where} AND c.embedding IS NOT NULL AND c.model=${modelParam}
      AND vector_dims(c.embedding)=${vector.length} AND (c.embedded_text_hash IS NULL OR c.embedded_text_hash=md5(c.chunk_text))
      AND extract(epoch FROM p.updated_at)*1000 >= d.source_mtime-1000
  ), ranked AS (
    SELECT document_id,chunk_text,chunk_index,1-(embedding <=> ${v}::vector) AS score,
      row_number() OVER(PARTITION BY document_id ORDER BY embedding <=> ${v}::vector,chunk_index) AS rn FROM eligible
  ) SELECT document_id,chunk_text,chunk_index,score,'vector' AS channel FROM ranked WHERE rn<=3 ORDER BY score DESC,document_id,chunk_index LIMIT ${candidateLimit}`, params);
}
export async function hydrate(run, ids, filters = null, picks = null, vectorPicks = null) {
  if (!ids.length) return [];
  const params = [ids], where = filterSql(filters, params);
  let blockFilter = '';
  if (picks) {
    params.push(picks);
    blockFilter = `AND EXISTS (SELECT 1 FROM jsonb_to_recordset($${params.length}::jsonb) wanted(document_id text, ordinal int) WHERE wanted.document_id=d.document_id AND wanted.ordinal=b.ordinal)`;
  }
  if (vectorPicks) {
    params.push(vectorPicks);
    blockFilter = `AND EXISTS (SELECT 1 FROM jsonb_to_recordset($${params.length}::jsonb) wanted(document_id text, text text)
      WHERE wanted.document_id=d.document_id AND length(b.text)>0
        AND (strpos(b.text,wanted.text)>0 OR strpos(wanted.text,btrim(b.text,E' \\t\\r\\n'))>0))`;
  }
  const metadata = metadataExpression(params, CARD_FIELDS);
  return run(`SELECT d.document_id,d.revision_id,d.slug,d.title,d.family_id,${metadata} AS metadata,d.provenance,d.text_chars,d.indexed_at,
    b.block_id,b.ordinal,b.pdf_page,b.section,b.start_offset,b.end_offset,b.text
    FROM research_query.documents d LEFT JOIN research_query.blocks b ON b.document_id=d.document_id AND b.revision_id=d.revision_id ${blockFilter}
    WHERE NOT d.deleted AND d.document_id=ANY($1::text[]) AND ${where} ORDER BY d.document_id,b.ordinal`, params);
}
export async function documentRevision(run, id, revision, { view = 'blocks' } = {}) {
  const docs = await run('SELECT document_id,revision_id,slug,title,family_id,metadata,text_chars,indexed_at FROM research_query.documents WHERE NOT deleted AND (document_id=$1 OR slug=$1) ORDER BY document_id LIMIT 2', [id]);
  if (!docs.length) fail('NOT_FOUND', '材料不存在', 404);
  if (docs.length > 1) fail('AMBIGUOUS_ID', 'slug 对应多份材料，请使用 document_id', 409);
  const doc = docs[0], rev = revision ?? doc.revision_id;
  const rows = await run('SELECT * FROM research_query.revisions WHERE document_id=$1 AND revision_id=$2', [doc.document_id, rev]);
  if (!rows.length) fail('REVISION_UNAVAILABLE', '指定版本不存在；不能使用当前版本替代旧引文', 404);
  const columns = 'document_id,revision_id,block_id,ordinal,start_offset,end_offset,pdf_page,section';
  const blocks = view === 'metadata' ? [] : await run(`SELECT ${columns}${view === 'outline' ? '' : ',text'} FROM research_query.blocks WHERE document_id=$1 AND revision_id=$2 ORDER BY ordinal`, [doc.document_id, rev]);
  return { doc, revision: rows[0], blocks };
}
