// Local acceptance checks: read operations only; invalid writes test the CSRF boundary.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base='http://127.0.0.1:8018';
const status=await (await fetch(`${base}/api/status`)).json();
const call=async(op,input)=>{
  const response=await fetch(`${base}/api/research/${op}`,{method:'POST',headers:{'content-type':'application/json','x-wiki-token':status.csrf},
    body:JSON.stringify({...input,limit:5,max_response_tokens:12000,timeout_ms:30000}),signal:AbortSignal.timeout(35000)});
  const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;
};
const resolved=await call('resolve',{q:'TPU',kind:'entity',entity_type:'subfield'});
assert.equal(resolved.ambiguous,true);assert.ok(resolved.results.filter(r=>r.requires_context).length>=2);
const issuer=await call('graph',{seed:{kind:'entity',id:'entity:security:hk:00700'},relation_types:['issued_by'],direction:'outgoing'});
assert.equal(issuer.results[0].target.id,'entity:company:tencent');assert.ok(issuer.results[0].provenance.source.startsWith('https:'));
const historical=await call('graph',{seed:{kind:'entity',id:'entity:security:hk:00700'},relation_types:['issued_by'],relation_as_of:'2000-01-01'});
assert.equal(historical.results.length,0);
const fallback=await call('search',{query:'zzqv739281xnomatch',entity_name:'腾讯',entity_type:'company',mode:'lexical'});
assert.ok(fallback.results.length);assert.ok(fallback.results.every(r=>r.retrieval_route==='raw_name_fallback'&&r.identity_status==='needs_evidence'));
const unknown=await call('search',{query:'资本开支',entity_name:'zzqv739281xnomatch',entity_type:'company',mode:'lexical'});
assert.equal(unknown.results.length,0);assert.equal(unknown.entity_retrieval.status,'unresolved_or_ambiguous');
const filters={field:'research_category',op:'eq',value:'zzqv739281xnomatch'};
for(const name of ['腾讯','TPU']) {
  const scoped=await call('search',{query:'资本开支',entity_name:name,entity_type:name==='腾讯'?'company':'subfield',mode:'lexical',filters});
  assert.equal(scoped.results.length,0);assert.deepEqual(scoped.entity_retrieval.filters_preserved,filters);
}
const queue=await (await fetch(`${base}/api/entity-governance?q=TPU`)).json();
assert.ok(queue.results.length<=50);assert.equal(new Set(queue.results.map(r=>`${r.document_id}:${r.entity_type}:${r.normalized_name}`)).size,queue.results.length);
const exactContextMention=queue.results.find(r=>r.entity_type==='subfield'&&r.normalized_name==='tpu');
assert.ok(exactContextMention);
if(exactContextMention) {
  const m=exactContextMention;const detail=await (await fetch(`${base}/api/entity-governance/detail?${new URLSearchParams({document_id:m.document_id,mention_key:m.mention_key})}`)).json();
  assert.equal(detail.affected_documents,1);assert.ok(detail.blocks.length<=5);assert.ok(detail.candidates.length>=2);
}
const denied=await fetch(`${base}/api/entity-governance/review`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
assert.equal(denied.status,403);
const result={passed:true,context_candidates:resolved.results.map(({entity_id,requires_context})=>({entity_id,requires_context})),issuer:issuer.results[0],
  fallback_results:fallback.returned_count,filter_boundary_checked:true,queue_rows:queue.results.length,queue_deduplicated:true,csrf_write_denied:denied.status};
await fs.writeFile('work/entity-six-improvements/live-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
