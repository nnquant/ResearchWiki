import test from 'node:test';
import assert from 'node:assert/strict';
import { withRead } from '../scripts/query/store.mjs';
import { getSql, closeDb } from '../scripts/server/db.mjs';

test('pool admission expires promptly and readers remain independent of the Wiki pool', { skip: process.env.RESEARCH_GRAPH_DB_TEST !== '1' }, async () => {
  let entered = 0, ready;
  const allEntered = new Promise(resolve => { ready = resolve; });
  const blockers = Array.from({length:4},()=>withRead(async run=>{
    if (++entered === 4) ready();
    await run('SELECT pg_sleep(1)');
  },{timeoutMs:5000}));
  try {
    await allEntered;
    const start = Date.now();
    await assert.rejects(withRead(run=>run('SELECT 1'),{timeoutMs:100}),e=>e.data?.code==='TIMEOUT');
    assert.ok(Date.now()-start < 700,'queued cancellation must not wait for active readers');
    const wiki = await getSql();
    const [row] = await wiki`SELECT current_setting('application_name') AS role`;
    assert.equal(row.role,'researchwiki-wiki-index');
    await Promise.all(blockers);
    const [reader] = await withRead(run=>run("SELECT current_setting('application_name') AS role"));
    assert.equal(reader.role,'researchwiki-research-read');
  } finally { await Promise.allSettled(blockers); await closeDb(); }
});
