import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

// Generated self-contained installer. Includes the read credential supplied by the owner.
const payload = JSON.parse(gunzipSync(Buffer.from('__RESEARCHWIKI_PAYLOAD__', 'base64')).toString('utf8'));
// Filled by the download endpoint; offline copies retain the packaged fallback.
const servedBase = "__RESEARCHWIKI_SERVED_BASE__";
try {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('需要 Node.js 22 或更新版本');
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!['--target', '--base-url', '--from-url'].includes(flag) || !args[i+1] || args[i+1].startsWith('--') || options[flag]) throw new Error('用法：node researchwiki-install.mjs [--target 技能目录] [--base-url 服务地址] [--from-url 安装文档或脚本网址]');
    options[flag] = args[i+1];
  }
  let fromBase;
  if (options['--from-url']) {
    const from = new URL(options['--from-url']);
    if (!['http:', 'https:'].includes(from.protocol) || from.username || from.password || !/\/install\/[A-Za-z0-9_-]{32}\/researchwiki-install\.(md|mjs)$/.test(from.pathname)) throw new Error('--from-url 应为完整的安装文档或脚本 URL');
    fromBase = from.origin + from.pathname.replace(/\/install\/[^/]+\/researchwiki-install\.(md|mjs)$/, '');
  }
  const url = new URL(options['--base-url'] ?? fromBase ?? (servedBase.startsWith('__RESEARCHWIKI_') ? payload.connection.base_url : servedBase));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('--base-url 必须是无凭据、无查询参数的 HTTP(S) 服务地址');
  const connection = { ...payload.connection, base_url: url.href.replace(/\/$/, '') };
  const target = path.resolve(options['--target'] ?? path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills', 'research-wiki'));
  const marker = path.join(target, '.researchwiki-installed.json');
  let existing;
  try { existing = await fs.lstat(target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('目标必须是普通目录，不能是符号链接');
    const entries = await fs.readdir(target);
    const owned = await fs.readFile(marker, 'utf8').then(JSON.parse).catch(() => null);
    if (entries.length && owned?.installer !== 'researchwiki-share-v1') throw new Error('目标已有其他内容，未覆盖。请用 --target 指定新的 research-wiki 目录');
  }
  await fs.mkdir(target, { recursive: true, mode: 0o700 });
  // Verify every output path before overwriting an installation managed by this installer.
  const files = { ...payload.files, 'connection.json': JSON.stringify(connection, null, 2) + '\n',
    '.researchwiki-installed.json': JSON.stringify({ installer: 'researchwiki-share-v1', installed_at: new Date().toISOString() }) + '\n',
    '.gitignore': 'connection.json\n' };
  for (const relative of Object.keys(files)) {
    const file = path.resolve(target, relative);
    if (!file.startsWith(target + path.sep)) throw new Error('安装包包含越界路径');
    for (let current = file; current !== target; current = path.dirname(current)) {
      const stat = await fs.lstat(current).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
      if (stat?.isSymbolicLink()) throw new Error('安装路径包含符号链接，未覆盖');
    }
  }
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(target, relative);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fs.writeFile(file, contents.replaceAll('__RESEARCHWIKI_SKILL_DIR__', target.replaceAll('\\', '/')), { mode: 0o600 });
    if (relative === 'connection.json' && process.platform !== 'win32') await fs.chmod(file, 0o600);
  }
  const entry = path.join(target, 'scripts/research.mjs');
  const verifyEnv = { ...process.env, RESEARCHWIKI_URL: connection.base_url, RESEARCHWIKI_TOKEN: connection.token };
  delete verifyEnv.RESEARCHWIKI_TOKEN_FILE;
  const check = spawnSync(process.execPath, [entry, 'describe'], { encoding: 'utf8', windowsHide: true, timeout: 25000, env: verifyEnv });
  console.log('Skill 已安装到：' + target);
  console.log('服务地址：' + connection.base_url);
  console.log('查询入口：node ' + JSON.stringify(entry) + ' describe');
  if (check.error || check.status !== 0) {
    let reason = '请求失败';
    try { reason = JSON.parse(check.stdout).code || reason; } catch { /* never echo raw output or secrets */ }
    console.log('连接验证失败（' + reason + '）。检查到知识库服务器的网络权限及 token；安装文件已保留，可用上述命令重试。');
    process.exitCode = 1;
  } else {
    const result = JSON.parse(check.stdout);
    if (!result.results?.[0]?.operations?.includes('search')) throw new Error('服务响应不是 ResearchWiki 能力声明');
    console.log('连接验证通过。请刷新技能列表或新开会话，然后让 Agent 查询知识库。');
  }
} catch (e) { console.error(e.message); process.exitCode = 1; }
