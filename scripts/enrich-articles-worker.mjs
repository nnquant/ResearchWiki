import fs from 'node:fs/promises';
import path from 'node:path';
import {manifest,dataPath,repo,readJson,atomicJson,now} from './common.mjs';
import {orderedArticles,stageMetadataArticle,publishArticle,ENRICHMENT_VERSION} from './enrich-articles.mjs';
import {closeDb} from './server/db.mjs';
import {ENTITY_VERSION} from './article-entities.mjs';
import {deepseekOffPeakWindow} from './deepseek-off-peak.mjs';
import {enrichmentQueue} from './article-enrichment-state.mjs';
import {serviceFailureKind,serviceErrorDetails,serviceRecoveryState,waitForArticleService} from './article-service-recovery.mjs';
import {EXPECTATIONS_VERSION} from './analyst-expectations.mjs';
import {articleConcurrency,startArticleBatch} from './article-concurrency.mjs';
import {REPORT_PRIORITY_ORDER} from './report-priority.mjs';

const args=process.argv.slice(2),option=(k,f)=>args.includes(k)?args[args.indexOf(k)+1]:f;
const staging=path.resolve(option('--output',path.join(repo,'work','article-metadata-batch')));
const stateDir=dataPath('state','article-enrichment');
const pauseFile=path.join(stateDir,'pause'),lockFile=path.join(stateDir,'worker.lock');
const cfg=await readJson(path.resolve(option('--config',path.join(repo,'work','article-llm.json'))),null);
if(!cfg?.model||!cfg.baseUrl||(cfg.transport==='codebuddy-cli'?!cfg.cliPath:!cfg.apiKey))throw new Error('缺少 LLM 配置');
const concurrency=articleConcurrency(option('--concurrency',cfg.concurrency??1));
await fs.mkdir(stateDir,{recursive:true});
const lock=await fs.open(lockFile,'wx');
await lock.writeFile(JSON.stringify({pid:process.pid,started_at:now(),mode:'metadata_only',concurrency}));
let stopping=false;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const states=await readJson(path.join(stateDir,'documents.json'),{});
const provider={transport:cfg.transport??'openai-compatible',model:cfg.model,endpoint:cfg.baseUrl,thinking:cfg.thinking ?? null,processing_version:ENRICHMENT_VERSION,expectations_version:EXPECTATIONS_VERSION};
const recoveryFile=path.join(stateDir,'service-recovery.json');
let recovery=await readJson(recoveryFile,null);
if(recovery&&(recovery.model!==cfg.model||recovery.endpoint!==cfg.baseUrl))recovery=null;
// Upgrade the last connection-related stop only. Evidence failures and user pauses remain separate.
const previousStatus=await readJson(path.join(stateDir,'status.json'),null);
if(!recovery&&previousStatus?.phase==='needs_attention'&&previousStatus.model===cfg.model&&previousStatus.endpoint===cfg.baseUrl&&serviceFailureKind({message:previousStatus.error})==='transient') {
  const id=previousStatus.active?.id,previous=id&&states[id];
  if(previous?.status==='failed'&&previous.model===cfg.model&&previous.endpoint===cfg.baseUrl) {
    states[id]={...previous,status:'pending_service',service_attempts:previous.service_attempts??1};
    recovery=serviceRecoveryState(cfg,id,states[id].service_attempts,Date.parse(previous.failed_at??previousStatus.updated_at),new Error(previousStatus.error));
    await atomicJson(path.join(stateDir,'documents.json'),states);
    await atomicJson(recoveryFile,recovery);
  }
}
const base={pid:process.pid,mode:'metadata_only',concurrency,translation_enabled:false,entity_version:ENTITY_VERSION,...provider,off_peak_only:Boolean(cfg.offPeakOnly),order:REPORT_PRIORITY_ORDER,started_at:now()};
let success=0,failed=0,indexRetries=0,serviceWaits=0,queue=[];
const activeArticles=new Map();
let needsAttention=null;
async function status(phase,extra={}) {
  const active=[...activeArticles.values()];
  await atomicJson(path.join(stateDir,'status.json'),{...base,phase,updated_at:now(),completed_this_run:success,failed_this_run:failed,index_retries_this_run:indexRetries,service_waits_this_run:serviceWaits,known_documents:queue.length,active_articles:active,active:active.find(item=>item.phase==='indexing')??active[0]??null,...extra});
}
async function paused(){return stopping || await fs.access(pauseFile).then(()=>true,()=>false);}
async function publishWhenAvailable(folder) {
  for(;;) {
    try{return await publishArticle(folder);}
    catch(e) {
      const busy=/已有导入任务占用锁/.test(e.message) || (e instanceof SyntaxError && await fs.access(dataPath('state','ingest.lock')).then(()=>true,()=>false));
      if(!busy)throw e;
      if(await paused())throw new Error('已请求暂停，待入库结果已保存');
      await sleep(150);
    }
  }
}
try {
  while(!needsAttention&&!await paused()) {
    const window=cfg.offPeakOnly?deepseekOffPeakWindow(Date.now(),cfg.requestTimeoutMs??600000):{allowed:true};
    if(!window.allowed) {
      await status('waiting_off_peak',{next_resume_at:window.nextResumeAt});
      await sleep(Math.min(30000,Math.max(1000,Date.parse(window.nextResumeAt)-Date.now())));
      continue;
    }
    // Freeze each bounded extraction group; publication remains serial under the ingest lock.
    queue=orderedArticles(Object.values((await manifest()).documents));
    if(recovery) {
      const document=queue.find(d=>d.id===recovery.document_id);
      const active={id:recovery.document_id,title:document?.title};
      const outcome=await waitForArticleService(cfg,recovery,{shouldPause:paused,onUpdate:async current=>{
        recovery=current;
        await atomicJson(recoveryFile,current);
        await status('waiting_service',{active,pending:enrichmentQueue(queue,states,cfg,ENRICHMENT_VERSION).unfinished.length,next_probe_at:current.next_probe_at,probe_attempt:current.attempt,error:current.error,error_details:current.error_details});
      }});
      if(outcome.kind==='paused')break;
      if(outcome.kind==='fatal') {
        await status('needs_attention',{active,error:outcome.error.message,error_details:serviceErrorDetails(outcome.error)});break;
      }
      console.log(JSON.stringify({at:now(),phase:cfg.transport==='codebuddy-cli'?'service_retry_ready':'service_recovered',...active}));
      await fs.rm(recoveryFile,{force:true});recovery=null;
      // Recheck both the user pause and off-peak window before another inference request.
      continue;
    }
    const {unfinished,ready:pending,nextRetryAt}=enrichmentQueue(queue,states,cfg,ENRICHMENT_VERSION);
    await atomicJson(path.join(stateDir,'queue.json'),{updated_at:now(),order:base.order,documents:unfinished.map(d=>({id:d.id,title:d.title,date:d.article_metadata?.published_at||d.published_at||d.source_meta?.sort_date||null}))});
    if(!unfinished.length){await status('completed',{pending:0});break;}
    if(!pending.length){await status('waiting_index_retry',{pending:unfinished.length,next_retry_at:nextRetryAt});await sleep(Math.min(30000,Math.max(1000,Date.parse(nextRetryAt)-Date.now())));continue;}
    let batchHalt=false;
    const activeOf=record=>({id:record.id,title:record.title,date:record.article_metadata?.published_at||record.published_at||record.source_meta?.sort_date||null});
    const batch=startArticleBatch(pending,{concurrency,shouldPause:async()=>batchHalt||await paused(),onStart:async record=>{
      activeArticles.set(record.id,{...activeOf(record),phase:'extracting'});
      states[record.id]={status:'processing',revision:record.revision,entity_version:ENTITY_VERSION,...provider,index_attempts:states[record.id]?.index_attempts??0,service_attempts:states[record.id]?.service_attempts??0,started_at:now()};
      await atomicJson(path.join(stateDir,'documents.json'),states);
      await status('extracting',{pending:unfinished.length});
      console.log(JSON.stringify({at:now(),phase:'extracting',...activeOf(record),concurrency}));
    },stage:async record=>{
      const staged=await stageMetadataArticle(record,cfg,staging,{shouldPause:async()=>batchHalt||await paused()});
      activeArticles.set(record.id,{...activeOf(record),phase:'staged'});
      await status('extracting',{pending:unfinished.length});
      return staged;
    },onError:async(error,record)=>{
      if(serviceFailureKind(error)==='fatal')batchHalt=true;
      if(activeArticles.has(record.id))activeArticles.set(record.id,{...activeOf(record),phase:'awaiting_error_handling'});
    }});
    for(const job of batch) {
    const prepared=await job.ready,record=job.record,folder=path.join(staging,record.id),active=activeOf(record);
    const articleStarted=prepared.started,extractionSeconds=prepared.extractionSeconds;
    try {
      if(prepared.error)throw prepared.error;
      const staged=prepared.staged;
      activeArticles.set(record.id,{...active,phase:'indexing'});
      await status('indexing',{pending:unfinished.length,active});
      const indexStarted=Date.now();
      const completed=await publishWhenAvailable(folder);
      success++;
      states[record.id]={status:'complete',revision:record.revision,entity_version:ENTITY_VERSION,...provider,completed_at:now(),wiki_url:completed.wiki_url,vectors:completed.vectors,...(staged.usage_summary?{usage_summary:staged.usage_summary}:{})};
      console.log(JSON.stringify({at:now(),phase:'complete',...active,vectors:completed.vectors,extraction_seconds:extractionSeconds,publication_queue_seconds:Math.max(0,(indexStarted-articleStarted)/1000-extractionSeconds),index_seconds:(Date.now()-indexStarted)/1000,total_seconds:(Date.now()-articleStarted)/1000,...(staged.usage_summary?{usage_summary:staged.usage_summary}:{})}));
    } catch(e) {
      if(e.code==='ARTICLE_PAUSED') {
        states[record.id]={...states[record.id],status:'pending',deferred_at:now()};
        await atomicJson(path.join(stateDir,'documents.json'),states);continue;
      }
      if(e.code==='OFF_PEAK_WAIT') {
        states[record.id]={status:'pending',revision:record.revision,entity_version:ENTITY_VERSION,...provider,index_attempts:states[record.id]?.index_attempts??0,service_attempts:states[record.id]?.service_attempts??0,deferred_at:now()};
        await atomicJson(path.join(stateDir,'documents.json'),states);
        await status('waiting_off_peak',{active,next_resume_at:e.nextResumeAt});
        continue;
      }
      if(e.code==='INDEX_FAILED') {
        indexRetries++;
        const attempts=(states[record.id]?.index_attempts??0)+1;
        states[record.id]={status:'pending_index',revision:record.revision,entity_version:ENTITY_VERSION,...provider,index_attempts:attempts,next_retry_at:new Date(Date.now()+60000*attempts).toISOString(),staging_folder:folder,error:e.message};
        await atomicJson(path.join(stateDir,'documents.json'),states);
        console.error(JSON.stringify({at:now(),phase:'index_retry',...active,attempt:attempts,error:e.message}));
        if(attempts>=3){needsAttention={active,error:'同一文章索引连续失败3次，抽取结果和已完成向量批次已保存。'+e.message};batchHalt=true;break;}
        continue;
      }
      if(serviceFailureKind(e)==='transient') {
        serviceWaits++;
        const attempts=(states[record.id]?.service_attempts??0)+1;
        const documentRecovery=serviceRecoveryState(cfg,record.id,attempts,Date.now(),e);
        recovery??=documentRecovery;
        states[record.id]={...states[record.id],status:'pending_service',service_attempts:attempts,next_retry_at:documentRecovery.next_probe_at,error:e.message,error_details:serviceErrorDetails(e)};
        await atomicJson(path.join(stateDir,'documents.json'),states);
        await atomicJson(recoveryFile,recovery);
        console.error(JSON.stringify({at:now(),phase:'waiting_service',...active,next_probe_at:recovery.next_probe_at,error:e.message,error_details:serviceErrorDetails(e)}));
        continue;
      }
      failed++;
      states[record.id]={status:'failed',revision:record.revision,entity_version:ENTITY_VERSION,...provider,failed_at:now(),error:e.message,error_details:serviceErrorDetails(e)};
      await fs.appendFile(path.join(stateDir,'failures.jsonl'),JSON.stringify({at:now(),...active,error:e.message,error_details:serviceErrorDetails(e)})+'\n');
      console.error(JSON.stringify({at:now(),phase:'failed',...active,error:e.message}));
      // Avoid burning through the entire queue during a service outage.
      if(serviceFailureKind(e)==='fatal'||/配置|向量完整性/.test(e.message)) {
        await atomicJson(path.join(stateDir,'documents.json'),states);
        needsAttention={active,error:e.message};batchHalt=true;break;
      }
    } finally {
      activeArticles.delete(record.id);
      await atomicJson(path.join(stateDir,'documents.json'),states);
    }
    }
    // Drain started work before releasing the singleton lock. Staged artifacts remain resumable.
    await Promise.all(batch.map(job=>job.ready));
    for(const record of batch.map(job=>job.record)) {
      if(activeArticles.has(record.id)&&states[record.id]?.status==='processing')states[record.id]={...states[record.id],status:'pending',deferred_at:now()};
    }
    activeArticles.clear();
    await atomicJson(path.join(stateDir,'documents.json'),states);
    if(needsAttention)await status('needs_attention',needsAttention);
    else await status(await paused()?'paused':'batch_complete',{pending:enrichmentQueue(queue,states,cfg,ENRICHMENT_VERSION).unfinished.length});
  }
  if(!needsAttention&&await paused())await status('paused');
} finally {await closeDb();await lock.close();await fs.unlink(lockFile);}
