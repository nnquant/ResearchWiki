import fs from 'node:fs/promises';
import { config, dataPath } from '../common.mjs';
import { HttpError } from '../server/errors.mjs';

const capacity = Math.min(4, config.agent?.maxConcurrent ?? 4);
let active = 0, writing = Promise.resolve();
const recent = [];
export const flushRequestLogs = () => writing;
export function requestMetrics() {
  const cutoff = Date.now() - 300000;
  while (recent.length && recent[0].at < cutoff) recent.shift();
  const sorted = recent.map(r => r.ms).sort((a,b) => a-b);
  return { active, capacity, requests_5m: sorted.length, p95_ms_5m: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null };
}
export async function observedRequest(operation, fn) {
  const started = Date.now(), timings = {};
  let entered = false, result, error, concurrent = active;
  try {
    if (active >= capacity) throw new HttpError(429, '研究服务繁忙，请稍后重试', { code: 'TOO_MANY_REQUESTS', retry_after: 2 });
    active++; entered = true; concurrent = active;
    result = await fn(timings); return result;
  } catch (e) { error = e; throw e; }
  finally {
    if (entered) active--;
    const latency_ms = Date.now() - started, timestamp = new Date().toISOString();
    recent.push({ at: Date.now(), ms: latency_ms }); requestMetrics();
    const entry = { timestamp, operation: ['describe','resolve','query','search','read','related','graph'].includes(operation) ? operation : 'unknown',
      status: error?.status ?? (error ? 500 : 200), code: error?.data?.code ?? (error ? 'REQUEST_FAILED' : 'OK'),
      latency_ms, concurrent, queue_ms: timings.pool_wait_ms ?? 0, timings, request_id: result?.request_id ?? null,
      degraded_stages: result?.degraded?.map(d => d.stage) ?? [] };
    // One append-only file per UTC day. Never include query text, credentials or errors containing SQL.
    const file = dataPath('logs', `research-requests-${timestamp.slice(0, 10)}.jsonl`);
    writing = writing.then(async () => {
      await fs.mkdir(dataPath('logs'), { recursive: true });
      await fs.appendFile(file, JSON.stringify(entry) + '\n');
    }).catch(() => console.error('[research-log] append failed'));
  }
}
