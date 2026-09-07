import fs from 'node:fs/promises';
import path from 'node:path';
import { repo } from '../../common.mjs';

const distDir = path.join(repo, 'web', 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

const MISSING_BUILD = `<!doctype html><meta charset="utf-8"><title>投资研究 Wiki</title>
<body style="font-family:system-ui;background:#111214;color:#e6e6e6;padding:48px;line-height:1.7">
<h1 style="font-weight:600;font-size:20px">前端尚未构建</h1>
<p>请在项目目录运行 <code style="background:#1a1c1f;padding:2px 6px;border-radius:4px">npm run build</code>，然后刷新此页面。</p>
<p style="color:#8b8f96">开发模式：<code>npm run dev</code> 后访问 http://localhost:5173</p></body>`;

async function sendFile(res, file, { immutable = false } = {}) {
  const body = await fs.readFile(file);
  res.setHeader('content-type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.writeHead(200);
  res.end(body);
}

/**
 * Serve the Vite build. Hashed assets under /app/ are immutable; everything
 * else falls back to index.html so client-side routes deep-link correctly.
 */
export async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const indexFile = path.join(distDir, 'index.html');
  try { await fs.access(indexFile); }
  catch {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.writeHead(503);
    res.end(MISSING_BUILD);
    return true;
  }
  if (pathname !== '/' && !pathname.startsWith('/api/') && !pathname.startsWith('/assets/')) {
    const candidate = path.resolve(distDir, '.' + pathname);
    if (candidate.startsWith(distDir + path.sep)) {
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) {
          await sendFile(res, candidate, { immutable: pathname.startsWith('/app/') });
          return true;
        }
      } catch { /* fall through to SPA */ }
    }
  }
  if (pathname.startsWith('/api/') || pathname.startsWith('/assets/')) return false;
  await sendFile(res, indexFile);
  return true;
}
