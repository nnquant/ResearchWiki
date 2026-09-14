import fs from 'node:fs/promises';
import path from 'node:path';

export const validShareId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value);
const downloads = {
  'researchwiki-install.mjs': { file: 'researchwiki-install.mjs', type: 'text/javascript; charset=utf-8' },
  'researchwiki-install.md': { file: 'ResearchWiki-一键安装.md', type: 'text/markdown; charset=utf-8' },
};

/** Only the explicitly published pair is served, never a directory or arbitrary private file. */
export function installDownloads(directory) {
  return async (req, res, url) => {
    if (!['GET', 'HEAD'].includes(req.method)) return false;
    const match = url.pathname.match(/^\/install\/([A-Za-z0-9_-]{32})\/(researchwiki-install\.(?:mjs|md))$/);
    if (!match) return false;
    let share;
    try { share = JSON.parse(await fs.readFile(path.join(directory, 'install-share.json'), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT' || e instanceof SyntaxError) return false; throw e; }
    if (share.enabled !== true || !validShareId(share.id) || share.id !== match[1]) return false;
    const item = downloads[match[2]], file = path.join(directory, item.file);
    // Do not follow a substituted symlink to another file in the private directory.
    const stat = await fs.lstat(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) return false;
    const contents = await fs.readFile(file);
    res.writeHead(200, { 'content-type': item.type, 'content-length': contents.length,
      'content-disposition': `attachment; filename="${match[2]}"`, 'cache-control': 'no-store',
      'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow, noarchive' });
    res.end(req.method === 'HEAD' ? undefined : contents);
    return true;
  };
}
