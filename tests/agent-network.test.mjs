import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { agentSettings, createAgentHttpServer } from '../scripts/agent/http-server.mjs';
import { readTokenAuth } from '../scripts/agent/auth.mjs';
import { connection } from '../scripts/agent/client.mjs';
import { packageAgent } from '../scripts/agent/package.mjs';
import { filterSql, validateFilters } from '../scripts/query/contract.mjs';
import { installDownloads } from '../scripts/agent/install-downloads.mjs';

const work = path.resolve('work', `agent-network-${process.pid}`), token = randomUUID();
await fs.mkdir(work, { recursive: true });
const tokenFile = path.join(work, 'token'); await fs.writeFile(tokenFile, token);
const shareId = 'a'.repeat(32);
await fs.writeFile(path.join(work, 'install-share.json'), JSON.stringify({ id: shareId, enabled: true }));
await fs.writeFile(path.join(work, 'ResearchWiki-一键安装.md'), '# Fixture install guide');
await fs.writeFile(path.join(work, 'researchwiki-install.mjs'), '// Fixture installer');
let pending;
const fixture = { schema_version: 'research-query-v1', request_id: 'fixture', results: [{ document_id: 'doc:1', open_url: '/page/sources/test', indexed_at: new Date('2026-09-14T00:00:00Z') }],
  provenance: { raw_url: '/assets/raw/test.pdf' }, next_cursor: null, truncated: false };
const settings = agentSettings({ host: '127.0.0.1', port: 8018, agent: { port: 8020, publicBaseUrl: 'https://kb.example/research', maxConcurrent: 1 } });
const server = createAgentHttpServer({ settings, authorize: readTokenAuth(tokenFile), execute: async (op, input, { signal }) => {
  if (input.wait) await new Promise(resolve => { pending = resolve; signal.addEventListener('abort', resolve, { once: true }); });
  return { ...fixture, operation: op, input };
}, assetHandler: async (_req, res) => { res.end('fixture PDF'); }, installHandler: installDownloads(work) });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
settings.allowedHosts.push(new URL(base).host);
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
test.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(work, { recursive: true, force: true }); });

test('remote connection never falls back to local server credentials', async () => {
  await assert.rejects(connection({ baseUrl: base }, {}), { code: 'AUTH_REQUIRED' });
  const remote = await connection({}, { RESEARCHWIKI_URL: base, RESEARCHWIKI_TOKEN_FILE: tokenFile });
  assert.equal(remote.baseUrl, base); assert.equal(remote.token, token);
  await assert.rejects(connection({ baseUrl: 'https://user:secret@kb.example' }, { RESEARCHWIKI_TOKEN: token }), { code: 'INVALID_ARGUMENT' });
});

