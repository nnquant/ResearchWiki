import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadGate } from '../scripts/query/read-gate.mjs';

test('expired queued readers never enter; capacity is released only once', async () => {
  const enter = createReadGate(1), release = await enter();
  const abort = new AbortController();
  const expired = enter(abort.signal);
  const rejected = assert.rejects(expired, { name: 'AbortError' });
  abort.abort(); await rejected;
  let entered = false;
  const next = enter().then(done => { entered = true; return done; });
  await Promise.resolve(); assert.equal(entered, false);
  release(); release();
  const finish = await next;
  let extraEntered = false;
  const extra = enter().then(done => { extraEntered = true; return done; });
  await Promise.resolve(); assert.equal(extraEntered, false);
  finish(); (await extra)();
});

test('already cancelled requests do not consume a slot', async () => {
  const enter = createReadGate(1), controller = new AbortController(); controller.abort();
  await assert.rejects(enter(controller.signal), { name: 'AbortError' });
  (await enter())();
});
