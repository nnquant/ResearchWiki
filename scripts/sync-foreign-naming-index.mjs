import fs from 'node:fs/promises';import path from 'node:path';
import {manifest,readJson,atomicJson,now} from './common.mjs';
import {getSql,closeDb} from './server/db.mjs';
const folder=path.resolve(process.argv[2]??'work/foreign-naming-20260922');
const done=await readJson(path.join(folder,'migration-result.json')),m=await manifest();
const rows=done.completed.filter(r=>r.registered).map(r=>m.documents[r.id]).filter(r=>r?.naming?.status==='ready'&&r.wiki_slug);
try{
  const sql=await getSql(),backup=path.join(folder,'backup','page-metadata.jsonl');let count=0,missing=0;
  for(let i=0;i<rows.length;i+=100){const batch=rows.slice(i,i+100),slugs=batch.map(r=>r.wiki_slug);
    const previous=await sql`SELECT id,slug,title,frontmatter,updated_at FROM pages WHERE slug=ANY(${slugs}::text[]) AND deleted_at IS NULL`;
    await fs.appendFile(backup,previous.map(p=>JSON.stringify(p)).join('\n')+'\n');
    const found=new Set(previous.map(p=>p.slug));
    await sql.begin(async tx=>{for(const r of batch){if(!found.has(r.wiki_slug)){missing++;continue;}
      const fields={title:r.title,raw_path:r.raw_path,authors:r.article_metadata.authors??null,institutions:r.article_metadata.institutions,published_at:r.published_at,topic_primary:r.article_metadata.topic_primary,aliases:r.article_metadata.aliases};
      // Preserve page IDs, body chunks and their embeddings. This is a metadata
      // update; the versioned research-query projection is refreshed separately.
      await tx`UPDATE pages SET title=${r.title},frontmatter=COALESCE(frontmatter,'{}'::jsonb)||${tx.json(fields)},updated_at=now() WHERE slug=${r.wiki_slug} AND deleted_at IS NULL`;count++;
    }});
    if((i+100)%1000===0)console.log(JSON.stringify({updated:count,missing}));
  }
  const result={at:now(),updated:count,missing};await atomicJson(path.join(folder,'page-index-result.json'),result);console.log(JSON.stringify(result));
}finally{await closeDb();}
