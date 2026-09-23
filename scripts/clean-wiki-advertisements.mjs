import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import {dataPath,sha,now,atomicJson,withLock} from './common.mjs';
import {atomicRename} from './atomic-rename.mjs';
import {cleanWikiAds,CLEANUP_VERSION} from './wiki-ad-cleanup.mjs';
import rules from '../config/wiki-ad-cleanup.json' with {type:'json'};

const folder=path.resolve('work/wiki-ad-cleanup-20260923');
const apply=process.argv.includes('--apply');
await fs.mkdir(folder,{recursive:true});
if(apply){
  try{await fs.access(path.join(folder,'result.json'));throw new Error('此批次已存在执行结果；请保留备份与日志，使用新批次目录处理后续清理。');}catch(e){if(e.code!=='ENOENT')throw e;}
}
const summary={version:CLEANUP_VERSION,started_at:now(),mode:apply?'apply':'preview',scanned:0,changed:0,unchanged:0,text_fragments:0,images:0,empty_ad_pages:0,removed_chars:0,errors:[],residual_documents:0};
const plan=[],residuals=[];
async function processWiki(){
  if(apply){
    for(const service of ['article-enrichment','report-discovery']){
      const pause=await fs.readFile(dataPath('state',service,'pause'),'utf8');
      if(pause.trim()!=='wiki-ad-cleanup-20260923')throw new Error('Missing owned maintenance pause: '+service);
      try{await fs.access(dataPath('state',service,'worker.lock'));throw new Error('Worker is still running: '+service);}catch(e){if(e.code!=='ENOENT')throw e;}
    }
    await fs.mkdir(path.join(folder,'backup'),{recursive:true});
  }
  for(const name of await fs.readdir(dataPath('wiki','sources'))){
    if(!/^[a-f0-9]+\.md$/.test(name))continue;
    const file=dataPath('wiki','sources',name),original=await fs.readFile(file,'utf8');
    const parsed=matter(original,{});if(parsed.data.type!=='source'||!/^## PDF 第 \d+ 页\r?$/m.test(parsed.content))continue;
    summary.scanned++;
    const result=cleanWikiAds(parsed.content,rules);
    if(!result.changed){summary.unchanged++;continue;}
    const remaining=result.body.split(/\r?\n/).filter(l=>/爱分享|390278005|免费代[查具]|Love Sharing/i.test(l));
    if(remaining.length){summary.residual_documents++;residuals.push({file:name,lines:remaining});}
    const counts={text:0,image:0,empty_ad_page:0};for(const r of result.removed)counts[r.kind]++;
    const record={file:name,slug:'sources/'+name.slice(0,-3),before_sha256:sha(original),before_body_sha256:sha(parsed.content),after_body_sha256:sha(result.body),removed_chars:parsed.content.length-result.body.length,counts};
    if(record.removed_chars<0)throw new Error('Cleanup unexpectedly adds content: '+name);
    const header=original.slice(0,original.length-parsed.content.length);
    if(!header.endsWith('---\n')&&!header.endsWith('---\r\n'))throw new Error('Unrecognized YAML delimiter: '+name);
    if(parsed.data.wiki_ad_cleanup)throw new Error('Existing cleanup marker with new edits requires a new migration: '+name);
    const marker=`wiki_ad_cleanup:\n  version: ${CLEANUP_VERSION}\n  cleaned_at: '${summary.started_at}'\n  original_body_sha256: ${record.before_body_sha256}\n`;
    const updated=header.replace(/---\r?\n$/,marker+'---\n')+result.body;
    record.after_sha256=sha(updated);
    if(apply){
      const backup=path.join(folder,'backup',name);
      try{await fs.writeFile(backup,original,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||sha(await fs.readFile(backup,'utf8'))!==record.before_sha256)throw e;}
      // Journal and originals are durable before replacing the Wiki derivative.
      await fs.appendFile(path.join(folder,'journal.jsonl'),JSON.stringify({...record,removed:result.removed})+'\n');
      if(sha(await fs.readFile(file,'utf8'))!==record.before_sha256)throw new Error('Concurrent Wiki edit: '+name);
      const temp=file+'.ad-cleanup.tmp';await fs.writeFile(temp,updated);await atomicRename(temp,file);
      if(sha(await fs.readFile(file,'utf8'))!==record.after_sha256)throw new Error('Post-write mismatch: '+name);
    }
    plan.push(record);summary.changed++;summary.text_fragments+=counts.text;summary.images+=counts.image;summary.empty_ad_pages+=counts.empty_ad_page;summary.removed_chars+=record.removed_chars;
    if(summary.scanned%1000===0)console.log(JSON.stringify({scanned:summary.scanned,changed:summary.changed}));
  }
}
try{if(apply)await withLock(processWiki);else await processWiki();}
catch(e){summary.errors.push(e.message);process.exitCode=1;}
summary.finished_at=now();
await atomicJson(path.join(folder,apply?'result.json':'preview.json'),{...summary,documents:plan});
await atomicJson(path.join(folder,apply?'residuals.json':'preview-residuals.json'),residuals);
console.log(JSON.stringify(summary,null,2));
