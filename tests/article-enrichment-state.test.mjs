import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichmentQueue} from '../scripts/article-enrichment-state.mjs';
import {ENTITY_VERSION} from '../scripts/article-entities.mjs';
test('a processing fix retries old failures while preserving completed articles across providers',()=>{
  const cfg={model:'deepseek-flash',baseUrl:'https://api.deepseek.com'};
  const docs=['done','old-failed','new-failed','index-wait'].map(id=>({id,revision:'r1',status:'parsed'}));
  docs[0]={...docs[0],status:'indexed',llm:{status:'complete',entity_version:ENTITY_VERSION,model:'previous-provider'}};
  const state={status:'failed',revision:'r1',entity_version:ENTITY_VERSION,model:cfg.model,endpoint:cfg.baseUrl};
  const states={'old-failed':{...state,processing_version:'v1'},'new-failed':{...state,processing_version:'v2'},'index-wait':{status:'pending_index',next_retry_at:'2026-09-10T11:00:00Z'}};
  const queue=enrichmentQueue(docs,states,cfg,'v2',Date.parse('2026-09-10T10:00:00Z'));
  assert.deepEqual(queue.unfinished.map(d=>d.id),['old-failed','index-wait']);
  assert.deepEqual(queue.ready.map(d=>d.id),['old-failed']);
  assert.equal(queue.nextRetryAt,'2026-09-10T11:00:00Z');
  assert.deepEqual(enrichmentQueue(docs,states,cfg,'v2',Date.parse('2026-09-10T11:00:00Z')).ready.map(d=>d.id),['old-failed','index-wait']);
});
