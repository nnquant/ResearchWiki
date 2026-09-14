import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEvents, within } from './report-batch-plan.mjs';
import { deduplicateFile, shareable } from './report-storage.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const write=async(file,value)=>fs.writeFile(file,JSON.stringify(value,null,2)+'\n');
export function completedRecord(item,event,report,doc) {
  return event?.status==='completed' && ['parsed','indexed'].includes(report?.status)
    && ['parsed','indexed'].includes(doc?.status) && event.document_id===doc.id
    && report.sha256===doc.sha256 && report.source_relative===item.relative;
}
async function filesBelow(root) {
  const result=[];
  async function walk(dir) {
    for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
      const file=path.join(dir,entry.name);
      if(entry.isSymbolicLink()) throw new Error(`Unexpected symbolic link: ${file}`);
      if(entry.isDirectory())await walk(file);else result.push(file);
    }
  }
  await walk(root);return result;
}
function checked(base,relative) {
  const result=path.resolve(base,relative);
  if(!within(base,result)||result===path.resolve(base))throw new Error(`Outside root: ${result}`);
  return result;
}
async function inspect() {
  const config=await read(path.join(repo,'config.json'));
  const root=path.resolve(config.dataRoot);
  const catalogue=await read(path.join(root,'state/manifest.json'));
  const batches=['D:/data/reports/processed','D:/data/reports/processed/内资'];
  const reports=[],excluded=[];
  for(const output of batches) {
    const plan=await read(path.join(output,'_batch/plan.json'));
    if(path.resolve(plan.output)!==path.resolve(output))throw new Error('Batch output mismatch');
    const source=path.resolve(plan.source);
    if(!['D:\\data\\reports\\raw','D:\\data\\reports\\raw1'].includes(source))throw new Error('Unexpected source');
    const events=readEvents(await fs.readFile(path.join(output,'_batch/events.jsonl'),'utf8'));
    for(const item of plan.files) {
      const event=events.get(item.id),doc=catalogue.documents[event?.document_id];
      const target=checked(output,item.output_relative);
      let report;
      try {report=await read(path.join(target,'report.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
      if(!completedRecord(item,event,report,doc)) {excluded.push({source:checked(source,item.relative),reason:'not_successfully_completed'});continue;}
      const original=report.original_file||'original.pdf';
      reports.push({id:doc.id,sha256:doc.sha256,source:checked(source,item.relative),
        raw:checked(path.join(root,'raw'),path.relative(path.join(root,'raw'),path.resolve(root,doc.raw_path))),
        parsed:checked(path.join(root,'parsed'),path.join(doc.id,doc.revision)),
        target,pdf:checked(target,original)});
    }
  }
  return {version:1,created_at:new Date().toISOString(),root,reports,excluded};
}
async function snapshotSources() {
  const entries={};
  for(const root of ['D:/data/reports/raw','D:/data/reports/raw1']) {
    for(const file of await filesBelow(root)) {
      const s=await fs.stat(file);
      entries[file]={size:s.size,mtime:s.mtimeMs,ino:s.ino};
    }
  }
  return entries;
}
async function run() {
  const args=process.argv.slice(2),apply=args.includes('--apply');
  const out=path.resolve(repo,'outputs','report-dedup-20260913');
  await fs.mkdir(out,{recursive:true});
  const inspection=await inspect();
  if(!apply) {
    await write(path.join(out,'plan.json'),inspection);
    console.log(JSON.stringify({reports:inspection.reports.length,excluded:inspection.excluded.length,plan:path.join(out,'plan.json')}));return;
  }
  // The approved plan freezes the candidates; a new completion cannot broaden this run.
  const planned=await read(path.join(out,'plan.json'));
  const fresh=new Set(inspection.reports.map(r=>JSON.stringify(r)));
  const reports=planned.reports.filter(r=>fresh.has(JSON.stringify(r)));
  const before=await snapshotSources();await write(path.join(out,'sources-before.json'),before);
  const diskBefore=await fs.statfs(inspection.root);
  const stats={started_at:new Date().toISOString(),reports:reports.length,completed:0,counts:{},reclaimed_bytes:0,errors:0};
  const journal=await fs.open(path.join(out,'actions.jsonl'),'a');
  const seen=new Set();
  async function pair(source,target,hash) {
    let result;
    try { result=await deduplicateFile(source,target,hash); }
    catch(e) {result={status:'error',bytes:0,error:e.message};stats.errors++;}
    stats.counts[result.status]=(stats.counts[result.status]||0)+1;
    stats.reclaimed_bytes+=result.bytes;
    await journal.write(JSON.stringify({source,target,...result})+'\n');
  }
  try {
    for(const report of reports) {
      // Source paths are never replaced, deleted, moved, or rewritten.
      if(!seen.has(report.id)){await pair(report.source,report.raw,report.sha256);seen.add(report.id);}
      await pair(report.raw,report.pdf,report.sha256);
      const exported=path.join(report.target,'parsed');
      const files=(await filesBelow(exported)).filter(shareable);
      // Work in bounded groups, preserving a complete result for every file.
      for(let i=0;i<files.length;i+=8)await Promise.all(files.slice(i,i+8).map(target=>pair(checked(report.parsed,path.relative(exported,target)),target)));
      stats.completed++;
      if(stats.completed%100===0){await write(path.join(out,'progress.json'),stats);console.log(JSON.stringify(stats));}
    }
  } finally {await journal.close();await write(path.join(out,'progress.json'),stats);}
  const after=await snapshotSources();
  const changed=Object.keys(before).filter(file=>JSON.stringify(before[file])!==JSON.stringify(after[file]));
  const diskAfter=await fs.statfs(inspection.root);
  Object.assign(stats,{finished_at:new Date().toISOString(),source_files_checked:Object.keys(before).length,source_changes:changed,
    disk_free_increase_bytes:diskAfter.bavail*diskAfter.bsize-diskBefore.bavail*diskBefore.bsize});
  await write(path.join(out,'result.json'),stats);console.log(JSON.stringify(stats));
  if(changed.length||stats.errors)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await run();
