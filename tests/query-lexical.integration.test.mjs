import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { getSql, closeDb } from '../scripts/server/db.mjs';
import { indexLexicalDocument } from '../scripts/query/lexical-index.mjs';
import { FIELDS } from '../scripts/query/contract.mjs';
import { lexical, documentRevision, listDocuments, hydrateDocumentRefs, catalogPage, countCatalogDocuments } from '../scripts/query/store.mjs';

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
    await add('han1','Phrase',['keep'],['加 息 ai']);
    await add('han2','Separated',['keep'],['加 大 息 ai']);
    const phrase = await lexical(run,'加息 AI',null,10);
    assert.deepEqual(phrase.map(x=>x.document_id),['han1']);
    assert.equal(phrase.lexicalMatch,'all_terms_with_adjacent_han_phrases');
    await add('split','Different blocks',['keep'],['alpha','omega']);
    assert.ok((await lexical(run,'alpha omega',null,10)).some(x=>x.document_id==='split'));
    assert.equal((await lexical(run,'alpha absent',null,10)).lexicalMatch,'any_term_fallback_with_adjacent_han_phrases');

    await db`INSERT INTO research_query.catalog_generations(snapshot_id) VALUES ('frozen')`;
    await db`INSERT INTO research_query.catalog_entries(snapshot_id,document_id,revision_id,slug,title,family_id,text_chars,indexed_at,entity_ids)
      SELECT 'frozen',document_id,revision_id,slug,title,family_id,text_chars,indexed_at,'["entity:frozen"]' FROM research_query.documents WHERE NOT deleted`;
    await db`UPDATE research_query.catalog_entries SET sort_published_at=CASE WHEN document_id IN ('c','han1') THEN '2026-09-20' WHEN document_id='d' THEN '2026-09-19' ELSE NULL END`;
    const options = {snapshotId:'frozen',sort:'published_at',direction:'desc',fields:['tags','entity_ids']};
    const total = await countCatalogDocuments(run,options);
    const first = await catalogPage(run,{...options,limit:2});
    await db`UPDATE research_query.documents SET title='changed',deleted=true WHERE document_id=${first[0].document_id}`;
    assert.equal((await catalogPage(run,{...options,limit:2}))[0].title,first[0].title);
    assert.deepEqual(first[0].metadata.entity_ids,['entity:frozen']);
    const all = [...first]; let last = first.at(-1);
    while (true) {
      const page = await catalogPage(run,{...options,limit:2,after:{key:last.sort_key,id:last.document_id}});
      if (!page.length) break;
      all.push(...page); last=page.at(-1);
    }
    assert.equal(all.length,total); assert.equal(new Set(all.map(x=>x.document_id)).size,total);
    const ascending = []; let after = null;
    while (true) {
      const page = await catalogPage(run,{...options,direction:'asc',limit:1,after});
      if (!page.length) break;
      ascending.push(page[0].document_id); after={key:page[0].sort_key,id:page[0].document_id};
    }
    const expected = await db`SELECT document_id FROM research_query.catalog_entries ORDER BY sort_published_at ASC NULLS LAST,document_id`;
    assert.deepEqual(ascending,expected.map(r=>r.document_id));
    if (FIELDS.entity_ids) assert.equal(await countCatalogDocuments(run,{...options,filters:{field:'entity_ids',op:'contains_all',value:['entity:frozen']}}),total);
    await assert.rejects(catalogPage(run,{...options,snapshotId:'expired',limit:2}),e=>e.data?.code==='CURSOR_EXPIRED');
  } finally {
    await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`); await closeDb();
  }
});
