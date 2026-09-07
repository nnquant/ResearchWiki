import { randomBytes } from 'node:crypto';
import { dataPath, readJson, atomicJson, now, withLock } from '../common.mjs';
import { HttpError } from './errors.mjs';

const jobsPath = dataPath('state', 'jobs.json');
const KEEP = 50;

let jobs = await readJson(jobsPath, []);
for (const job of jobs) {
  if (['queued', 'running'].includes(job.status)) {
    job.status = 'interrupted';
    job.error = '服务重启后请重新提交；已保存原件不会丢失';
    job.finished_at = job.finished_at ?? now();
  }
}
await atomicJson(jobsPath, jobs);

/** In-memory queue entries: { record, run, key, payload, merge } */
const queue = [];
let running = null;

function persist() {
  return atomicJson(jobsPath, jobs.slice(0, KEEP));
}

function publicView(record) {
  const { id, label, status, queued_at, started_at, finished_at, error, result, key } = record;
  return { id, label, status, queued_at, started_at, finished_at, error, result, key };
}

async function pump() {
  if (running || !queue.length) return;
  const entry = queue.shift();
  running = entry;
  const { record } = entry;
  record.status = 'running';
  record.started_at = now();
  await persist();
  try {
    record.result = await withLock(() => entry.run(entry.payload));
    if (Array.isArray(record.result) && record.result.some(x => x.status === 'failed')) {
      throw new Error('部分条目导入失败，请查看任务结果');
    }
    record.status = 'done';
  } catch (e) {
    record.status = 'failed';
    record.error = e.message;
  } finally {
    record.finished_at = now();
    running = null;
    await persist();
    setImmediate(pump);
  }
}

/**
 * Queue a job. Jobs run one at a time under the ingest lock. Jobs sharing a
 * `key` that are still queued are merged via `merge(existingPayload, newPayload)`
 * instead of being queued twice.
 */
export function enqueue(label, run, { key = null, payload = null, merge = null } = {}) {
  if (key) {
    const existing = queue.find(entry => entry.key === key);
    if (existing) {
      existing.payload = merge ? merge(existing.payload, payload) : payload;
      return publicView(existing.record);
    }
  }
  if (queue.length >= 20) throw new HttpError(429, '排队任务过多，请稍后再试');
  const record = { id: randomBytes(8).toString('hex'), label, key, status: 'queued', queued_at: now() };
  jobs.unshift(record);
  jobs = jobs.slice(0, KEEP);
  queue.push({ record, run, key, payload, merge });
  persist().then(pump);
  return publicView(record);
}

export function listJobs() {
  return jobs.map(publicView);
}

export function activeJob() {
  return running ? publicView(running.record) : null;
}

export function queueLength() {
  return queue.length;
}

export function findJob(id) {
  const record = jobs.find(job => job.id === id);
  return record ? publicView(record) : null;
}
