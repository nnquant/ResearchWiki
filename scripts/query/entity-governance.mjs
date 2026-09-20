import { loadRegistry } from './entities.mjs';
import { resolveEntities } from './graph-query.mjs';
import { keys, text, integer, strings, fail } from './contract.mjs';
import { refreshGraphIndex } from './graph-index.mjs';

export async function reviewQueue(run,{q='',offset=0,status='pending'}={}) {
  integer(offset,0,0,100000,'offset');
  if(!['pending','reviewed','all'].includes(status)) fail('INVALID_ARGUMENT','未知队列状态');
  const pattern=`%${String(q).slice(0,200).replace(/[\\%_]/g,'\\$&')}%`;
  const rows=await run(`SELECT DISTINCT ON (m.entity_type,m.normalized_name,m.document_id) m.*,d.title,d.slug,coalesce(r.review_id,0)::text AS review_id,r.action AS review_action
    FROM research_query.entity_mentions m JOIN research_query.documents d ON d.document_id=m.document_id AND d.revision_id=m.revision_id
    LEFT JOIN LATERAL (SELECT review_id,action FROM research_query.entity_reviews r WHERE r.document_id=m.document_id AND r.revision_id=m.revision_id
      AND r.entity_type=m.entity_type AND r.normalized_name=m.normalized_name ORDER BY review_id DESC LIMIT 1) r ON true
    WHERE NOT d.deleted AND m.normalized_name ILIKE $1 AND
      ($3='all' OR ($3='pending' AND m.status<>'curated' AND (r.action IS NULL OR r.action='revoke')) OR ($3='reviewed' AND r.action IS NOT NULL AND r.action<>'revoke'))
    ORDER BY m.entity_type,m.normalized_name,m.document_id,m.field,m.mention_key LIMIT 51 OFFSET $2`,[pattern,offset,status]);
  return {results:rows.slice(0,50),next_offset:rows.length>50?offset+50:null};
}

export async function reviewDetail(run,input) {
  const [mention]=await run(`SELECT m.*,d.title,d.slug FROM research_query.entity_mentions m JOIN research_query.documents d
    ON d.document_id=m.document_id AND d.revision_id=m.revision_id WHERE NOT d.deleted AND m.document_id=$1 AND m.mention_key=$2`,
    [text(input.document_id,'document_id',500),text(input.mention_key,'mention_key',100)]);
  if(!mention) fail('NOT_FOUND','材料或名称已变化，请刷新队列',404);
  const history=await run(`SELECT * FROM research_query.entity_reviews WHERE document_id=$1 AND revision_id=$2 AND entity_type=$3 AND normalized_name=$4 ORDER BY review_id DESC LIMIT 20`,
    [mention.document_id,mention.revision_id,mention.entity_type,mention.normalized_name]);
  const q=input.q?text(input.q,'q',200):mention.normalized_name;
  const candidates=await resolveEntities(run,{q,entity_type:mention.entity_type},null);
  // Context candidates are deliberately not global aliases, so fetch their stable IDs explicitly.
  const explicit=await run(`SELECT entity_id,name,entity_type,status,details->>'source' AS source FROM research_query.entities WHERE entity_id=ANY($1::text[]) AND status='curated'`,[mention.candidates]);
  const rejectionRows=await run(`SELECT entity_id FROM research_query.entity_rejections WHERE document_id=$1 AND revision_id=$2 AND entity_type=$3 AND normalized_name=$4`,
    [mention.document_id,mention.revision_id,mention.entity_type,mention.normalized_name]);
  const rejected=new Set(rejectionRows.map(r=>r.entity_id));
  const entities=[...new Map([...explicit,...candidates.results].filter(e=>e.status==='curated'&&!rejected.has(e.entity_id)).map(e=>[e.entity_id,e])).values()].slice(0,30);
  const blocks=await run(`SELECT block_id,pdf_page,ordinal,substring(text FROM greatest(1,strpos(lower(text),$3)-200) FOR 1800) AS text FROM research_query.blocks
    WHERE document_id=$1 AND revision_id=$2 ORDER BY (strpos(lower(text),$3)>0) DESC,ordinal LIMIT 5`,[mention.document_id,mention.revision_id,mention.normalized_name]);
  return {mention,candidates:entities,blocks,history,review_id:String(history[0]?.review_id??0),affected_documents:1,
    scope:'Only this material revision; all occurrences of this typed metadata name. Raw metadata is preserved.'};
}

