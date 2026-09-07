import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ensureDirs,withLock,manifest,gb,dataPath,repo } from './common.mjs';
import { ingestFile,ingestUrl,importIma,indexWiki,parseRecord,updateArticleMetadata } from './ingest.mjs';
import { knowledgeBases } from './ima.mjs';
const args=process.argv.slice(2),[cmd,...rest]=args;
const option=(key,fallback)=>{const i=rest.indexOf(key);return i<0?fallback:rest[i+1];};
const metadata=async()=>{const file=option('--metadata-file',null);return file?JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,'')):{};};
try {
  await ensureDirs();let result;
  switch(cmd) {
    case 'serve': await import('./server.mjs');break;
    case 'init': await import('./init-brain.mjs');break;
    case 'ima-list':result=(await knowledgeBases(rest[0]||'群资料汇总')).map(x=>({name:x.kb_name||x.name,count:x.content_count}));break;
    case 'ima-import':result=await withLock(()=>importIma(option('--kb',undefined),Number(option('--limit',3)),{captureOnly:rest.includes('--capture-only'),nextOnly:rest.includes('--next')}));break;
    case 'import-dir':{
      const {config}=await import('./common.mjs');
      const {importDirectoryOnce,watchDirectory}=await import('./import-directory.mjs');
      const folder=rest[0]||config.directoryImport.path;
      result=await (rest.includes('--watch')?watchDirectory:importDirectoryOnce)(folder);break;
    }
    case 'add-file':if(!rest[0])throw new Error('缺少文件路径');result=await withLock(async()=>ingestFile(rest[0],{source_url:option('--source-url',null),source_kind:option('--kind','local'),metadata:await metadata()}));break;
    case 'add-url':if(!rest[0])throw new Error('缺少链接');result=await withLock(async()=>ingestUrl(rest[0],{metadata:await metadata()}));break;
    case 'set-metadata':if(!rest[0]||!option('--metadata-file',null))throw new Error('用法：set-metadata <文献ID或slug> --metadata-file <JSON文件>');result=await withLock(async()=>updateArticleMetadata(rest[0],await metadata()));break;
    case 'parse-pending':result=await withLock(async()=>{
      const m=await manifest(),out=[];
      for(const d of Object.values(m.documents).filter(x=>['captured','failed','parsing','processing'].includes(x.status))) {
        console.log(`正在解析：${d.title}`);
        try {const done=await parseRecord(d);out.push({title:done.title,status:done.status,pages:done.pages});}
        catch(e){out.push({title:d.title,status:'failed',error:e.message});}
      }return out;
    });break;
    case 'index':result=await withLock(indexWiki);break;
    case 'search':{const r=await gb(['query',rest.join(' '),'--json']);process.stdout.write(r.stdout);break;}
    case 'status':{const m=await manifest();result={documents:Object.values(m.documents).map(x=>({title:x.title,status:x.status,pages:x.pages,characters:x.characters,parser:x.parser})),dataRoot:dataPath()};break;}
    case 'gbrain':{const r=await gb(rest,{timeout:3600000});process.stdout.write(r.stdout);process.stderr.write(r.stderr);break;}
    default: console.log('投资研究 Wiki\n  node scripts/wiki.mjs serve\n  node scripts/wiki.mjs add-file <PDF|HTML|MD> [--source-url URL]\n  node scripts/wiki.mjs add-url <URL>\n  node scripts/wiki.mjs ima-list\n  node scripts/wiki.mjs ima-import --kb "知识库名称" --limit 3 [--capture-only]\n  node scripts/wiki.mjs parse-pending\n  node scripts/wiki.mjs index\n  node scripts/wiki.mjs search "研究问题"\n  node scripts/wiki.mjs status\n  node scripts/wiki.mjs gbrain <GBrain 参数>');
  }
  if(result)console.log(JSON.stringify(result,null,2));
  if(Array.isArray(result)&&result.some(x=>x.status==='failed'))process.exitCode=1;
} catch(e) {console.error(e.message);process.exitCode=1;}
