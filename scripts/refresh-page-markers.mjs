import fs from 'node:fs/promises';
import path from 'node:path';
import {manifest,manifestPath,dataPath,repo,root,config,run,atomicJson,assetUrl,withLock,slash} from './common.mjs';
import { sharedConnection, createSharedClient } from './shared-api-client.mjs';
await withLock(async()=>{
 const m=await manifest();
 for(const doc of Object.values(m.documents).filter(x=>x.parser==='MinerU')) {
   const out=dataPath('parsed',doc.id,doc.revision);
   const md=dataPath(doc.parsed_path),paged=path.join(path.dirname(md),'pages.md');
   if (!(await fs.access(paged).then(()=>true,()=>false))) {
     const shared = sharedConnection(config, root);
     if (shared) await createSharedClient(shared).parsePdf(await fs.readFile(dataPath(doc.raw_path)),out);
     else await run(dataPath('runtime','mineru','Scripts','python.exe'),[path.join(repo,'scripts','parse_pdf.py'),dataPath(doc.raw_path),out,'--pages-only']);
   }
   let text=await fs.readFile(paged,'utf8');
   text=text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,(_,alt,target)=>`![${alt}](${assetUrl(path.resolve(path.dirname(md),target))})`);
   const file=dataPath('wiki',doc.wiki_slug+'.md'),old=await fs.readFile(file,'utf8');
   const marker='\n\n---\n\n',cut=old.indexOf(marker);
   if(cut<0)throw new Error('Wiki source wrapper missing');
   await fs.writeFile(file,old.slice(0,cut+marker.length)+text);
   doc.paged_path=slash(path.relative(dataPath(),paged));doc.status='parsed';
 }
 await atomicJson(manifestPath,m);
});
console.log('页号已添加到 GBrain 正文；原始 MinerU Markdown 不变');
