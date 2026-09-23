import fs from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { config, dataPath } from '../common.mjs';

const mcpUrl = `http://127.0.0.1:${config.mcpPort}/mcp`;
let clientPromise = null;

async function connect() {
  const token = (await fs.readFile(dataPath('runtime', 'mcp-read-token'), 'utf8')).trim();
  const client = new Client({ name: 'investment-wiki-web', version: '0.2.0' });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  transport.onclose = () => { clientPromise = null; };
  transport.onerror = () => { clientPromise = null; };
  return client;
}

async function getClient() {
  if (!clientPromise) clientPromise = connect().catch(e => { clientPromise = null; throw e; });
  return clientPromise;
}

function parseResult(result) {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content?.find(c => c.type === 'text')?.text ?? '';
  try { return JSON.parse(text); }
  catch { return text; }
}

/** Call an MCP tool; reconnects once when the transport has gone away. */
export async function callTool(name, args, { timeoutMs = 60000 } = {}) {
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      const client = await getClient();
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
      if (result.isError) {
        const text = result.content?.find(c => c.type === 'text')?.text ?? 'MCP 调用失败';
        throw new Error(text);
      }
      return { data: parseResult(result), meta: result._meta ?? null };
    } catch (e) {
      clientPromise = null;
      if (attempt >= 2) throw e;
    }
  }
}

export async function mcpHealth() {
  try {
    const res = await fetch(`http://127.0.0.1:${config.mcpPort}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { ok: false, error: `GBrain 健康检查返回 HTTP ${res.status}` };
    const body = await res.json();
    return { ok: body.status === 'ok', version: body.version ?? null, error: body.status === 'ok' ? null : 'GBrain 健康检查未通过' };
  } catch (error) {
    return { ok: false, error: error.cause?.code === 'ECONNREFUSED' ? `GBrain 未启动或未监听 ${config.mcpPort} 端口` : `无法连接 GBrain :${config.mcpPort}（${error.name === 'TimeoutError' ? '检查超时' : '连接失败'}）` };
  }
}
