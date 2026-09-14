import {ENTITY_VERSION} from './article-entities.mjs';

export function enrichmentQueue(documents,states,cfg,processingVersion,at=Date.now()) {
  const unfinished=documents.filter(doc=>{
    // Field upgrades apply prospectively: never backfill previously completed reports.
    if(doc.llm?.status==='complete'&&doc.status==='indexed')return false;
    const state=states[doc.id];
    if(cfg.skipPreviouslyFailed&&state?.status==='failed')return false;
    return !(state?.status==='failed'&&state.revision===doc.revision&&state.entity_version===ENTITY_VERSION&&state.model===cfg.model&&state.endpoint===cfg.baseUrl&&state.processing_version===processingVersion);
  });
  const ready=unfinished.filter(doc=>!states[doc.id]?.next_retry_at||Date.parse(states[doc.id].next_retry_at)<=at);
  const future=unfinished.map(doc=>states[doc.id]?.next_retry_at).filter(date=>date&&Date.parse(date)>at).sort();
  return {unfinished,ready,nextRetryAt:future[0]??null};
}
