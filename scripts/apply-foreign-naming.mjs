import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {config,repo,dataPath,root,sha,atomicJson,readJson,slash} from './common.mjs';
import {isForeignReport} from './report-priority.mjs';
import {buildForeignName,NAMING_VERSION,validateForeignFilename,withParsedNamingFallback} from './foreign-report-naming.mjs';
import {normalizeBibliography,publisherFor} from './report-dictionaries.mjs';
import {within} from './report-batch-plan.mjs';

export async function pdfNamingEvidence(record){
  const settings=config.foreignReportNaming??{};
  const cacheRoot=path.resolve(repo,settings.pdfCache??dataPath('state/report-naming/pdf-cache'));
  const file=path.join(cacheRoot,record.sha256+'.json'),cached=await readJson(file,null);if(cached)return cached;
  const raw=path.isAbsolute(record.raw_path)?record.raw_path:dataPath(record.raw_path);
  const value=await new Promise((resolve,reject)=>{
    const child=spawn(settings.pythonCommand??'python',['-X','utf8',path.join(repo,'scripts/foreign_pdf_metadata.py'),'--file',raw],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';
    const timeout=setTimeout(()=>child.kill(),120000);child.stdout.on('data',b=>{out+=b;});child.stderr.on('data',b=>{err+=b;});child.on('error',reject);child.on('close',code=>{clearTimeout(timeout);if(code!==0)return reject(new Error('PDF 命名证据读取失败：'+err.slice(0,400)));try{resolve(JSON.parse(out));}catch(e){reject(e);}});
  });
  await atomicJson(file,value);return value;
}
export async function verifiedRename(from,to,hash,{keepAlias=false}={}){
  from=path.resolve(from);to=path.resolve(to);
  if(path.dirname(from)!==path.dirname(to))throw new Error('命名操作不能移动目录');
  if(!within(dataPath('raw'),from)&&!within('D:/data/reports/raw',from)&&!within('D:/data/reports/processed',from)&&!within(path.join(repo,'work'),from))throw new Error('命名路径不在授权报告目录内');
  validateForeignFilename(path.basename(to));
  const exists=await fs.access(from).then(()=>true,()=>false);
  if(!exists){if(sha(await fs.readFile(to))!==hash)throw new Error('恢复目标哈希不一致');return;}
  if(sha(await fs.readFile(from))!==hash)throw new Error('改名前 SHA-256 不一致：'+from);
  if(from===to)return;
  // Creating a hardlink is atomic and fails on an existing name; never overwrite.
  try{await fs.link(from,to);}catch(error){if(error.code!=='EEXIST')throw error;if(sha(await fs.readFile(to))!==hash)throw new Error('命名冲突：'+to);}
  if(!keepAlias)await fs.unlink(from);
}
export function applyNamingMetadata(record,naming){
  const normalized=normalizeBibliography(record.article_metadata??{}, {institution:naming.broker});
  normalized.institutions=[naming.broker];
  if(naming.authors?.length)normalized.authors=naming.authors;
  normalized.published_at=naming.date;
  normalized.topic_primary=naming.topic==='Unknown'?null:naming.topic;
  const originalTitle=record.naming?.original_title??record.title;
  if(originalTitle&&originalTitle!==naming.report_key)normalized.aliases=[...new Set([...(normalized.aliases??[]),originalTitle])];
  record.article_metadata=normalized;
  record.naming={...naming,original_filename:record.naming?.original_filename??record.filename,original_title:originalTitle};
  record.filename=naming.filename;
  record.title=naming.report_key;
  record.published_at=naming.date;
  return record;
}
export async function applyForeignReportNaming(record){
  if(!config.foreignReportNaming?.enabled||!(isForeignReport(record)||publisherFor(record)?.foreign===true)||!/\.pdf$/i.test(record.filename))return record;
  if(record.naming?.version===NAMING_VERSION&&record.naming?.status==='ready')return record;
  try{
    const raw=dataPath(record.raw_path),stat=await fs.stat(raw);let pdf=await pdfNamingEvidence(record);
    // MinerU's existing page evidence is the OCR fallback on Windows.
    if(record.paged_path){
      const body=await fs.readFile(dataPath(record.paged_path),'utf8');
      pdf=withParsedNamingFallback(pdf,body);
    }
    const naming=buildForeignName(record,pdf,{mtime:stat.mtime.toISOString()});
    if(naming.status!=='ready'){record.naming={...naming,version:NAMING_VERSION};return record;}
    const target=path.join(path.dirname(raw),naming.filename);
    await verifiedRename(raw,target,record.sha256,{keepAlias:true});
    const originalSource=record.source_meta?.import_path;
    if(originalSource&&within('D:/data/reports/raw',originalSource)){
      const sourceTarget=path.join(path.dirname(originalSource),naming.filename);
      await verifiedRename(originalSource,sourceTarget,record.sha256);
      record.source_meta={...record.source_meta,original_import_path:record.source_meta.original_import_path??originalSource,import_path:sourceTarget};
    }
    record.raw_path=slash(path.relative(root,target));applyNamingMetadata(record,naming);
    await atomicJson(path.join(path.dirname(raw),'provenance.json'),record);
    return record;
  }catch(error){record.naming={status:'review',version:NAMING_VERSION,reason:error.message};return record;}
}