export async function saveReview(sql,input,registry=null) {
  keys(input,['document_id','revision_id','entity_type','normalized_name','action','entity_ids','evidence','reason','expected_review_id']);
  const action=text(input.action,'action',20);
  if(!['confirm','split','defer','reject','revoke'].includes(action)) fail('INVALID_ARGUMENT','未知治理操作');
  const ids=strings(input.entity_ids??[],'entity_ids',5),reason=text(input.reason,'reason',2000);
  if((action==='confirm'&&ids.length!==1)||(action==='split'&&ids.length<2)||(action==='reject'&&!ids.length)) fail('INVALID_ARGUMENT','请选择相应实体；拆分需要至少两个实体');
  if(['defer','revoke'].includes(action)&&ids.length) fail('INVALID_ARGUMENT','暂缓/撤销不能附带实体');
  registry??=await loadRegistry();
  if(ids.some(id=>registry.entities.get(id)?.type!==input.entity_type)) fail('INVALID_ARGUMENT','目标必须为同类型的已确认实体');
  if(!Array.isArray(input.evidence)||input.evidence.length>10) fail('INVALID_ARGUMENT','evidence 必须为最多10条原文证据');
  for(const e of input.evidence) { keys(e,['entity_id','block_id','quote']);text(e.block_id,'block_id',100);text(e.quote,'quote',1800);if(!ids.includes(e.entity_id)) fail('INVALID_ARGUMENT','证据实体不在选择范围内'); }
  if(['confirm','split'].includes(action)&&ids.some(id=>!input.evidence.some(e=>e.entity_id===id))) fail('INVALID_ARGUMENT','每个确认实体需要该版本的原文证据');
  const result=await sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(78314027)`;
    const [doc]=await tx`SELECT revision_id FROM research_query.documents WHERE document_id=${text(input.document_id,'document_id',500)} AND NOT deleted FOR UPDATE`;
    if(!doc||doc.revision_id!==input.revision_id) fail('STALE_REVIEW','材料版本已变化，请重新核验',409);
    const [mention]=await tx`SELECT 1 FROM research_query.entity_mentions WHERE document_id=${input.document_id} AND revision_id=${input.revision_id}
      AND entity_type=${text(input.entity_type,'entity_type',30)} AND normalized_name=${text(input.normalized_name,'normalized_name',500)} LIMIT 1`;
    if(!mention) fail('STALE_REVIEW','名称已变化，请刷新',409);
    const [last]=await tx`SELECT review_id FROM research_query.entity_reviews WHERE document_id=${input.document_id} AND revision_id=${input.revision_id}
      AND entity_type=${input.entity_type} AND normalized_name=${input.normalized_name} ORDER BY review_id DESC LIMIT 1`;
    if(String(last?.review_id??0)!==String(input.expected_review_id)) fail('STALE_REVIEW','此条已有新操作，请刷新后重试',409);
    for(const e of input.evidence) {
      const [block]=await tx`SELECT 1 FROM research_query.blocks WHERE document_id=${input.document_id} AND revision_id=${input.revision_id} AND block_id=${e.block_id} AND strpos(text,${e.quote})>0`;
      if(!block) fail('INVALID_EVIDENCE','引用必须来自当前材料版本的指定原文块');
    }
    const [saved]=await tx`INSERT INTO research_query.entity_reviews(document_id,revision_id,entity_type,normalized_name,action,entity_ids,evidence,reason)
      VALUES (${input.document_id},${input.revision_id},${input.entity_type},${input.normalized_name},${action},${ids},${tx.json(input.evidence)},${reason}) RETURNING review_id`;
    if(action==='revoke'||['confirm','split'].includes(action)) await tx`DELETE FROM research_query.entity_rejections
      WHERE document_id=${input.document_id} AND revision_id=${input.revision_id} AND entity_type=${input.entity_type} AND normalized_name=${input.normalized_name}
      AND (${action==='revoke'} OR entity_id=ANY(${ids}::text[]))`;
    if(action==='reject') for(const id of ids) await tx`INSERT INTO research_query.entity_rejections(document_id,revision_id,entity_type,normalized_name,entity_id,review_id)
      VALUES (${input.document_id},${input.revision_id},${input.entity_type},${input.normalized_name},${id},${saved.review_id})
      ON CONFLICT(document_id,revision_id,entity_type,normalized_name,entity_id) DO UPDATE SET review_id=excluded.review_id`;
    await tx`DELETE FROM research_query.graph_documents WHERE document_id=${input.document_id}`;
    return saved;
  });
  // Durable review + invalidation commit together. A refresh failure can be retried safely by the normal index worker.
  try {return {...result,index:await refreshGraphIndex(sql,registry),index_pending:false};}
  catch {return {...result,index_pending:true};}
}
