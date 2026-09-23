import fs from 'node:fs/promises';
import path from 'node:path';
import {dictionaryKey,publisherFor} from './report-dictionaries.mjs';
import {authorCandidates} from './foreign-report-naming.mjs';
import {analystId} from './report-identity.mjs';
const [inventory,cache]=process.argv.slice(2);if(!inventory||!cache)throw new Error('inventory and PDF evidence cache required');
const file=new URL('../config/report-dictionaries.json',import.meta.url),dict=JSON.parse(await fs.readFile(file,'utf8'));
const rows=JSON.parse(await fs.readFile(inventory,'utf8')),groups=new Map();let missing=0;
for(const row of rows){
  const broker=publisherFor(row,{dict});if(!broker?.foreign)continue;
  const pdf=await fs.readFile(path.join(cache,row.sha256+'.json'),'utf8').then(JSON.parse).catch(()=>null);if(!pdf){missing++;continue;}
  const front=pdf.sample_pages?.find(p=>p.page<=4&&(p.text.match(/[A-Za-z]/g)?.length??0)>200&&!/本文由ima/.test(p.text));if(!front)continue;
  for(const candidate of authorCandidates(front,row)){
    const key=broker.id+':'+(candidate.email?.toLowerCase()??dictionaryKey(candidate.name));
    const group=groups.get(key)??{institution:broker.id,names:new Map(),aliases:new Set(),evidence:[],email:candidate.email??null};
    group.names.set(candidate.name,(group.names.get(candidate.name)??0)+1);group.aliases.add(candidate.raw);group.aliases.add(candidate.name);
    if(group.evidence.length<3)group.evidence.push({document_id:row.id,page:candidate.page,quote:candidate.raw,email:candidate.email??null});groups.set(key,group);
  }
  // Bootstrap only publisher-aligned aliases that explicitly contain a known
  // full brand. Runtime normalization never learns or inserts new aliases.
  const actual=dict.institutions.find(b=>b.id===broker.id);
  for(const value of row.institutions??[]){
    if(actual.aliases.includes(value))continue;
    if(dict.institutions.some(b=>b.id!==actual.id&&b.aliases.includes(value)))continue;
    const key=dictionaryKey(value);
    const brands=actual.aliases.filter(a=>/^[A-Za-z]/.test(a)&&dictionaryKey(a).length>=5);
    if(brands.some(a=>key.startsWith(dictionaryKey(a))))actual.aliases.push(value);
  }
}
const authors=[];
for(const group of groups.values()){
  const name=[...group.names].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0][0];
  const duplicate=authors.find(a=>a.id===analystId(name)+'@'+group.institution);
  if(duplicate){duplicate.aliases=[...new Set([...duplicate.aliases,...group.aliases])];duplicate.evidence=[...duplicate.evidence,...group.evidence].slice(0,6);continue;}
  const parts=name.split(/\s+/);let surname=parts.at(-1);if(parts.length>2&&/^(?:van|von|de|del|da|dos|vom)$/i.test(parts.at(-2)))surname=parts.at(-2)+'-'+surname;
  surname=surname.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9-]/g,'');
  if(!surname)continue;
  authors.push({id:analystId(name)+'@'+group.institution,analyst_id:analystId(name),institution:group.institution,name,surname,aliases:[...group.aliases],evidence:group.evidence});
}
dict.authors=authors.sort((a,b)=>a.id.localeCompare(b.id));dict.bootstrap={at:new Date().toISOString(),source:'PDF author signatures and verified existing author names',documents:rows.length,missing_pdf_cache:missing};
await fs.writeFile(file,JSON.stringify(dict,null,2)+'\n');console.log(JSON.stringify({institutions:dict.institutions.length,authors:dict.authors.length,missing_pdf_cache:missing}));
