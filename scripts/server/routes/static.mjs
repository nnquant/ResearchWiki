import fs from 'node:fs/promises';
import path from 'node:path';
import { repo, sha } from '../../common.mjs';
import { preferredEncoding } from '../encoding.mjs';

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

const assets = new Map();
let warming;
export function warmStatic() {
  return warming ??= (async () => {
    async function walk(dir) {
      for (const item of await fs.readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, item.name);
        if (item.isDirectory()) await walk(file);
        else if (!/\.(br|gz)$/.test(file)) await cachedFile(file);
      }
    }
    await walk(distDir);
  })().catch(() => { warming = null; });
}
async function cachedFile(file) {
  const stat = await fs.stat(file), key = `${stat.mtimeMs}:${stat.size}`;
  if (assets.get(file)?.key === key) return assets.get(file);
  const body = await fs.readFile(file), versions = { identity: body };
  for (const [encoding, extension] of [['br', 'br'], ['gzip', 'gz']]) {
    try {
      const packed = await fs.stat(`${file}.${extension}`);
      if (packed.mtimeMs >= stat.mtimeMs) versions[encoding] = await fs.readFile(`${file}.${extension}`);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  const value = { key, versions, etag: `W/"${sha(body).slice(0, 32)}"` };
  assets.set(file, value); return value;
}
async function sendFile(req, res, file, { immutable = false } = {}) {
  const asset = await cachedFile(file);
  const encoding = preferredEncoding(req.headers['accept-encoding'], Object.keys(asset.versions).filter(e => e !== 'identity'));
  const body = asset.versions[encoding ?? 'identity'];
  res.setHeader('content-type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.setHeader('vary', 'Accept-Encoding');
  res.setHeader('etag', asset.etag);
  if (encoding) res.setHeader('content-encoding', encoding);
  if (String(req.headers['if-none-match'] ?? '').split(',').some(tag => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === asset.etag.replace(/^W\//, ''))) {
    res.writeHead(304); res.end(); return;
  }
  res.setHeader('content-length', body.length);
  res.writeHead(200);
  res.end(req.method === 'HEAD' ? undefined : body);
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
    res.end(req.method === 'HEAD' ? undefined : MISSING_BUILD);
    return true;
  }
  if (pathname !== '/' && !pathname.startsWith('/api/') && !pathname.startsWith('/assets/')) {
    const candidate = path.resolve(distDir, '.' + pathname);
    if (candidate.startsWith(distDir + path.sep)) {
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) {
          await sendFile(req, res, candidate, { immutable: pathname.startsWith('/app/') });
          return true;
        }
      } catch { /* fall through to SPA */ }
    }
  }
  if (pathname.startsWith('/api/') || pathname.startsWith('/assets/')) return false;
  await sendFile(req, res, indexFile);
  return true;
}
