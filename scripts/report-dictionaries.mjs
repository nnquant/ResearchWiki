import fs from 'node:fs';
const dictionaryFile=new URL('../config/report-dictionaries.json',import.meta.url);
// The dictionary is corpus-derived instance data kept out of git; without it naming falls back to source values.
export const hasReportDictionaries=fs.existsSync(dictionaryFile);
export const reportDictionaries=hasReportDictionaries?JSON.parse(fs.readFileSync(dictionaryFile,'utf8')):{version:'missing',institutions:[],ambiguous_institution_aliases:[],authors:[],institutional_authors:[],regions:[],sectors:[],languages:[],coverage_fallback:'Unknown',policy:{exact_alias_first:true,author_scope:'institution'}};
export const dictionaryKey=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[\s.,&'’()\-]+/g,'');
const indexes=new WeakMap();
export function dictionaryMatch(kind,value,{institution,dict=reportDictionaries}={}) {
  const key=dictionaryKey(value);if(!key)return null;
  let kinds=indexes.get(dict);if(!kinds){kinds=new Map();indexes.set(dict,kinds);}
  let index=kinds.get(kind);if(!index){index=new Map();for(const row of dict[kind]??[])for(const alias of new Set([row.id,row.name,...row.aliases??[]].filter(Boolean).map(dictionaryKey))){const rows=index.get(alias)??[];rows.push(row);index.set(alias,rows);}kinds.set(kind,index);}
  const found=(index.get(key)??[]).filter(row=>!institution||!row.institution||row.institution===institution);
  return found.length===1?found[0]:null;
}
export function publisherFor(record,{dict=reportDictionaries}={}) {
  if(record.source_meta?.report_category==='内资'||/(?:^|\/)reports\/raw1\//i.test(String(record.source_meta?.import_path??'').replaceAll('\\','/')))return null;
  if(record.naming?.broker){const row=dict.institutions.find(r=>r.id===record.naming.broker);if(row)return {...row,match_source:'verified-naming'};}
  const source=String(record.source_meta?.import_path??'').replaceAll('\\','/');
  const prefix=String(record.naming?.original_title??record.title??record.filename??'').normalize('NFKC').replace(/^\d{4}[-_.]?\d{2}[-_.]?\d{2}[-_\s—]*/, '').split(/[-_—]/)[0];
  for(const [value,sourceKind] of [[prefix,'title-prefix'],[source.split('/').at(-2),'publisher-directory']]){
    const row=dictionaryMatch('institutions',value,{dict});if(row)return {...row,match_source:sourceKind};
  }
  const matches=[...new Set((record.article_metadata?.institutions??record.institutions??[]).map(v=>dictionaryMatch('institutions',v,{dict})?.id).filter(Boolean))];
  return matches.length===1?{...dict.institutions.find(r=>r.id===matches[0]),match_source:'institution-alias'}:null;
}
export function normalizeBibliography(metadata,{institution,dict=reportDictionaries}={}) {
  const out={...metadata};
  if(Array.isArray(out.institutions))out.institutions=[...new Set(out.institutions.map(v=>dictionaryMatch('institutions',v,{dict})?.id??v))];
  institution??=out.institutions?.length===1?dictionaryMatch('institutions',out.institutions[0],{dict})?.id:undefined;
  if(Array.isArray(out.authors))out.authors=[...new Set(out.authors.map(v=>dictionaryMatch('authors',v,{institution,dict})?.name??v))];
  return out;
}
export function normalizeReportMetadata(record,metadata){
  const publisher=publisherFor(record);
  if(!publisher?.foreign||record.source_meta?.report_category==='内资')return metadata;
  const result=normalizeBibliography(metadata,{institution:publisher.id});
  const n=record.naming;
  if(n?.status==='ready'){
    result.institutions=[n.broker];
    if(n.authors?.length)result.authors=n.authors;
    result.published_at=n.date;
    const inferred=[...new Set((result.industries??[]).map(v=>dictionaryMatch('sectors',v)?.id).filter(Boolean))];
    result.topic_primary=n.topic==='Unknown'?(record.article_metadata?.topic_primary??(inferred.length===1?inferred[0]:null)):n.topic;
  }
  return result;
}
