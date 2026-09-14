import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { root, dataPath } from '../../common.mjs';
import { HttpError } from '../errors.mjs';

const PUBLIC_DIRS = ['raw', 'parsed', 'wiki'];
const INLINE = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const TYPES = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.html': 'text/plain; charset=utf-8',
};

function insidePublicDir(file) {
  return PUBLIC_DIRS.some(dir => file.startsWith(dataPath(dir) + path.sep));
}

/** Serve original files, parsed output and wiki sources. Confined to raw/, parsed/, wiki/. */
export function registerAssetRoutes(router) {
  router.route('GET', '/assets/*', async ({ res, params }) => {
    const file = path.resolve(root, params.wild);
    if (!insidePublicDir(file)) throw new HttpError(403, '此路径不对外提供');
    const real = await fs.realpath(file);
    if (!insidePublicDir(real)) throw new HttpError(403, '链接路径越界');
    const ext = path.extname(real).toLowerCase();
    const stat = await fs.stat(real);
    if (!stat.isFile()) throw new HttpError(404, '文件不存在');
    res.setHeader('content-type', TYPES[ext] ?? 'application/octet-stream');
    res.setHeader('content-length', stat.size);
    res.setHeader('cache-control', 'private, max-age=3600');
    if (!INLINE.has(ext)) {
      res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(real))}`);
    }
    res.writeHead(200);
    await pipeline(createReadStream(real), res);
  });
}
