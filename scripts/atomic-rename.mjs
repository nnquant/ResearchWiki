import fs from 'node:fs/promises';

// Windows readers and virus scanners can briefly deny replacement of an open file.
// Keep the old file intact; retry the same atomic rename without deleting the target.
export async function atomicRename(from, to, { rename = fs.rename, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(from, to); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 8) throw error;
      await sleep(Math.min(20 * 2 ** attempt, 250));
    }
  }
}
