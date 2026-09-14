import { getSql } from '../server/db.mjs';
import { filterSql, tsQuery, fail } from './contract.mjs';

export async function withRead(fn, { timeoutMs = 15000, signal } = {}) {
  signal?.throwIfAborted();
  const sql = await getSql();
  try {
    return await sql.begin('read only isolation level repeatable read', async tx => {
      await tx`SELECT set_config('statement_timeout', ${String(timeoutMs)}, true)`;
      // postgres.js cancels the active query on abort, including an exact vector scan.
      const run = async (query, params = []) => {
        signal?.throwIfAborted();
        const pending = tx.unsafe(query, params);
        const abort = () => { Promise.resolve(pending.cancel()).catch(() => {}); };
        signal?.addEventListener('abort', abort, { once: true });
        try { return await pending; } finally { signal?.removeEventListener('abort', abort); }
      };
      return fn(run);
    });
  } catch (e) {
    if (e.code === '42P01' || e.code === '3F000') fail('INDEX_NOT_READY', '请运行 npm run research:index 建立查询索引', 503);
    if (e.code === '57014' || signal?.aborted) fail('TIMEOUT', '请求已取消或超过查询预算', 504);
    throw e;
  }
}
export async function coverage(run, filters = null) {
  const params = [], where = filterSql(filters, params);
  const [counts] = await run(`SELECT count(*)::int AS documents,count(*) FILTER(WHERE text_chars>0)::int AS text_ready,
    count(*) FILTER(WHERE metadata->>'status'='parsed')::int AS parsed,
    count(*) FILTER(WHERE metadata->>'status'='indexed')::int AS manifest_indexed FROM research_query.documents d WHERE NOT deleted AND ${where}`, params);
  const state = await run('SELECT key,value FROM research_query.state');
  const values = Object.fromEntries(state.map(x => [x.key, x.value]));
  return { ...counts, lexical_ready: counts.text_ready, vector_ready: null, vector_basis: 'not_measured', scope: 'registered_documents_matching_filters',
    last_index: values.last_index ?? null, building: values.building ?? null,
    snapshot_id: values.last_index?.snapshot_id ?? null, complete: Boolean(values.last_index && !values.last_index.failed && !values.building) };
}
export async function listDocuments(run, { filters, q, sort = 'published_at', direction = 'desc', limit = 100000 }) {
  const params = [], where = filterSql(filters, params);
  let name = '';
  if (q) { params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); name = `AND (d.document_id ILIKE $${params.length} ESCAPE '\' OR d.title ILIKE $${params.length} ESCAPE '\' OR d.slug ILIKE $${params.length} ESCAPE '\' OR d.metadata::text ILIKE $${params.length} ESCAPE '\')`; }
  const ordering = sort === 'title' ? 'd.title' : `d.metadata->>'${sort}'`;
  return run(`SELECT d.document_id,d.revision_id,d.slug,d.title,d.family_id,d.metadata,d.text_chars,d.indexed_at FROM research_query.documents d
    WHERE NOT d.deleted AND ${where} ${name} ORDER BY ${ordering} ${direction} NULLS LAST,d.document_id LIMIT ${Number(limit)}`, params);
}
export async function tagDictionary(run, { q = '', filters } = {}) {
  const params = [], where = filterSql(filters, params);
  params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
  return run(`SELECT t.tag,count(DISTINCT d.document_id)::int AS n FROM research_query.documents d,
    LATERAL jsonb_array_elements_text(d.metadata->'tags') t(tag)
    WHERE NOT deleted AND ${where} AND t.tag ILIKE $${params.length} ESCAPE '\' GROUP BY t.tag ORDER BY n DESC,t.tag`, params);
}
export async function lexical(run, query, filters, candidateLimit) {
  const params = [], where = filterSql(filters, params);
  params.push(tsQuery(query)); const ts = `$${params.length}`;
  params.push(`%${query.replace(/[\\%_]/g, '\\$&')}%`); const phrase = `$${params.length}`;
  // Each arm is filtered BEFORE candidate truncation. Header hits survive without body text.
  return run(`WITH candidates AS (
    SELECT d.document_id,b.ordinal,ts_rank_cd(b.search_vector,to_tsquery('simple',${ts})) + CASE WHEN b.text ILIKE ${phrase} ESCAPE '\' THEN 1 ELSE 0 END AS score,'lexical' AS channel
    FROM research_query.blocks b JOIN research_query.documents d ON d.document_id=b.document_id AND d.revision_id=b.revision_id
    WHERE NOT d.deleted AND ${where} AND (b.search_vector @@ to_tsquery('simple',${ts}))
    UNION ALL
    SELECT d.document_id,0,4 + ts_rank_cd(d.search_vector,to_tsquery('simple',${ts})) + CASE WHEN d.title ILIKE ${phrase} ESCAPE '\' THEN 8 ELSE 0 END,'metadata'
    FROM research_query.documents d WHERE NOT deleted AND ${where}
      AND (d.search_vector @@ to_tsquery('simple',${ts}) OR d.title ILIKE ${phrase} ESCAPE '\')
  ), ranked AS (SELECT *,row_number() OVER(PARTITION BY document_id ORDER BY score DESC,ordinal) AS rn FROM candidates),
  selected AS (SELECT document_id,max(score) AS best FROM candidates GROUP BY document_id ORDER BY best DESC,document_id LIMIT ${candidateLimit})
  SELECT r.* FROM ranked r JOIN selected s USING(document_id) WHERE rn<=3 ORDER BY score DESC,document_id,ordinal`, params);
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
export async function hydrate(run, ids, filters = null, picks = null) {
  if (!ids.length) return [];
  const params = [ids], where = filterSql(filters, params);
  let blockFilter = '';
  if (picks) {
    params.push(picks);
    blockFilter = `AND EXISTS (SELECT 1 FROM jsonb_to_recordset($${params.length}::jsonb) wanted(document_id text, ordinal int) WHERE wanted.document_id=d.document_id AND wanted.ordinal=b.ordinal)`;
  }
  return run(`SELECT d.document_id,d.revision_id,d.slug,d.title,d.family_id,d.metadata,d.provenance,d.text_chars,d.indexed_at,
    b.block_id,b.ordinal,b.pdf_page,b.section,b.start_offset,b.end_offset,b.text
    FROM research_query.documents d LEFT JOIN research_query.blocks b ON b.document_id=d.document_id AND b.revision_id=d.revision_id ${blockFilter}
    WHERE NOT d.deleted AND d.document_id=ANY($1::text[]) AND ${where} ORDER BY d.document_id,b.ordinal`, params);
}
export async function documentRevision(run, id, revision) {
  const docs = await run('SELECT * FROM research_query.documents WHERE NOT deleted AND (document_id=$1 OR slug=$1) ORDER BY document_id LIMIT 2', [id]);
  if (!docs.length) fail('NOT_FOUND', '材料不存在', 404);
  if (docs.length > 1) fail('AMBIGUOUS_ID', 'slug 对应多份材料，请使用 document_id', 409);
  const doc = docs[0], rev = revision ?? doc.revision_id;
  const rows = await run('SELECT * FROM research_query.revisions WHERE document_id=$1 AND revision_id=$2', [doc.document_id, rev]);
  if (!rows.length) fail('REVISION_UNAVAILABLE', '指定版本不存在；不能使用当前版本替代旧引文', 404);
  const blocks = await run('SELECT * FROM research_query.blocks WHERE document_id=$1 AND revision_id=$2 ORDER BY ordinal', [doc.document_id, rev]);
  return { doc, revision: rows[0], blocks };
}
