import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { agentRequest, connection } from './client.mjs';

// Run this on the actual Agent machine to verify its network, credentials and full read path.
const { baseUrl, token } = await connection();
const checks = [], start = Date.now();
const headers = { authorization: `Bearer ${token}` };
const fetchWithTimeout = (url, options = {}) => fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000), ...options });
try {
  for (const route of ['/mcp', '/api/research/query', '/assets/raw/absent']) assert.equal((await fetchWithTimeout(baseUrl + route)).status, 401);
  checks.push('unauthenticated_access_rejected');
  assert.equal((await fetchWithTimeout(baseUrl + '/api/status', { headers })).status, 404);
  checks.push('wiki_management_not_exposed');
  const capabilities = await agentRequest('describe');
  assert.ok(capabilities.results[0].operations.includes('search')); checks.push('http_describe');
  const tags = await agentRequest('describe', { section: 'tags', limit: 1 });
  const tag = tags.results[0]?.tag;
  assert.ok(tag, '需要至少一个标签进行检索验收');
  const filters = { field: 'tags', op: 'contains_all', value: [tag] };
  const query = await agentRequest('query', { filters, fields: ['tags'], limit: 1 });
  assert.ok(query.results[0].metadata.tags.includes(tag));
  assert.ok(Number.isFinite(Date.parse(query.results[0].indexed_at)), '索引时间应保留为可解析的时间字符串');
  checks.push('tag_filtered_query');
  let nextPage;
  if (query.next_cursor) { nextPage = await agentRequest('query', { cursor: query.next_cursor, limit: 1 }); assert.notEqual(nextPage.results[0].document_id, query.results[0].document_id); checks.push('cursor_pagination'); }
  const empty = await agentRequest('query', { filters: { all: [filters, { field: 'tags', op: 'contains_none', value: [tag] }] } });
  assert.equal(empty.total, 0); checks.push('contradictory_tags_do_not_broaden');
  const doc = query.results[0];
  const search = await agentRequest('search', { query: doc.title, mode: 'lexical', filters, limit: 1, max_response_tokens: 16000 });
  assert.ok(search.results.length); checks.push('filtered_lexical_search');
  const metadata = await agentRequest('read', { id: doc.document_id, revision_id: doc.revision_id, view: 'metadata', max_response_tokens: 32000 });
  assert.equal(metadata.revision_id, doc.revision_id); checks.push('versioned_read');
  if (doc.text_available) { const blocks = await agentRequest('read', { id: doc.document_id, revision_id: doc.revision_id, view: 'blocks', limit: 1, max_response_tokens: 16000 }); assert.ok(blocks.results.length); checks.push('evidence_blocks'); }
  if (metadata.provenance.raw_url) {
    const url = new URL(metadata.provenance.raw_url);
    assert.equal(url.origin, new URL(baseUrl).origin, '原件下载地址必须是配置的同源地址');
    assert.equal((await fetchWithTimeout(url)).status, 401);
    const original = await fetchWithTimeout(url, { headers }); assert.equal(original.status, 200);
    const reader = original.body.getReader(); try { assert.ok((await reader.read()).value?.byteLength); } finally { await reader.cancel(); }
    checks.push('authenticated_original_download');
  }
  const client = new Client({ name: 'researchwiki-network-acceptance', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(baseUrl + '/mcp'), { requestInit: { headers } }));
    const tools = await client.listTools(); assert.equal(tools.tools.length, 7); checks.push('mcp_initialize_and_list');
    // Reuse a frozen cursor or immutable revision: live indexing may change tags between requests.
    const result = nextPage
      ? await client.callTool({ name: 'research_query', arguments: { cursor: query.next_cursor, limit: 1 } })
      : await client.callTool({ name: 'research_read', arguments: { id: doc.document_id, revision_id: doc.revision_id, view: 'metadata', max_response_tokens: 32000 } });
    assert.ok(!result.isError);
    if (nextPage) { assert.equal(result.structuredContent.total, nextPage.total); assert.deepEqual(result.structuredContent.results, nextPage.results); }
    else { assert.equal(result.structuredContent.revision_id, metadata.revision_id); assert.deepEqual(result.structuredContent.results, metadata.results); }
    checks.push('mcp_http_consistency');
  } finally { await client.close(); }
  console.log(JSON.stringify({ ok: true, base_url: baseUrl, checked_at: new Date().toISOString(), checks, elapsed_ms: Date.now() - start }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ ok: false, base_url: baseUrl, checks, error: error.message, code: error.code ?? 'VERIFICATION_FAILED' }, null, 2));
  process.exitCode = 1;
}
