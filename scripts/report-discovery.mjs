import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildReportPlan} from './report-batch-plan.mjs';
import {compareArticlePriority} from './report-priority.mjs';

export const discoveryRecord = item => ({id:item.id,sha256:item.sha256,title:path.basename(item.relative),source_meta:{sort_date:item.date,report_category:item.report_category}});

// Re-scan directory entries; cache hashes only while size and modification time match.
export async function discoverReports({sources,documents,cache={},at=Date.now(),settleMs=30000}) {
  const candidates=[];
  for(const source of sources) {
    const years=new Set((await fs.readdir(source.source,{withFileTypes:true})).filter(d=>d.isDirectory()).map(d=>d.name.match(/^(\d{4})年\d{1,2}月/)?.[1]).filter(Boolean));
    for(const year of years) {
      const plan=await buildReportPlan({...source,year:Number(year),fromMonth:12,toMonth:1});
      for(const item of plan.files) candidates.push({...item,source:plan.source,output:plan.output,year:plan.year,report_category:source.report_category});
    }
  }
  candidates.sort((a,b)=>compareArticlePriority(discoveryRecord(a),discoveryRecord(b)));
  const known=new Set(documents.map(d=>d.sha256)),pending=[];
  let unstable=0;
  for(const item of candidates) {
    if(at-item.mtime_ms<settleMs){unstable++;continue;}
    const file=path.join(item.source,item.relative);
    let entry=cache[file];
    if(!entry||entry.size!==item.size||entry.mtime_ms!==item.mtime_ms) {
      const bytes=await fs.readFile(file),after=await fs.stat(file);
      if(after.size!==item.size||after.mtimeMs!==item.mtime_ms){unstable++;continue;}
      entry=cache[file]={size:item.size,mtime_ms:item.mtime_ms,sha256:createHash('sha256').update(bytes).digest('hex')};
    }
    if(known.has(entry.sha256))continue;
    known.add(entry.sha256);pending.push({...item,sha256:entry.sha256});
  }
  return {pending,cache,scanned:candidates.length,unstable};
}

export function higherPriorityUnparsed(discovery,documents,next) {
  const parsed=new Set(documents.filter(d=>d.parsed_path&&['parsed','indexed'].includes(d.status)).map(d=>d.sha256));
  return discovery?.pending?.find(item=>!parsed.has(item.sha256)&&(!next||compareArticlePriority(item,next)<0))??null;
}
