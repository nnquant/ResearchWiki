// Preserve existing chunk boundaries and vectors; update only spans actually deleted.
import fs from 'node:fs/promises';import path from 'node:path';import matter from 'gray-matter';
import {cleanWikiAds,chunkProjector} from './wiki-ad-cleanup.mjs';
import {getSql,closeDb} from './server/db.mjs';
import {dataPath,sha,now,atomicJson} from './common.mjs';
import {contentHash} from '../vendor/gbrain/src/core/utils.ts';
const folder=path.resolve('work/wiki-ad-cleanup-20260923'),apply=process.argv.includes('--apply');
const rules=JSON.parse(await fs.readFile('config/wiki-ad-cleanup.json','utf8'));
const migration=JSON.parse(await fs.readFile(path.join(folder,'result.json'),'utf8'));
const journal=path.join(folder,'projection-progress.jsonl');
const done=new Set((await fs.readFile(journal,'utf8').catch(()=>'' )).split('\n').filter(Boolean).map(x=>JSON.parse(x)).map(x=>x.slug));
const stats={started_at:now(),mode:apply?'apply':'preview',total:migration.documents.length,processed:done.size,changed_pages:0,updated_chunks:0,removed_chunks:0,unchanged_chunks:0,not_indexed:0,errors:[] as any[]};
let cursor=0;
const sql=await getSql();
try{
 if(apply){
  for(const service of ['article-enrichment','report-discovery']){
   if((await fs.readFile(dataPath('state',service,'pause'),'utf8')).trim()!=='wiki-ad-cleanup-20260923')throw new Error('Missing maintenance pause');
   try{await fs.access(dataPath('state',service,'worker.lock'));throw new Error('Worker still running');}catch(e:any){if(e.code!=='ENOENT')throw e;}
  }
  await fs.mkdir(path.join(folder,'gbrain-backup'),{recursive:true});
 }
 async function worker(){while(cursor<migration.documents.length){
  const record=migration.documents[cursor++];if(done.has(record.slug))continue;
  try{
   const text=await fs.readFile(dataPath('wiki',record.slug+'.md'),'utf8');if(sha(text)!==record.after_sha256)throw new Error('Wiki changed since migration');
   const fm=matter(text,{}).data;
   const [page]=await sql`SELECT id,slug,title,type,compiled_truth,timeline,frontmatter,content_hash,updated_at FROM pages WHERE slug=${record.slug} AND source_id='default' AND deleted_at IS NULL`;
   if(!page){stats.not_indexed++;stats.processed++;if(apply)await fs.appendFile(journal,JSON.stringify({slug:record.slug,status:'not_indexed'})+'\n');continue;}
   const cleanup=cleanWikiAds(page.compiled_truth,{...rules,trace:true});
   const chunks=await sql`SELECT id,chunk_index,chunk_text,chunk_source FROM content_chunks WHERE page_id=${page.id} ORDER BY chunk_index`;
   const project=chunkProjector(page.compiled_truth,cleanup),updated:any[]=[],deleted:any[]=[];
   for(const c of chunks){const clean=project(c.chunk_text);if(clean===c.chunk_text){stats.unchanged_chunks++;continue;}if(!clean.trim())deleted.push(c.id);else updated.push({id:c.id,text:clean,tokens:Math.ceil(clean.length/4)});}
   const tags=await sql`SELECT tag FROM tags WHERE page_id=${page.id}`;
   const frontmatter={...page.frontmatter,wiki_ad_cleanup:fm.wiki_ad_cleanup};
   const hash=contentHash({...page,compiled_truth:cleanup.body,frontmatter,tags:tags.map(x=>x.tag)});
   if(apply)await sql.begin(async tx=>{
    const [locked]=await tx`SELECT content_hash,compiled_truth,updated_at FROM pages WHERE id=${page.id} FOR UPDATE`;
    if(locked.content_hash!==page.content_hash||locked.compiled_truth!==page.compiled_truth||+locked.updated_at!==+page.updated_at)throw new Error('Concurrent index edit');
    const touched=[...updated.map(x=>x.id),...deleted];
    const before=touched.length?await tx`SELECT * FROM content_chunks WHERE page_id=${page.id} AND id=ANY(${touched}::int[])`:[];
    try{await fs.writeFile(path.join(folder,'gbrain-backup',page.id+'.json'),JSON.stringify({page,chunks:before})+'\n',{flag:'wx'});}catch(e:any){if(e.code!=='EEXIST')throw e;}
    await tx`UPDATE pages SET compiled_truth=${cleanup.body},frontmatter=${tx.json(frontmatter)},content_hash=${hash},updated_at=now() WHERE id=${page.id}`;
    if(updated.length)await tx`UPDATE content_chunks c SET chunk_text=x.text,embedding=NULL,embedded_at=NULL,embedded_text_hash=NULL,token_count=x.tokens FROM jsonb_to_recordset(${tx.json(updated)}) AS x(id int,text text,tokens int) WHERE c.id=x.id AND c.page_id=${page.id}`;
    if(deleted.length)await tx`DELETE FROM content_chunks WHERE page_id=${page.id} AND id=ANY(${deleted}::int[])`;
   });
   stats.changed_pages++;stats.updated_chunks+=updated.length;stats.removed_chunks+=deleted.length;stats.processed++;
   if(apply)await fs.appendFile(journal,JSON.stringify({slug:record.slug,status:'content_synced',updated_chunks:updated.length,removed_chunks:deleted.length})+'\n');
   if(stats.processed%250===0){console.log(JSON.stringify(stats));await atomicJson(path.join(folder,'projection-status.json'),stats);}
  }catch(e:any){stats.errors.push({slug:record.slug,error:e.message});}
 }}
 await Promise.all(Array.from({length:4},()=>worker()));
 await atomicJson(path.join(folder,apply?'projection-result.json':'projection-preview.json'),{...stats,finished_at:now()});console.log(JSON.stringify(stats));if(stats.errors.length)process.exitCode=1;
}finally{await closeDb();}
