import fs from 'node:fs/promises';import path from 'node:path';import matter from 'gray-matter';
import {manifest,manifestPath,atomicJson,readJson,dataPath,root,sha,assetUrl,withLock,now} from './common.mjs';
import {verifiedRename,applyNamingMetadata} from './apply-foreign-naming.mjs';
import {validateForeignFilename} from './foreign-report-naming.mjs';
import {within} from './report-batch-plan.mjs';
const args=process.argv.slice(2),planFile=args[0],apply=args.includes('--apply');if(!planFile)throw new Error('Require reviewed plan JSON');
const folder=path.dirname(planFile),plan=await readJson(planFile),resultFile=path.join(folder,'migration-result.json');
const conflicts=[],targets=new Map();
for(const row of plan.rows.filter(r=>r.status==='ready')){
  validateForeignFilename(row.filename);
  for(const file of [row.raw_path,...row.source_files,...row.exports.map(e=>e.pdf)]){
    const to=path.join(path.dirname(file),row.filename),key=to.toLowerCase(),previous=targets.get(key);
    if(previous&&previous!==row.sha256)conflicts.push({id:row.id,file:to,reason:'plan-collision'});targets.set(key,row.sha256);
    if(to!==file&&await fs.access(to).then(()=>true,()=>false)&&sha(await fs.readFile(to))!==row.sha256)conflicts.push({id:row.id,file:to,reason:'existing-file-collision'});
  }
}
await atomicJson(path.join(folder,'preflight.json'),{at:now(),ready:plan.rows.filter(r=>r.status==='ready').length,conflicts});
console.log(JSON.stringify({phase:'preflight',ready:plan.rows.filter(r=>r.status==='ready').length,conflicts:conflicts.length,apply}));
if(!apply)process.exit(0);
for(const service of ['report-discovery','article-enrichment']){
  if(await fs.access(dataPath('state',service,'worker.lock')).then(()=>true,()=>false))throw new Error('先排空后台队列：'+service);
  if((await fs.readFile(dataPath('state',service,'pause'),'utf8'))!=='foreign-naming-20260922')throw new Error('维护暂停标记不匹配');
}
await withLock(async()=>{
  const backup=path.join(folder,'backup');await fs.mkdir(backup,{recursive:true});
  try{await fs.copyFile(manifestPath,path.join(backup,'manifest.json'),fs.constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;}
  const m=await manifest(),done=await readJson(resultFile,{completed:[],review:[],excluded:[],failed:[]}),completed=new Set(done.completed.map(r=>r.id));
  const journal=path.join(folder,'rename-journal.jsonl');let since=0;
  const flush=async()=>{m.updated_at=now();await atomicJson(manifestPath,m);done.updated_at=now();await atomicJson(resultFile,done);since=0;};
  for(const row of plan.rows){
    if(completed.has(row.id))continue;
    if(row.status!=='ready'||conflicts.some(c=>c.id===row.id)){
      const list=row.status==='excluded'?done.excluded:done.review;if(!list.some(r=>r.id===row.id))list.push({id:row.id,reason:conflicts.some(c=>c.id===row.id)?'filename-collision':row.reason});continue;
    }
    try{
      const record=m.documents[row.id];if(record&&record.sha256!==row.sha256)throw new Error('原文版本已改变');
      const moves=[...new Set([row.raw_path,...row.source_files,...row.exports.map(e=>e.pdf)])].map(from=>({from,to:path.join(path.dirname(from),row.filename),keepAlias:within(dataPath('raw'),from)}));
      await fs.appendFile(journal,JSON.stringify({at:now(),id:row.id,sha256:row.sha256,phase:'intent',moves})+'\n');
      for(const move of moves)await verifiedRename(move.from,move.to,row.sha256,{keepAlias:move.keepAlias});
      const {source_files,exports,raw_path,source_file,unregistered,id,sha256,old_filename,...naming}=row;
      if(record){
        const oldRaw=record.raw_path,newRaw=path.join(path.dirname(oldRaw),row.filename).replaceAll('\\','/');
        const oldSource=record.source_meta?.import_path;
        const primarySource=row.source_files.find(f=>path.resolve(f)===path.resolve(oldSource??''))??row.source_files[0];
        record.raw_path=newRaw;record.source_meta={...record.source_meta,original_import_path:record.source_meta?.original_import_path??oldSource,import_path:primarySource?path.join(path.dirname(primarySource),row.filename):oldSource};
        applyNamingMetadata(record,naming);record.updated_at=now();
        if(record.wiki_slug){const wiki=dataPath('wiki',record.wiki_slug+'.md');
          if(await fs.access(wiki).then(()=>true,()=>false)){
            await fs.mkdir(path.join(backup,'wiki'),{recursive:true});try{await fs.copyFile(wiki,path.join(backup,'wiki',record.id+'.md'),fs.constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;}
            const original=await fs.readFile(wiki,'utf8'),parsed=matter(original),fm={...parsed.data,title:record.title,raw_path:newRaw,institutions:record.article_metadata.institutions,published_at:record.published_at,topic_primary:record.article_metadata.topic_primary};
            for(const key of ['authors','aliases'])if(record.article_metadata[key]!=null)fm[key]=record.article_metadata[key];
            const body=parsed.content.replaceAll(assetUrl(dataPath(oldRaw)),assetUrl(dataPath(newRaw))).replace(/^# [^\n]+/m,'# '+record.title).replace(/发布日期：[^。\n]*。/,'发布日期：'+record.published_at+'。');
            await fs.writeFile(wiki,matter.stringify('',fm).replace(/\n*$/,'\n')+body,'utf8');
          }
        }
        const provenance=path.join(path.dirname(dataPath(newRaw)),'provenance.json');
        await fs.mkdir(path.join(backup,'provenance'),{recursive:true});try{await fs.copyFile(provenance,path.join(backup,'provenance',record.id+'.json'),fs.constants.COPYFILE_EXCL);}catch(e){if(!['EEXIST','ENOENT'].includes(e.code))throw e;}
        await atomicJson(provenance,record);
      }
      for(const exp of row.exports){const report=await readJson(exp.report_file);await fs.mkdir(path.join(backup,'exports'),{recursive:true});const key=sha(exp.report_file).slice(0,24);try{await fs.copyFile(exp.report_file,path.join(backup,'exports',key+'.json'),fs.constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;}
        report.original_file=row.filename;report.canonical_filename=row.filename;report.naming=naming;report.title=row.report_key;
        if(report.source_file)report.source_file=path.join(path.dirname(report.source_file),row.filename);
        if(report.source_relative)report.source_relative=path.join(path.dirname(report.source_relative),row.filename).replaceAll('\\','/');
        await atomicJson(exp.report_file,report);
      }
      done.completed.push({id:row.id,filename:row.filename,files:moves.length,registered:!!record,at:now()});completed.add(row.id);
      await fs.appendFile(journal,JSON.stringify({at:now(),id:row.id,phase:'complete'})+'\n');
      if(++since>=250){await flush();console.log(JSON.stringify({completed:done.completed.length,failed:done.failed.length,review:done.review.length}));}
    }catch(error){done.failed.push({id:row.id,error:error.message,at:now()});}
  }
  await flush();
  console.log(JSON.stringify({completed:done.completed.length,registered:done.completed.filter(r=>r.registered).length,files:done.completed.reduce((n,r)=>n+r.files,0),review:done.review.length,excluded:done.excluded.length,failed:done.failed.length}));
});
