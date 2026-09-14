import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { agentRequest } from './agent/client.mjs';
import { config, repo, dataPath } from './common.mjs';
import { withRead } from './query/store.mjs';
import { filterSql, validateFilters } from './query/contract.mjs';
import { closeDb } from './server/db.mjs';

const checks = [], start = Date.now();
async function check(name, fn) { const at = Date.now(); await fn(); checks.push({ name, passed: true, latency_ms: Date.now() - at }); console.error(`PASS ${name}`); }
let mcp;
try {
  const capabilities = await agentRequest('describe');
  await check('capabilities and complete catalog', async () => { assert.equal(capabilities.results[0].operations.length, 6); assert.ok(capabilities.coverage.documents > 0); assert.equal(capabilities.coverage.complete, true); });
  const dictionary = await agentRequest('describe', { section: 'tags', limit: 20 });
  const tag = dictionary.results.find(t => t.n >= 3 && t.n <= 1000)?.tag ?? dictionary.results[0].tag;
  const filter = { field: 'tags', op: 'contains_all', value: [tag] };
  let page;
  await check('exact tag query and snapshot pagination', async () => {
    page = await agentRequest('query', { filters: filter, limit: 1 });
    assert.ok(page.total >= 2); assert.ok(page.results[0].metadata.tags.includes(tag));
    const next = await agentRequest('query', { cursor: page.next_cursor, limit: 1 });
    assert.notEqual(next.results[0].document_id, page.results[0].document_id);
    assert.equal(next.snapshot_id, page.snapshot_id);
    await assert.rejects(agentRequest('query', { cursor: page.next_cursor, q: 'changed' }), e => e.code === 'CURSOR_MISMATCH');
  });
  await check('contradictory tags return zero, with no silent broadening', async () => {
    const x = await agentRequest('query', { filters: { all: [filter, { field: 'tags', op: 'contains_none', value: [tag] }] } });
    assert.equal(x.total, 0); assert.equal(x.results.length, 0);
  });
  await check('SQL filter semantics for nulls, dates, leading zeroes and hostile strings', async () => {
    const fixture = [{ id: 'a', tags: ['代码:00700.HK', "领域:O'Reilly_%"], published_at: '2026-08-01' }, { id: 'b', tags: ['代码:700.HK'], published_at: null }, { id: 'c', tags: ['代码:00700.HK'], published_at: '2026-06-01' }];
    const filters = [
      [{ field: 'tags', op: 'contains_all', value: ['代码:00700.HK'] }, ['a', 'c']],
      [{ field: 'tags', op: 'contains_any', value: ["领域:O'Reilly_%"] }, ['a']],
      [{ field: 'tags', op: 'contains_none', value: ['代码:00700.HK'] }, ['b']],
      [{ field: 'published_at', op: 'gte', value: '2026-07-01' }, ['a']],
      [{ field: 'published_at', op: 'exists', value: false }, ['b']],
    ];
    for (const [f, expected] of filters) {
      const values = [fixture], where = filterSql(validateFilters(f), values);
      const rows = await withRead(run => run(`WITH d AS (SELECT x->>'id' AS id,x AS metadata FROM jsonb_array_elements($1::jsonb) x) SELECT id FROM d WHERE ${where} ORDER BY id`, values));
      assert.deepEqual(rows.map(r => r.id), expected);
    }
  });
  const doc = page.results[0];
  await check('document resolve preserves stable ID', async () => { const x = await agentRequest('resolve', { q: doc.document_id }); assert.equal(x.results[0].document_id, doc.document_id); });
  await check('title lookup through shared search', async () => {
    const x = await agentRequest('search', { query: doc.title, mode: 'lexical', filters: filter, limit: 5, explain: true, timeout_ms: 30000 });
    assert.ok(x.results.some(r => r.document_id === doc.document_id));
    assert.ok(x.results.every(r => r.metadata.tags.includes(tag)));
  });
  await check('outline, exact original block and revision mismatch', async () => {
    const outline = await agentRequest('read', { id: doc.document_id, revision_id: doc.revision_id, view: 'outline', limit: 1 });
    const block = outline.results[0]; assert.ok(block.block_id);
    const read = await agentRequest('read', { id: doc.document_id, revision_id: doc.revision_id, view: 'blocks', block_id: block.block_id });
    assert.equal(read.results[0].block_id, block.block_id); assert.equal(read.results[0].pdf_page, block.pdf_page); assert.ok(read.results[0].text);
    await assert.rejects(agentRequest('read', { id: doc.document_id, revision_id: '0'.repeat(64), view: 'blocks' }), e => e.code === 'REVISION_UNAVAILABLE');
  });
  await check('parsed-only document is searchable without a model', async () => {
    const docs = await agentRequest('query', { filters: { field: 'status', op: 'eq', value: 'parsed' }, limit: 1 });
    assert.ok(docs.total > 0);
    const target = docs.results[0];
    const found = await agentRequest('search', { query: target.title, mode: 'lexical', filters: { field: 'status', op: 'eq', value: 'parsed' }, limit: 5, timeout_ms: 30000 });
    assert.ok(found.results.some(r => r.document_id === target.document_id));
  });
  await check('invalid fields fail loudly', async () => { await assert.rejects(agentRequest('query', { filters: { field: 'typo', op: 'eq', value: 'x' } }), e => e.code === 'INVALID_ARGUMENT'); });
  await check('read token cannot authorize write routes', async () => {
    const token = (await fs.readFile(dataPath('runtime', 'mcp-read-token'), 'utf8')).trim();
    const response = await fetch(`http://127.0.0.1:${config.port}/api/page/claims/never-created`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 403);
    const invalid = await fetch(`http://127.0.0.1:${config.port}/api/research/query`, { method: 'POST', headers: { authorization: 'Bearer invalid' }, body: '{}' });
    assert.equal(invalid.status, 403);
  });
  await check('MCP tool inventory and results match HTTP', async () => {
    mcp = new Client({ name: 'researchwiki-verifier', version: '1' });
    await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [repo + '/scripts/mcp-stdio.mjs'], stderr: 'pipe' }));
    const inventory = await mcp.listTools(); assert.equal(inventory.tools.length, 6);
    const viaMcp = await mcp.callTool({ name: 'research_query', arguments: { filters: filter, limit: 1 } });
    assert.ok(!viaMcp.isError); assert.equal(viaMcp.structuredContent.results[0].document_id, doc.document_id);
    const denied = await mcp.callTool({ name: 'put_page', arguments: {} }); assert.equal(denied.isError, true);
  });
  const report = { at: new Date().toISOString(), checks, elapsed_ms: Date.now() - start, coverage: capabilities.coverage, note: 'Contract and real-corpus acceptance, not a labeled semantic-relevance benchmark.' };
  await fs.mkdir(new URL('../outputs/', import.meta.url), { recursive: true });
  await fs.writeFile(new URL('../outputs/agent-access-verification.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: checks.length, elapsed_ms: report.elapsed_ms, documents: capabilities.coverage.documents, text_ready: capabilities.coverage.text_ready }));
} finally { if (mcp) await mcp.close(); await closeDb(); }
