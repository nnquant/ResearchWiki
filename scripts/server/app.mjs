import http from 'node:http';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { preferredEncoding } from './encoding.mjs';
import { config } from '../common.mjs';
import { createRouter } from './router.mjs';
import { securityHeaders, assertHost, assertOrigin, assertCsrf, MUTATING_METHODS } from './security.mjs';
import { HttpError, isReply } from './errors.mjs';
import { registerPageRoutes } from './routes/pages.mjs';
import { registerSearchRoutes } from './routes/search.mjs';
import { registerGraphRoutes } from './routes/graph.mjs';
import { registerEditRoutes } from './routes/edit.mjs';
import { registerIngestRoutes } from './routes/ingest.mjs';
import { registerStatusRoutes } from './routes/status.mjs';
import { registerAssetRoutes } from './routes/assets.mjs';
import { serveStatic, warmStatic } from './routes/static.mjs';
import { startEmbeddingWarmer } from './search-service.mjs';
import { registerResearchRoutes, isAgentReadRequest } from './routes/research.mjs';
import { startQueryRefresh } from '../query/refresh.mjs';
import { listenAgent } from '../agent/http.mjs';
import { registerEntityGovernanceRoutes } from './routes/entity-governance.mjs';

const compress = promisify(gzip);
async function sendJson(res, status, data) {
  let body = Buffer.from(JSON.stringify(data));
  res.setHeader('vary', 'Accept-Encoding');
  if (body.length > 1024 && preferredEncoding(res.req.headers['accept-encoding'], ['gzip'])) {
    body = await compress(body); res.setHeader('content-encoding', 'gzip');
  }
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.writeHead(status);
  res.end(body);
}

function errorStatus(error) {
  if (error instanceof HttpError) return error.status;
  if (error.code === 'ENOENT') return 404;
  if (error instanceof SyntaxError) return 400;
  return 500;
}

export function createApp() {
  void warmStatic();
  const router = createRouter();
  registerStatusRoutes(router);
  registerPageRoutes(router);
  registerSearchRoutes(router);
  registerResearchRoutes(router);
  registerGraphRoutes(router);
  registerEntityGovernanceRoutes(router);
  registerEditRoutes(router);
  registerIngestRoutes(router);
  registerAssetRoutes(router);

  const server = http.createServer(async (req, res) => {
    securityHeaders(res);
    try {
      assertHost(req);
      const url = new URL(req.url, `http://127.0.0.1:${config.port}`);
      assertOrigin(req);
      if (MUTATING_METHODS.has(req.method) && !await isAgentReadRequest(req, url.pathname)) assertCsrf(req);
      const matched = router.match(req.method, url.pathname);
      if (matched) {
        const out = await matched.handler({ req, res, url, params: matched.params });
        if (res.writableEnded || res.headersSent) return;
        if (isReply(out)) return sendJson(res, out.status, out.data);
        return sendJson(res, 200, out ?? null);
      }
      if (await serveStatic(req, res, url.pathname)) return;
      sendJson(res, 404, { error: '接口不存在' });
    } catch (error) {
      const status = errorStatus(error);
      if (status >= 500) console.error(`[wiki] ${req.method} ${req.url}:`, error);
      if (res.headersSent) { res.end(); return; }
      if (status === 429) res.setHeader('retry-after', String(error.data?.retry_after ?? 2));
      sendJson(res, status, { error: error.message, ...(error.data ?? {}) });
    }
  });

  startEmbeddingWarmer();
  return server;
}

export function listen() {
  const server = createApp();
  const agent = listenAgent();
  server.once('close', () => agent?.close());
  const stopRefresh = startQueryRefresh();
  server.once('close', stopRefresh);
  server.listen(config.port, config.host, () => console.log(`ResearchWiki: http://${config.host}:${config.port}`));
  return server;
}
