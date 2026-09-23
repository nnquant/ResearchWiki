import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installAccess } from '../scripts/agent/install-downloads.mjs';

test('access guide exposes only complete enabled published links, without connection credentials', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-access-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  assert.equal((await installAccess(directory)).available, false);
  const share = { id: 'a'.repeat(32), enabled: true, base_url: 'http://old.example:8020', token: 'should-never-leak' };
  const write = value => fs.writeFile(path.join(directory, 'install-share.json'), JSON.stringify(value));
  await write(share);
  assert.equal((await installAccess(directory)).available, false);
  for (const name of ['ResearchWiki-一键安装.md', 'researchwiki-install.mjs']) await fs.writeFile(path.join(directory, name), 'published fixture');
  assert.deepEqual(await installAccess(directory), {
    available: true,
    document_path: `/agent/install/${share.id}/researchwiki-install.md`,
    installer_path: `/agent/install/${share.id}/researchwiki-install.mjs`,
  });
  assert.equal((await installAccess(directory, false)).available, false);
  await write({ ...share, enabled: false });
  assert.equal((await installAccess(directory)).available, false);
  await write({ ...share, id: '../invalid' });
  assert.equal((await installAccess(directory)).available, false);
  await fs.writeFile(path.join(directory, 'install-share.json'), '{broken');
  assert.equal((await installAccess(directory)).available, false);
});
