import http from 'node:http';
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
import { serveStatic } from './routes/static.mjs';
import { startEmbeddingWarmer } from './search-service.mjs';

function sendJson(res, status, data) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.writeHead(status);
  res.end(JSON.stringify(data));
}

function errorStatus(error) {
  if (error instanceof HttpError) return error.status;
  if (error.code === 'ENOENT') return 404;
  if (error instanceof SyntaxError) return 400;
  return 500;
}

export function createApp() {
  const router = createRouter();
  registerStatusRoutes(router);
  registerPageRoutes(router);
  registerSearchRoutes(router);
  registerGraphRoutes(router);
  registerEditRoutes(router);
  registerIngestRoutes(router);
  registerAssetRoutes(router);

  const server = http.createServer(async (req, res) => {
    securityHeaders(res);
    try {
      assertHost(req);
      const url = new URL(req.url, `http://127.0.0.1:${config.port}`);
      assertOrigin(req);
      if (MUTATING_METHODS.has(req.method)) assertCsrf(req);
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
      sendJson(res, status, { error: error.message, ...(error.data ?? {}) });
    }
  });

  startEmbeddingWarmer();
  return server;
}

export function listen() {
  const server = createApp();
  server.listen(config.port, config.host, () => console.log(`量化研究 Wiki: http://${config.host}:${config.port}`));
  return server;
}
