import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const testRoot = path.resolve('work', `perf-cache-${process.pid}`);
process.env.WIKI_DATA_ROOT = testRoot;
const { manifest, manifestSnapshot, manifestSummary, manifestPath, atomicJson } = await import('../scripts/common.mjs');
const { cleanDatabaseValue, metadataFor } = await import('../scripts/query/index.mjs');
const { preferredEncoding } = await import('../scripts/server/encoding.mjs');
const { observedRequest, requestMetrics, flushRequestLogs } = await import('../scripts/query/telemetry.mjs');
test.after(async () => { await flushRequestLogs(); await fs.rm(testRoot, { recursive: true, force: true }); });

test('manifest readers coalesce; mutable writer copies cannot contaminate snapshots; rename invalidates', async () => {
  await atomicJson(manifestPath, { documents: { a: { wiki_slug: 'sources/Café Risk.md', status: 'indexed', pages: 3 } } });
  const [a,b] = await Promise.all([manifestSnapshot(), manifestSnapshot()]);
  assert.equal(a,b); assert.equal(a.counts.indexed,1); assert.equal(a.counts.pdf_pages,3);
  assert.equal(a.bySlug.get('sources/cafe-risk').pages,3);
  const writer = await manifest(); writer.documents.a.pages = 9;
  assert.equal((await manifestSnapshot()).counts.pdf_pages,3);
  const saving = atomicJson(manifestPath,writer);
  writer.documents.a.pages = 99;
  await saving;
  assert.equal((await manifestSnapshot()).counts.pdf_pages,9);
  assert.equal((await manifestSummary()).pdf_pages,9);
  await fs.unlink(manifestPath);
  assert.equal((await manifestSnapshot()).counts.documents,0);
});

test('PostgreSQL sanitation strips actual NUL recursively but preserves literal escapes and source input', () => {
  const raw = { title:'a\0b', nested:['x\0y', { 'k\0': 'z' }], literal:'\\u0000' };
  assert.deepEqual(cleanDatabaseValue(raw), { title:'ab', nested:['xy',{k:'z'}], literal:'\\u0000' });
  assert.equal(raw.title,'a\0b');
  assert.equal(metadataFor({summary:'a\0b',tags:['行业:AI\0']}).summary,'ab');
});

test('encoding negotiation honors q=0 and compressed preferences', () => {
  assert.equal(preferredEncoding('gzip, br'), 'br');
  assert.equal(preferredEncoding('br;q=0, gzip;q=0.5'), 'gzip');
  assert.equal(preferredEncoding('br;q=0, gzip;q=0'), null);
  assert.equal(preferredEncoding('*;q=1, br;q=0'), 'gzip');
});

test('shared admission rejects the fifth request immediately and releases slots on failures', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const holders = Array.from({length:4}, () => observedRequest('search', () => blocked));
  assert.equal(requestMetrics().active,4);
  await assert.rejects(observedRequest('query',async()=>null), e => e.status === 429 && e.data.retry_after === 2);
  release({}); await Promise.all(holders);
  await assert.rejects(observedRequest('read',async()=>{throw new Error('fixture');}));
  assert.equal(requestMetrics().active,0);
  await flushRequestLogs();
  const files = await fs.readdir(path.join(testRoot,'logs'));
  const logs = (await fs.readFile(path.join(testRoot,'logs',files[0]),'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(logs.some(x=>x.status===429)); assert.ok(logs.every(x=>x.timestamp && !('query' in x)));
});
