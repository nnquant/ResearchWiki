import fs from 'node:fs/promises';
import path from 'node:path';

export const validShareId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value);
const downloads = {
  'researchwiki-install.mjs': { file: 'researchwiki-install.mjs', type: 'text/javascript; charset=utf-8' },
  'researchwiki-install.md': { file: 'ResearchWiki-一键安装.md', type: 'text/markdown; charset=utf-8' },
};

/** Reveal only the explicitly published share, for the Wiki's access guide. */
export async function installAccess(directory, enabled = true) {
  if (!enabled) return { available: false, reason: 'Agent 接入未启用' };
  let share;
  try { share = JSON.parse(await fs.readFile(path.join(directory, 'install-share.json'), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
  if (share?.enabled !== true || !validShareId(share?.id)) return { available: false, reason: '安装指南尚未发布或已停用，请联系维护者' };
  for (const item of Object.values(downloads)) {
    const stat = await fs.lstat(path.join(directory, item.file)).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) return { available: false, reason: '安装资源不完整，请联系维护者重新发布' };
  }
  return { available: true, document_path: `/agent/install/${share.id}/researchwiki-install.md`, installer_path: `/agent/install/${share.id}/researchwiki-install.mjs` };
}

export function renderInstallDownload(contents, { baseUrl, defaultBaseUrl } = {}) {
  if (!baseUrl) return contents;
  let text = contents.toString('utf8').replaceAll('const servedBase = "__RESEARCHWIKI_SERVED_BASE__";', `const servedBase = ${JSON.stringify(baseUrl)};`);
  if (defaultBaseUrl && defaultBaseUrl !== baseUrl) text = text.replaceAll(defaultBaseUrl, baseUrl);
  return Buffer.from(text);
}

/** Only the explicitly published pair is served, never a directory or arbitrary private file. */
export function installDownloads(directory) {
  return async (req, res, url, { baseUrl } = {}) => {
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
    const contents = renderInstallDownload(await fs.readFile(file), { baseUrl, defaultBaseUrl: share.base_url });
    res.writeHead(200, { 'content-type': item.type, 'content-length': contents.length,
      'content-disposition': `attachment; filename="${match[2]}"`, 'cache-control': 'no-store',
      'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow, noarchive' });
    res.end(req.method === 'HEAD' ? undefined : contents);
    return true;
  };
}
