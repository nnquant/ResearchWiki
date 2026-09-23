import http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createResearchMcp } from './mcp-server.mjs';
import { allowedRequestHosts } from '../server/allowed-hosts.mjs';
import { HttpError } from '../server/errors.mjs';

export function agentSettings(config) {
  const agent = config.agent ?? {};
  const port = agent.port ?? config.port + 2;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || [config.port, config.mcpPort].includes(port)) throw new Error('agent.port 必须是独立的有效端口');
  const settings = { enabled: agent.enabled !== false, host: agent.host ?? config.host, port,
    publicBaseUrl: agent.publicBaseUrl || null, wikiBaseUrl: agent.wikiBaseUrl || null, maxConcurrent: agent.maxConcurrent ?? 4 };
  if (!Number.isInteger(settings.maxConcurrent) || settings.maxConcurrent < 1 || settings.maxConcurrent > 100) throw new Error('agent.maxConcurrent 应为 1–100');
  for (const key of ['publicBaseUrl', 'wikiBaseUrl']) if (settings[key]) {
    const url = new URL(settings[key]);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error(`agent.${key} 必须是无凭据的 HTTP(S) 地址`);
    settings[key] = url.href.replace(/\/$/, '');
  }
  settings.allowedHosts = [...new Set([...allowedRequestHosts(settings), ...(settings.publicBaseUrl ? [new URL(settings.publicBaseUrl).host] : [])])];
  settings.allowedOrigins = [...settings.allowedHosts.map(host => `http://${host}`), ...(settings.publicBaseUrl ? [new URL(settings.publicBaseUrl).origin] : [])];
  return settings;
}

export function networkResult(value, baseUrl, wikiBaseUrl) {
  if (value instanceof Date) return value.toJSON();
  if (Array.isArray(value)) return value.map(item => networkResult(item, baseUrl, wikiBaseUrl));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (key === 'raw_url' && typeof item === 'string' && item.startsWith('/assets/')) return [key, baseUrl + item];
    if (key === 'open_url' && typeof item === 'string' && item.startsWith('/page/')) return [key, wikiBaseUrl ? wikiBaseUrl + item : null];
    return [key, networkResult(item, baseUrl, wikiBaseUrl)];
  }));
}

async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new HttpError(413, '请求体超过 64 KiB', { code: 'PAYLOAD_TOO_LARGE' });
    chunks.push(chunk);
  }
  try { return size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
  catch { throw new HttpError(400, '请求体不是有效的 JSON', { code: 'INVALID_ARGUMENT' }); }
}
function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/** Dedicated authenticated surface: never registers Wiki status, edit, ingest or admin routes. */
export function createAgentHttpHandler({ settings, authorize, execute, assetHandler, installHandler, health = async () => ({}), sharedAdmission = false }) {
  let active = 0;
  return async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'; sandbox");
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', cancel);
    let entered = false;
    try {
      if (!settings.allowedHosts.includes(req.headers.host?.toLowerCase())) throw new HttpError(403, '不接受此 Host', { code: 'FORBIDDEN_HOST' });
      if (req.headers.origin && !settings.allowedOrigins.includes(req.headers.origin)) throw new HttpError(403, '不接受此 Origin', { code: 'FORBIDDEN_ORIGIN' });
      const url = new URL(req.url, 'http://localhost');
      if (settings.basePath) {
        if (!url.pathname.startsWith(settings.basePath + '/') && url.pathname !== settings.basePath) throw new HttpError(404, '接口不存在');
        url.pathname = url.pathname.slice(settings.basePath.length) || '/';
      }
      const baseUrl = settings.publicBaseUrl ?? `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host.toLowerCase()}${settings.basePath ?? ''}`;
      if (url.pathname.startsWith('/install/')) {
        if (installHandler && await installHandler(req, res, url, { baseUrl })) return;
        throw new HttpError(404, '安装资源不存在', { code: 'NOT_FOUND' });
      }
      if (!await authorize(req)) {
        res.setHeader('www-authenticate', 'Bearer realm="ResearchWiki"');
        throw new HttpError(401, '需要有效的只读 Bearer token', { code: 'UNAUTHORIZED' });
      }
      if (!sharedAdmission && active >= settings.maxConcurrent) {
        res.setHeader('retry-after', '2');
        throw new HttpError(429, '研究服务繁忙，请稍后重试', { code: 'TOO_MANY_REQUESTS' });
      }
      active++; entered = true;
      const invoke = async (operation, input, { signal } = {}) => {
        const started = Date.now(); let result, failure;
        try {
          result = await execute(operation, input, { signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
          return networkResult(result, baseUrl, settings.wikiBaseUrl);
        } catch (e) { failure = e; throw e; }
        finally {
          const latency_ms = Date.now() - started;
          if (failure || latency_ms >= 1000) console.warn('[research-request] ' + JSON.stringify({ operation, latency_ms,
            code: failure?.data?.code ?? (failure ? 'REQUEST_FAILED' : 'OK'), request_id: result?.request_id,
            timings: failure?.queryTimings ?? result?.query_plan?.timings }));
        }
      };
      if (req.method === 'GET' && url.pathname === '/health') {
        const details = await health();
        return json(res, details.database === false ? 503 : 200, { status: details.database === false ? 'degraded' : 'ok', surface: 'research-read', mcp_url: baseUrl + '/mcp', ...details });
      }
      if (url.pathname === '/mcp') {
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST');
          return json(res, 405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Use stateless Streamable HTTP POST' } });
        }
        const input = await body(req);
        const mcp = createResearchMcp(invoke);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        const close = () => { void mcp.close().catch(() => {}); };
        res.once('close', close);
        try { await mcp.connect(transport); await transport.handleRequest(req, res, input); }
        finally { await mcp.close(); res.removeListener('close', close); }
        return;
      }
      const operation = url.pathname.match(/^\/api\/research\/(describe|resolve|query|search|read|related|graph)$/)?.[1];
      if (operation) {
        if (req.method !== 'POST') { res.setHeader('allow', 'POST'); throw new HttpError(405, '请使用 POST'); }
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, '请使用 application/json');
        return json(res, 200, await invoke(operation, await body(req)));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/assets/') && assetHandler) return await assetHandler(req, res, url);
      throw new HttpError(404, '接口不存在', { code: 'NOT_FOUND' });
    } catch (error) {
      if (res.headersSent || res.destroyed) { res.end(); return; }
      const status = error.status ?? (error.code === 'ENOENT' ? 404 : 500);
      if (status === 429) res.setHeader('retry-after', String(error.data?.retry_after ?? 2));
      json(res, status, { error: status >= 500 ? '研究服务暂时不可用' : error.message, code: error.data?.code ?? (status >= 500 ? 'SERVICE_UNAVAILABLE' : 'REQUEST_FAILED') });
    } finally { if (entered) active--; res.removeListener('close', cancel); }
  };
}

export function createAgentHttpServer(options) {
  const server = http.createServer(createAgentHttpHandler(options));
  server.requestTimeout = 130000;
  server.headersTimeout = 15000;
  return server;
}