test('Bearer is required for HTTP, MCP, health and original files; CSRF is not authentication', async () => {
  for (const route of ['/api/research/query', '/mcp', '/health', '/assets/raw/test.pdf']) {
    const response = await fetch(base + route, { headers: { 'x-wiki-token': 'anything' } });
    assert.equal(response.status, 401, route);
  }
  assert.equal((await fetch(base + '/health', { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal(await (await fetch(base + '/assets/raw/test.pdf', { headers })).text(), 'fixture PDF');
});

test('remote surface contains no Wiki status, mutation or management endpoints', async () => {
  for (const route of ['/api/status', '/api/edit', '/api/ingest', '/api/research/delete', '/']) {
    assert.equal((await fetch(base + route, { method: 'POST', headers, body: '{}' })).status, 404, route);
  }
});

test('published install pair downloads without Bearer, supports HEAD and cannot expose other private files', async () => {
  for (const name of ['researchwiki-install.md', 'researchwiki-install.mjs']) {
    const response = await fetch(`${base}/install/${shareId}/${name}`);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok((await response.text()).includes('Fixture'));
    const head = await fetch(`${base}/install/${shareId}/${name}`, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.ok(Number(head.headers.get('content-length')) > 0); assert.equal(await head.text(), '');
    assert.equal((await fetch(`${base}/install/${shareId}/${name}`, { method: 'POST' })).status, 404);
  }
  for (const route of [`/install/${'b'.repeat(32)}/researchwiki-install.md`, `/install/${shareId}/token`,
    `/install/${shareId}/install-share.json`, `/install/${shareId}/%2e%2e%2ftoken`, `/install/${shareId}/`]) {
    assert.equal((await fetch(base + route)).status, 404, route);
  }
  assert.equal((await fetch(base + '/api/research/query')).status, 401);
});

test('disabling an installation share revokes downloads immediately', async () => {
  await fs.writeFile(path.join(work, 'install-share.json'), JSON.stringify({ id: shareId, enabled: false }));
  try { assert.equal((await fetch(`${base}/install/${shareId}/researchwiki-install.md`)).status, 404); }
  finally { await fs.writeFile(path.join(work, 'install-share.json'), JSON.stringify({ id: shareId, enabled: true })); }
});

test('HTTP preserves query filters and makes original links usable through configured public prefix', async () => {
  const input = { filters: { field: 'tags', op: 'contains_all', value: ['领域:DRAM', '公司:000001'] } };
  const response = await fetch(base + '/api/research/query', { method: 'POST', headers, body: JSON.stringify(input) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.input, input);
  assert.equal(result.provenance.raw_url, 'https://kb.example/research/assets/raw/test.pdf');
  assert.equal(result.results[0].open_url, null);
  assert.equal(result.results[0].indexed_at, '2026-09-14T00:00:00.000Z');
});

test('MCP SDK initializes, lists six read tools and calls same service over Streamable HTTP', async () => {
  const client = new Client({ name: 'remote-acceptance', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers } }));
    const list = await client.listTools(); assert.equal(list.tools.length, 6);
    assert.ok(list.tools.every(tool => tool.annotations.readOnlyHint));
    const result = await client.callTool({ name: 'research_query', arguments: { limit: 1 } });
    assert.ok(!result.isError); assert.equal(result.structuredContent.operation, 'query');
    assert.deepEqual(result.structuredContent.input, { limit: 1 });
  } finally { await client.close(); }
});

test('invalid Host and Origin rejected, configured HTTPS proxy origin accepted', async () => {
  const status = await new Promise((resolve, reject) => {
    const req = http.get(base + '/health', { headers: { ...headers, host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject);
  });
  assert.equal(status, 403);
  assert.equal((await fetch(base + '/health', { headers: { ...headers, origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await fetch(base + '/health', { headers: { ...headers, origin: 'https://kb.example' } })).status, 200);
});

test('payload bounds and concurrent requests are enforced', async () => {
  assert.equal((await fetch(base + '/api/research/query', { method: 'POST', headers, body: '{' })).status, 400);
  assert.equal((await fetch(base + '/api/research/query', { method: 'POST', headers, body: JSON.stringify({ q: 'x'.repeat(65536) }) })).status, 413);
  const first = fetch(base + '/api/research/query', { method: 'POST', headers, body: '{"wait":true}' });
  while (!pending) await new Promise(resolve => setTimeout(resolve, 5));
  try { assert.equal((await fetch(base + '/health', { headers })).status, 429); }
  finally { pending(); await first; }
});

test('portable CLI runs outside repository without config, data, database or node_modules', async () => {
  const target = await packageAgent(path.join(work, 'portable'));
  assert.equal(await fs.access(path.join(target, 'config.json')).then(() => true, () => false), false);
  const result = await new Promise((resolve, reject) => {
    const env = { ...process.env, RESEARCHWIKI_URL: base, RESEARCHWIKI_TOKEN_FILE: tokenFile };
    delete env.RESEARCHWIKI_TOKEN;
    const child = spawn(process.execPath, [path.join(target, 'scripts/agent/cli.mjs'), 'query', '--tag', '公司:000001'], { cwd: target, env, windowsHide: true });
    let stdout = '', stderr = ''; child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0, result.stderr + result.stdout);
  const params = []; const sql = filterSql(validateFilters(JSON.parse(result.stdout).input.filters), params);
  assert.match(sql, /\?&/); assert.deepEqual(params, ['tags', ['公司:000001']]);
});

test('stdio MCP bridge uses remote URL and never requires local knowledge-base configuration', async () => {
  const target = await packageAgent(path.join(work, 'portable-stdio'));
  const client = new Client({ name: 'stdio-network-acceptance', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(target, 'scripts/agent/mcp.mjs')], cwd: target,
      env: { RESEARCHWIKI_URL: base, RESEARCHWIKI_TOKEN_FILE: tokenFile }, stderr: 'pipe' }));
    assert.equal((await client.listTools()).tools.length, 6);
    const result = await client.callTool({ name: 'research_query', arguments: { limit: 1 } });
    assert.ok(!result.isError); assert.equal(result.structuredContent.operation, 'query');
  } finally { await client.close(); }
});
