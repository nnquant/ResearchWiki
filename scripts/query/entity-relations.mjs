import { hash } from './blocks.mjs';
export const businessRelationTypes=['issued_by','subsidiary_of','product_of','supplies_to'];
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const source=value=>{try{return ['https:','http:'].includes(new URL(value).protocol);}catch{return false;}};
export function businessRelations(registry,input={}) {
  const relations=[];
  for(const e of registry.entities.values()) {
    if(e.type!=='security'||!e.issuer_id)continue;
    const url=e.issuer_source??e.source;
    const snapshot=input.sources?.find(s=>s.url===url);
    const observed_at=e.reviewed_at??snapshot?.retrieved_at?.slice(0,10);
    if(!source(url)||!date(observed_at))continue; // Do not invent historical dates from index time.
    relations.push({source_id:e.entity_id,target_id:e.issuer_id,relation_type:'issued_by',source:url,observed_at,
      valid_from:null,valid_to:null,evidence:{method:e.issuer_source?'reviewed_issuer_crosswalk':'official_security_directory',
        security_name:e.security_name??null,market:e.market,code:e.code,source_as_of:e.source_as_of??null,snapshot_sha256:snapshot?.sha256??null}});
  }
  for(const r of input.relations??[]) {
    if(!r||!businessRelationTypes.includes(r.relation_type)||!registry.entities.has(r.source_id)||!registry.entities.has(r.target_id)||r.source_id===r.target_id||
      !source(r.source)||!date(r.observed_at)||(!r.evidence?.quote?.trim())||r.evidence.quote.length>2000||
      (r.valid_from!=null&&!date(r.valid_from))||(r.valid_to!=null&&!date(r.valid_to))||(r.valid_to&&(!r.valid_from||r.valid_to<r.valid_from)))throw new Error('业务关系需要明确实体、关系、来源、核验日期和原文证据；有效期须明确且有序');
    const from=registry.entities.get(r.source_id).type,to=registry.entities.get(r.target_id).type;
    if((r.relation_type==='issued_by'&&(from!=='security'||to!=='company'))||
      (['subsidiary_of','supplies_to'].includes(r.relation_type)&&(from!=='company'||to!=='company'))||
      (r.relation_type==='product_of'&&(!['topic','subfield'].includes(from)||to!=='company')))throw new Error('业务关系实体类型不匹配');
    relations.push({...r,valid_from:r.valid_from??null,valid_to:r.valid_to??null,evidence:{...r.evidence,method:'reviewed_source'}});
  }
  return relations.map(r=>({...r,relation_id:`relation:${hash(JSON.stringify([r.source_id,r.target_id,r.relation_type,r.source,r.observed_at,r.valid_from,r.valid_to])).slice(0,32)}`}));
}
