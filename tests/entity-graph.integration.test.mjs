import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { getSql, closeDb } from '../scripts/server/db.mjs';
import { refreshGraphIndex } from '../scripts/query/graph-index.mjs';
import { compileRegistry, tagId } from '../scripts/query/entities.mjs';
import { graphQuery, resolveEntities, indexedRelated, graphCoverage } from '../scripts/query/graph-query.mjs';
import { listDocuments, coverage } from '../scripts/query/store.mjs';
import { saveReview,reviewQueue,reviewDetail } from '../scripts/query/entity-governance.mjs';
import { businessRelations } from '../scripts/query/entity-relations.mjs';

test('PostgreSQL entity/graph lifecycle in an isolated disposable schema', { skip: process.env.RESEARCH_GRAPH_DB_TEST !== '1' }, async () => {
  const sql = await getSql(), schema = `rq_graph_test_${process.pid}_${Date.now()}`;
  assert.match(schema, /^rq_graph_test_\d+_\d+$/);
  const rewrite = text => text.replaceAll('research_query', schema);
  function scoped(db) {
    function wrapped(first, ...args) {
      if (Array.isArray(first?.raw)) { const parts = first.map(rewrite); parts.raw = parts; return db(parts, ...args); }
      return db(typeof first === 'string' ? rewrite(first) : first, ...args);
    }
    wrapped.json = db.json.bind(db); wrapped.unsafe = (s, ...args) => db.unsafe(rewrite(s), ...args);
    wrapped.begin = fn => db.begin(tx => fn(scoped(tx)));
    return wrapped;
  }
  const db = scoped(sql), run = (q, params = []) => db.unsafe(q, params);
  const a = { entity_id: 'entity:company:a', type: 'company', name: 'Alpha', aliases: ['甲公司'], source: 'fixture' };
  const registry = compileRegistry({ version: 1, entities: [a] });
  try {
    await db.unsafe(await fs.readFile(new URL('../scripts/query/schema.sql', import.meta.url), 'utf8'));
    const insert = async (id, metadata, family = id) => {
      await db`INSERT INTO research_query.documents(document_id,source_key,slug,title,family_id,revision_id,metadata,provenance,signature,text_chars,source_mtime)
        VALUES (${id},${id},${id},${id},${family},'v1',${db.json(metadata)},'{}','fixture',0,0)`;
    };
    await insert('doc:a', { companies: ['Alpha'], tags: ['公司:Alpha', '领域:AI'], research_category: 'company', relations: { supported_by: ['doc:b'] } }, 'same-report');
    await insert('doc:b', { companies: ['甲公司'], tags: ['公司:甲公司', '领域:AI'], research_category: 'company', relations: {} }, 'same-report');
    await insert('doc:c', { companies: ['其他公司'], tags: ['领域:AI'], research_category: 'industry', relations: { contradicted_by: ['doc:a'] } });
    await insert('doc:empty', { tags: [], relations: {}, research_category: 'note' });
    const initial = await refreshGraphIndex(db, registry); assert.equal(initial.changed_documents, 4);
    assert.equal((await refreshGraphIndex(db, registry)).changed_documents, 0);
    const entity = await resolveEntities(run, { q: '甲公司', entity_type: 'company' });
    assert.equal(entity.results[0].entity_id, a.entity_id); assert.equal(entity.results[0].document_count, 2);
    const partial = await resolveEntities(run, { q: 'Alp', entity_type: 'company' });
    assert.equal(partial.results[0].entity_id, a.entity_id); assert.equal(partial.matched_by, 'name_candidate');
    assert.equal((await resolveEntities(run, { q: 'Al%', entity_type: 'company' })).results.length, 0);
    const filters = { field: 'entity_ids', op: 'contains_all', value: [a.entity_id] };
    assert.equal((await listDocuments(run, { filters })).length, 2);
    const all = await graphQuery(run, { operation: 'overview', group_by: 'entity' }, filters);
    assert.equal(all.results[0].document_count, 2); assert.equal(all.results[0].document_family_count, 1);
    const intersect = await graphQuery(run, { operation: 'intersection', seeds: [{ kind: 'entity', id: a.entity_id }, { kind: 'tag', id: tagId('领域:AI') }] }, null);
    assert.deepEqual(intersect.results.map(d => d.document_id), ['doc:a', 'doc:b']);
    const local = await graphQuery(run, { seed: { kind: 'entity', id: a.entity_id }, depth: 2 }, filters);
    assert.ok(local.results.length); assert.ok(local.results.every(e => ![e.source.id, e.target.id].includes('doc:c')));
    assert.ok(local.results.every(e => e.provenance.revision_id === 'v1'));
    const related = await indexedRelated(run, { id: 'doc:a', direction: 'both' }, filters);
    assert.equal(related.results.length, 1); assert.equal(related.results[0].link_type, 'supported_by');
    const incoming = await indexedRelated(run, { id: 'doc:a', direction: 'incoming' }, null);
    assert.equal(incoming.results[0].source, 'doc:c');
    await assert.rejects(graphQuery(run, { operation: 'neighbors', seed: { kind: 'document', id: 'doc:c' } }, filters));
    const conflicting = compileRegistry({ version: 1, entities: [a, { ...a, entity_id: 'entity:company:b', name: 'Beta', aliases: ['甲公司'] }] });
    assert.equal((await refreshGraphIndex(db, conflicting)).changed_documents, 1);
    assert.equal((await resolveEntities(run, { q: '甲公司' })).ambiguous, true);
    assert.equal((await listDocuments(run, { filters })).length, 1);
    assert.equal((await run("SELECT status FROM research_query.entity_mentions WHERE document_id='doc:b' AND field='companies'"))[0].status, 'ambiguous');
    assert.equal((await refreshGraphIndex(db, registry)).changed_documents, 1); assert.equal((await listDocuments(run, { filters })).length, 2);
    const unusedAlias = compileRegistry({ version: 1, entities: [{ ...a, aliases: [...a.aliases, 'Unused Alias'] }] });
    assert.equal((await refreshGraphIndex(db, unusedAlias)).changed_documents, 0);
    assert.equal((await graphCoverage(run)).complete, true);
    assert.equal((await refreshGraphIndex(db, registry)).changed_documents, 0);
    await db`UPDATE research_query.documents SET revision_id='v2',metadata='{"tags":[],"relations":{}}' WHERE document_id='doc:a'`;
    assert.equal((await graphCoverage(run)).pending_documents, 1);
    const scopedCoverage = await coverage(run, { all: [filters] });
    assert.equal(scopedCoverage.entity_index.pending_documents, 1);
    assert.equal(scopedCoverage.complete, false);
    assert.equal((await listDocuments(run, { filters })).length, 1); // stale membership never matches new content
    await db`UPDATE research_query.documents SET deleted=true WHERE document_id='doc:b'`;
    await refreshGraphIndex(db, registry);
    assert.equal((await listDocuments(run, { filters })).length, 0);
    assert.equal((await run("SELECT count(*)::int AS n FROM research_query.document_relations WHERE document_id='doc:a'"))[0].n, 0);
    assert.equal((await graphCoverage(run)).complete, true);
    await db`UPDATE research_query.documents SET deleted=false WHERE document_id='doc:b'`;
    await refreshGraphIndex(db, registry); assert.equal((await listDocuments(run, { filters })).length, 1);
    const security = {entity_id:'entity:security:hk:00700',type:'security',name:'HK:00700',aliases:[],market:'HK',code:'00700',source:'fixture'};
    await insert('doc:stock',{tickers:['00700 HK'],tags:[]});
    const withSecurity=compileRegistry({version:1,entities:[a,security]});
    assert.equal((await refreshGraphIndex(db,withSecurity)).changed_documents,1);
    const alternate=await resolveEntities(run,{q:'700HK',entity_type:'security'});
    assert.equal(alternate.results[0].entity_id,security.entity_id);
    assert.equal(alternate.results[0].document_count,1);
    assert.equal((await run("SELECT raw_value FROM research_query.entity_mentions WHERE document_id='doc:stock'"))[0].raw_value,'00700 HK');
    assert.equal((await refreshGraphIndex(db,registry)).changed_documents,1);
    const b={...a,entity_id:'entity:company:b',name:'Beta',aliases:[]};
    const contextual={entity_id:'entity:subfield:converter',type:'subfield',name:'模数转换器',aliases:[],source:'fixture'};
    const governed=compileRegistry({version:1,entities:[a,b,contextual,{...security,issuer_id:a.entity_id,issuer_source:'https://example.com/issuer',reviewed_at:'2026-09-18'}],
      context_rules:[{type:'subfield',alias:'ADC',entity_id:contextual.entity_id,definitions:['模数转换器'],source:'fixture'}]});
    governed.relations=businessRelations(governed,{relations:[{source_id:b.entity_id,target_id:a.entity_id,relation_type:'subsidiary_of',source:'https://example.com/report',
      observed_at:'2026-09-18',valid_from:'2026-01-01',valid_to:'2026-12-31',evidence:{quote:'Beta is a subsidiary of Alpha'}}]});
    const withBody=async(id,metadata,body)=>{
      await insert(id,metadata);
      await db`INSERT INTO research_query.revisions(document_id,revision_id,metadata,provenance) VALUES (${id},'v1',${db.json(metadata)},'{}')`;
      await db`INSERT INTO research_query.blocks(document_id,revision_id,block_id,ordinal,start_offset,end_offset,pdf_page,section,text)
        VALUES (${id},'v1','block:fixture',0,0,${body.length},3,'[]',${body})`;
    };
    await withBody('doc:context',{subfields:['ADC'],tags:[]},'模数转换器（ADC）用于信号处理。');
    await withBody('doc:review',{companies:['谜语'],tags:[]},'这里的谜语指 Alpha。另一段谜语指 Beta。');
    await refreshGraphIndex(db,governed);
    assert.equal((await run("SELECT entity_id FROM research_query.document_entities WHERE document_id='doc:context'"))[0].entity_id,contextual.entity_id);
    const [mention]=await run("SELECT * FROM research_query.entity_mentions WHERE document_id='doc:review'");
    const detail=await reviewDetail(run,{document_id:mention.document_id,mention_key:mention.mention_key,q:'Alpha'});
    assert.equal(detail.affected_documents,1);assert.equal(detail.blocks[0].pdf_page,3);
    const request={document_id:mention.document_id,revision_id:'v1',entity_type:'company',normalized_name:mention.normalized_name,action:'confirm',entity_ids:[a.entity_id],
      evidence:[{entity_id:a.entity_id,block_id:'block:fixture',quote:'谜语指 Alpha'}],reason:'Fixture review',expected_review_id:'0'};
    await assert.rejects(saveReview(db,{...request,evidence:[{...request.evidence[0],quote:'fabricated'}]},governed),/引用/);
    const first=await saveReview(db,request,governed);assert.equal(first.index_pending,false);
    await assert.rejects(saveReview(db,request,governed),/已有新操作/);
    assert.equal((await run("SELECT entity_id FROM research_query.document_entities WHERE document_id='doc:review'"))[0].entity_id,a.entity_id);
    assert.equal((await reviewQueue(run,{q:'谜语'})).results.length,0);
    const split=await saveReview(db,{...request,action:'split',entity_ids:[a.entity_id,b.entity_id],expected_review_id:first.review_id,
      evidence:[...request.evidence,{entity_id:b.entity_id,block_id:'block:fixture',quote:'谜语指 Beta'}]},governed);
    assert.equal((await run("SELECT entity_id FROM research_query.document_entities WHERE document_id='doc:review'")).length,2);
    const revoke=await saveReview(db,{...request,action:'revoke',entity_ids:[],evidence:[],expected_review_id:split.review_id},governed);
    assert.equal((await reviewQueue(run,{q:'谜语'})).results.length,1);
    const rejected=await saveReview(db,{...request,action:'reject',evidence:[],expected_review_id:revoke.review_id},governed);
    assert.equal((await reviewQueue(run,{q:'谜语'})).results.length,0);
    assert.equal((await reviewDetail(run,{document_id:mention.document_id,mention_key:mention.mention_key,q:'Alpha'})).candidates.length,0);
    await db`UPDATE research_query.documents SET revision_id='v2' WHERE document_id='doc:review'`;
    await assert.rejects(saveReview(db,{...request,expected_review_id:rejected.review_id},governed),/版本已变化/);
    await refreshGraphIndex(db,governed);assert.equal((await reviewQueue(run,{q:'谜语'})).results.length,1);
    const issuer=await graphQuery(run,{seed:{kind:'entity',id:security.entity_id},relation_types:['issued_by']},null);
    assert.equal(issuer.results.length,1);assert.equal(issuer.results[0].target.id,a.entity_id);assert.equal(issuer.results[0].provenance.validity_known,false);
    assert.equal((await graphQuery(run,{seed:{kind:'entity',id:security.entity_id},relation_types:['issued_by'],relation_as_of:'2026-09-18'},null)).results.length,0);
    assert.equal((await graphQuery(run,{seed:{kind:'entity',id:b.entity_id},relation_types:['subsidiary_of'],relation_as_of:'2026-09-18'},null)).results.length,1);
    assert.equal((await graphQuery(run,{seed:{kind:'entity',id:b.entity_id},relation_types:['subsidiary_of'],relation_as_of:'2025-09-18'},null)).results.length,0);
    assert.equal((await graphQuery(run,{seed:{kind:'entity',id:b.entity_id},relation_types:['subsidiary_of']},{field:'research_category',op:'eq',value:'nonexistent'})).results.length,0);
  } finally {
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await closeDb();
  }
});
