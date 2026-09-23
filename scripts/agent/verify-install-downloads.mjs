import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { repo } from '../common.mjs';
import { renderInstallDownload } from './install-downloads.mjs';

const baseUrl = process.argv[2]?.replace(/\/$/, '');
if (!baseUrl) throw new Error('请提供 Agent 服务地址');
const directory = path.join(repo, 'outputs/private');
const share = JSON.parse(await fs.readFile(path.join(directory, 'install-share.json'), 'utf8'));
const work = path.join(repo, 'work', `install-download-check-${process.pid}`);
await fs.mkdir(work, { recursive: true });
const checks = [], hashes = {};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const [name, original] of [['researchwiki-install.md', 'ResearchWiki-一键安装.md'], ['researchwiki-install.mjs', 'researchwiki-install.mjs']]) {
  const url = `${baseUrl}/install/${share.id}/${name}`;
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const bytes = Buffer.from(await response.arrayBuffer());
  hashes[name] = hash(bytes);
  assert.equal(hashes[name], hash(renderInstallDownload(await fs.readFile(path.join(directory, original)), { baseUrl, defaultBaseUrl: share.base_url })), '下载内容应与当前入口渲染的发布文件一致');
  await fs.writeFile(path.join(work, name), bytes);
  checks.push(`${name}:download_matches_published_file`);
}
assert.equal((await fetch(`${baseUrl}/api/research/query`, { signal: AbortSignal.timeout(10000) })).status, 401);
checks.push('research_api_still_requires_bearer');
assert.equal((await fetch(`${baseUrl}/install/${share.id}/install-share.json`, { signal: AbortSignal.timeout(10000) })).status, 404);
checks.push('private_manifest_not_exposed');
const installed = spawnSync(process.execPath, [path.join(work, 'researchwiki-install.mjs'), '--target', path.join(work, 'research-wiki')],
  { windowsHide: true, encoding: 'utf8', timeout: 30000 });
assert.equal(installed.status, 0, '下载的安装器必须成功执行并通过实库连接验证');
assert.ok(installed.stdout.includes('连接验证通过'));
assert.equal(JSON.parse(await fs.readFile(path.join(work, 'research-wiki/connection.json'), 'utf8')).base_url, baseUrl);
checks.push('downloaded_installer_connects_to_live_knowledge_base');
const report = { ok: true, base_url: baseUrl, checked_at: new Date().toISOString(), checks, sha256: hashes };
await fs.writeFile(path.join(repo, 'outputs/install-download-verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
