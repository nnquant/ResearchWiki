import test from 'node:test';
import assert from 'node:assert/strict';
import { atomicRename } from '../scripts/atomic-rename.mjs';

test('atomic rename retries transient sharing violations on the same paths', async () => {
  let calls = 0; const waits = [];
  await atomicRename('state.tmp', 'state.json', {
    rename: async (from, to) => {
      assert.equal(from, 'state.tmp'); assert.equal(to, 'state.json');
      if (++calls < 3) throw Object.assign(new Error('busy'), { code: 'EPERM' });
    }, sleep: async ms => waits.push(ms),
  });
  assert.equal(calls, 3); assert.deepEqual(waits, [20,40]);
});
test('atomic rename stops retrying persistent errors and immediately rejects other errors', async () => {
  for (const [code, expected] of [['EPERM',9],['ENOENT',1]]) {
    let calls = 0;
    await assert.rejects(atomicRename('a','b', { rename: async () => { calls++; throw Object.assign(new Error(code), { code }); }, sleep: async () => {} }), { code });
    assert.equal(calls, expected);
  }
});
