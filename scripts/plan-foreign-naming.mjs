import fs from 'node:fs/promises';
import path from 'node:path';
import {buildForeignName,withParsedNamingFallback} from './foreign-report-naming.mjs';
const [inventory,cache,output]=process.argv.slice(2);if(!output)throw new Error('inventory cache output required');
const rows=JSON.parse(await fs.readFile(inventory,'utf8')),plan=[];
for(const row of rows){
  let pdf=await fs.readFile(path.join(cache,row.sha256+'.json'),'utf8').then(JSON.parse).catch(()=>({error:'PDF evidence missing'}));
  if(row.parsed_path)pdf=withParsedNamingFallback(pdf,await fs.readFile(row.parsed_path,'utf8').catch(()=>''));
  let result;try{result=buildForeignName(row,pdf,{mtime:(await fs.stat(row.raw_path)).mtime.toISOString()});}catch(error){result={status:'review',reason:error.message};}
  plan.push({id:row.id,sha256:row.sha256,old_filename:row.filename,raw_path:row.raw_path,source_file:row.source_meta?.import_path,source_files:row.source_files??[],exports:row.exports??[],unregistered:row.unregistered??false,...result});
}
const counts={};for(const row of plan){const k=row.status==='ready'?'ready':row.reason;counts[k]=(counts[k]??0)+1;}
await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify({created_at:new Date().toISOString(),counts,rows:plan},null,2));
const csv=v=>'"'+String(v??'').replaceAll('"','""')+'"';
await fs.writeFile(output.replace(/\.json$/,'.csv'),'\ufeff'+[['document_id','status','old_filename','new_filename','date_source','broker','author','coverage','fallback','reason'].join(','),...plan.map(r=>[r.id,r.status,r.old_filename,r.filename,r.date_source,r.broker,r.author,r.coverage,JSON.stringify(r.fallback??[]),r.reason].map(csv).join(','))].join('\n'));
console.log(JSON.stringify({counts,samples:plan.filter(p=>p.status==='ready').slice(0,14).map(p=>({old:p.old_filename,new:p.filename,date_source:p.date_source,author_source:p.author_source}))}));
