import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSql, closeDb } from '../server/db.mjs';

// Union block lexemes, not concatenated source text: retains terms beyond the
// tsvector position limit without copying history or changing citation revisions.
export async function indexLexicalDocument(tx, id, revision) {
  await tx`UPDATE research_query.documents SET catalog_status=metadata->>'status',
    catalog_published_at=metadata->>'published_at',catalog_fields_ready=true WHERE document_id=${id}`;
  await tx`INSERT INTO research_query.search_documents(document_id,revision_id,search_vector)
    SELECT ${id},${revision},array_to_tsvector(ARRAY(
      SELECT DISTINCT term FROM research_query.blocks b,
        LATERAL unnest(tsvector_to_array(b.search_vector)) AS terms(term)
      WHERE b.document_id=${id} AND b.revision_id=${revision} ORDER BY term))
    ON CONFLICT(document_id) DO UPDATE SET revision_id=excluded.revision_id,search_vector=excluded.search_vector`;
}

export async function backfillLexicalIndex({ progress = () => {} } = {}) {
  const sql = await getSql();
  await sql.unsafe(await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  // Backfill scalar catalog fields once, without rebuilding already current vectors.
  await sql`UPDATE research_query.documents SET catalog_status=metadata->>'status',
    catalog_published_at=metadata->>'published_at',catalog_fields_ready=true WHERE NOT catalog_fields_ready`;
  const docs = await sql`SELECT d.document_id FROM research_query.documents d
    LEFT JOIN research_query.search_documents s USING(document_id)
    WHERE NOT d.deleted AND s.revision_id IS DISTINCT FROM d.revision_id ORDER BY d.document_id`;
  let completed = 0;
  for (const { document_id } of docs) {
    await sql.begin(async tx => {
      // Serialize with ingestion so a backfill cannot overwrite a newer projection.
      const [d] = await tx`SELECT revision_id FROM research_query.documents WHERE document_id=${document_id} AND NOT deleted FOR UPDATE`;
      if (d) await indexLexicalDocument(tx, document_id, d.revision_id);
    });
    if (++completed % 250 === 0) progress({ completed, total: docs.length });
  }
  await sql`ANALYZE research_query.search_documents`;
  return { completed, total: docs.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await backfillLexicalIndex({ progress: p => console.error(JSON.stringify(p)) }))); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { await closeDb(); }
}
