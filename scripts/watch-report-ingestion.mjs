import fs from 'node:fs/promises';
import path from 'node:path';
import {manifest,dataPath,atomicJson,readJson,now} from './common.mjs';
import {discoverReports,discoveryRecord} from './report-discovery.mjs';
import {runReportBatch} from './import-report-batch.mjs';

const dir=dataPath('state','report-discovery');
const sources=[{source:'D:/data/reports/raw',output:'D:/data/reports/processed/live-updates/foreign',report_category:'外资'},
  {source:'D:/data/reports/raw1',output:'D:/data/reports/processed/live-updates/domestic',report_category:'内资'}];
await fs.mkdir(dir,{recursive:true});
const lock=await fs.open(path.join(dir,'worker.lock'),'wx');
await lock.writeFile(JSON.stringify({pid:process.pid,started_at:now()}));
let stopping=false,pending=[],lastScan=0,scanned=0,unstable=0,completed=0,failed=0;
const cache=await readJson(path.join(dir,'hash-cache.json'),{});
const stop=()=>{stopping=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
const paused=async()=>stopping||await fs.access(path.join(dir,'pause')).then(()=>true,()=>false);
async function status(phase,extra={}) {
  await atomicJson(path.join(dir,'status.json'),{pid:process.pid,phase,updated_at:now(),last_scan_at:lastScan?new Date(lastScan).toISOString():null,scan_interval_seconds:60,order:'report-date-desc,foreign-first',scanned,unstable,completed_this_run:completed,failed_this_run:failed,pending:pending.map(discoveryRecord),...extra});
}
try {
  while(!await paused()) {
    if(Date.now()-lastScan>=60000) {
      await status('scanning');
      const result=await discoverReports({sources,documents:Object.values((await manifest()).documents),cache});
      pending=result.pending;scanned=result.scanned;unstable=result.unstable;lastScan=Date.now();
      await atomicJson(path.join(dir,'hash-cache.json'),cache);
      await status('ready');
    }
    if(!pending.length){await status('watching');await new Promise(r=>setTimeout(r,5000));continue;}
    const item=pending[0];
    const plan={version:2,output_layout:'report-date',source:item.source,output:item.output,year:item.year,from_month:12,to_month:1,report_category:item.report_category,order:'report-date-desc,foreign-first',created_at:now(),total:1,bytes:item.size,months:{[item.month]:1},files:[{...item,order:1}]};
    await fs.mkdir(path.join(item.output,'_batch'),{recursive:true});
    await atomicJson(path.join(item.output,'_batch','plan.json'),plan);
    await status('parsing',{active:discoveryRecord(item)});
    const result=await runReportBatch(plan,{limit:1,batchSize:1,parseOnly:true,concurrency:1});
    if(result.pending)throw new Error('解析批次暂停，请检查磁盘、服务或批次暂停标记');
    completed+=result.completed;failed+=result.failed;
    await fs.appendFile(path.join(dir,'events.jsonl'),JSON.stringify({at:now(),...discoveryRecord(item),result})+'\n');
    pending.shift();await status('ready');
  }
  await status('paused');
}catch(error){await status('blocked',{error:error.message});throw error;}
finally{await lock.close();await fs.unlink(path.join(dir,'worker.lock'));}
