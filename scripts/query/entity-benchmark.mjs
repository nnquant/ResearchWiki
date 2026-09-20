import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadRegistry,normalizeEntityName } from './entities.mjs';
import { resolveDocumentMention } from './entity-context.mjs';
export function evaluateEntityCases(registry,cases) {
  const results=cases.map(c=>{
    const r=resolveDocumentMention({type:c.type,name:c.name,normalized:normalizeEntityName(c.name),field:'fixture',raw:c.name},registry,
      {complete:c.complete!==false,blocks:c.body?[{text:c.body,block_id:'fixture',pdf_page:1}]:[]});
    const actual=r.status==='curated'?r.entity.entity_id:null;
    return {...c,actual,passed:actual===c.expected};
  });
  const tp=results.filter(r=>r.expected&&r.passed).length,fp=results.filter(r=>r.actual&&!r.passed).length,positive=results.filter(r=>r.expected).length;
  return {cases:results.length,passed:results.filter(r=>r.passed).length,false_merges:fp,precision:tp+fp?tp/(tp+fp):null,
    identity_recall:positive?tp/positive:null,note:'Curated regression cases, not an estimate of full-library accuracy or document retrieval recall.',results};
}
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const registry=await loadRegistry(),cases=JSON.parse(await fs.readFile(new URL('../../tests/fixtures/entity-quality.json',import.meta.url),'utf8'));
  const report={created_at:new Date().toISOString(),quality:evaluateEntityCases(registry,cases),performance:[]};
  if(process.argv.includes('--live')) {
    const {execute}=await import('./service.mjs');
    for(const [operation,input] of [['resolve',{q:'腾讯',kind:'entity',entity_type:'company'}],['graph',{seed:{kind:'entity',id:'entity:company:tencent'},depth:1,max_nodes:80,max_edges:150}],['search',{query:'资本开支',entity_name:'腾讯',entity_type:'company',mode:'lexical'}],['search',{query:'TPU',entity_name:'TPU',entity_type:'subfield',mode:'lexical'}]]) {
      const times=[],errors=[];let first=null,returned=0;
      for(let i=0;i<11;i++) {
        const start=performance.now();try {const result=await execute(operation,{...input,limit:5,max_response_tokens:12000,timeout_ms:30000});returned=result.returned_count;
          if(i===0)first=performance.now()-start;else times.push(performance.now()-start);
        } catch(e) {errors.push(e.message);}
      }
      report.performance.push({operation,input,first_request_ms:first,samples:times.length,p50_ms:times.length?percentile(times,.5):null,p95_ms:times.length?percentile(times,.95):null,returned,errors});
    }
    report.performance_note='Sequential single-client observations; first request is not guaranteed cold-cache. No concurrency/load-capacity claim.';
    const {closeDb}=await import('../server/db.mjs');await closeDb();
  }
  const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);
  if(output) await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(report.quality.passed!==report.quality.cases||report.performance.some(p=>p.errors.length))process.exitCode=1;
}
