import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { getSql, closeDb } from '../scripts/server/db.mjs';
import { indexLexicalDocument } from '../scripts/query/lexical-index.mjs';
import { lexical, documentRevision, listDocuments, hydrateDocumentRefs } from '../scripts/query/store.mjs';

test('document recall retains body-only terms, filters before truncation, and immutable evidence', { skip: process.env.RESEARCH_GRAPH_DB_TEST !== '1' }, async () => {
  const sql = await getSql(), schema = `rq_lexical_test_${process.pid}_${Date.now()}`;
  assert.match(schema, /^rq_lexical_test_\d+_\d+$/);
  const rewrite = q => q.replaceAll('research_query', schema);
  function scoped(db) {
    function wrapped(first, ...args) {
      if (Array.isArray(first?.raw)) { const parts = first.map(rewrite); parts.raw = parts; return db(parts, ...args); }
      return db(typeof first === 'string' ? rewrite(first) : first, ...args);
    }
    wrapped.json = db.json.bind(db); wrapped.unsafe = (q, ...args) => db.unsafe(rewrite(q), ...args);
    return wrapped;
  }
  const db = scoped(sql), run = (q, p = []) => db.unsafe(q, p);
  try {
    await db.unsafe(await fs.readFile(new URL('../scripts/query/schema.sql', import.meta.url), 'utf8'));
    const add = async (id, title, tags, texts) => {
      await db`INSERT INTO research_query.documents(document_id,source_key,slug,title,family_id,revision_id,metadata,provenance,signature,text_chars,source_mtime,search_vector)
        VALUES(${id},${id},${id},${title},${id},'v1',${db.json({tags})},'{}','fixture',100,0,to_tsvector('simple',${title}))`;
      await db`INSERT INTO research_query.revisions(document_id,revision_id,metadata,provenance) VALUES(${id},'v1',${db.json({tags})},'{}')`;
      for (const [ordinal, text] of texts.entries()) await db`INSERT INTO research_query.blocks(document_id,revision_id,block_id,ordinal,start_offset,end_offset,pdf_page,section,text,search_vector)
        VALUES(${id},'v1',${id+':'+ordinal},${ordinal},0,${text.length},${ordinal+1},'[]',${text},to_tsvector('simple',${text}))`;
      await indexLexicalDocument(db,id,'v1');
    };
    await add('a','Generic report',['keep'],['ordinary '.repeat(17000), 'lateunique AI body evidence']);
    await add('b','AI high header score',['exclude'],['AI AI AI']);
    await add('c','100% literal',['keep'],[]);
    await add('d','1000 other',['keep'],[]);
    const body = await lexical(run,'lateunique',null,1);
    assert.equal(body[0].document_id,'a'); assert.equal(body[0].ordinal,1);
    const kept = await lexical(run,'AI',{field:'tags',op:'contains_all',value:['keep']},1);
    assert.equal(kept[0].document_id,'a'); assert.equal(kept[0].matched_documents,1);
    const truncated = await lexical(run,'AI',null,1);
    assert.equal(truncated[0].document_id,'b'); assert.equal(truncated[0].matched_documents,2);
    assert.deepEqual((await lexical(run,'%',null,10)).map(r=>r.document_id),['c']);
    const refs = await listDocuments(run,{fields:['tags'],referencesOnly:true});
    await db`UPDATE research_query.documents SET revision_id='v2' WHERE document_id='a'`;
    await db`INSERT INTO research_query.revisions(document_id,revision_id,metadata,provenance) VALUES('a','v2','{}','{}')`;
    await indexLexicalDocument(db,'a','v2');
    const frozen = await hydrateDocumentRefs(run,refs);
    assert.deepEqual(frozen.find(r=>r.document_id==='a').metadata.tags,['keep']);
    assert.equal(frozen.find(r=>r.document_id==='a').revision_id,'v1');
    assert.equal((await lexical(run,'lateunique',null,10)).length,0);
    const old = await documentRevision(run,'a','v1'); assert.ok(old.blocks[1].text.includes('lateunique'));
    assert.equal((await documentRevision(run,'a','v1',{view:'metadata'})).blocks.length,0);
    const outline = await documentRevision(run,'a','v1',{view:'outline'});
    assert.equal(outline.blocks[1].pdf_page,2); assert.ok(!('text' in outline.blocks[1]));
    await db`UPDATE research_query.documents SET deleted=true WHERE document_id='b'`;
    assert.equal((await lexical(run,'AI',null,10)).length,0);
  } finally {
    await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`); await closeDb();
  }
});
