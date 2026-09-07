import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { dataPath, filesBelow, sha, slash, now, readJson } from '../common.mjs';
import { normalizeSlug, isValidSlug } from './slugs.mjs';
import { HttpError } from './errors.mjs';

export const wikiDir = dataPath('wiki');
const SCAN_TTL_MS = 5000;
let cache = null;

/** Map of normalized slug → { slug, file, rel, mtime, size } for every markdown file under wiki/. */
export async function scanWiki({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < SCAN_TTL_MS) return cache.map;
  const map = new Map();
  let files = [];
  try { files = await filesBelow(wikiDir); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const rel = slash(path.relative(wikiDir, file));
    const slug = normalizeSlug(rel);
    if (!slug) continue;
    const stat = await fs.stat(file);
    map.set(slug, { slug, file, rel, mtime: stat.mtimeMs, size: stat.size });
  }
  cache = { at: Date.now(), map };
  return map;
}

export function invalidateScan() {
  cache = null;
}

export async function resolveFile(slug) {
  const map = await scanWiki();
  return map.get(normalizeSlug(slug)) ?? null;
}

export function splitFrontmatter(text) {
  try {
    const parsed = matter(text);
    return { frontmatter: parsed.data ?? {}, body: parsed.content, error: null };
  } catch (e) {
    return { frontmatter: {}, body: text, error: e.message };
  }
}

/** Read a page from disk. Returns null when the slug does not exist. */
export async function readPage(slug) {
  let entry = await resolveFile(slug);
  if (!entry) {
    const redirects = await readJson(dataPath('state', 'page-redirects.json'), {});
    const target = redirects[normalizeSlug(slug)];
    if (typeof target === 'string') entry = await resolveFile(target);
  }
  if (!entry) return null;
  const text = await fs.readFile(entry.file, 'utf8');
  const { frontmatter, body, error } = splitFrontmatter(text);
  return { ...entry, text, hash: sha(text), frontmatter, body, frontmatterError: error };
}

/** Absolute path for a slug that does not exist yet; confined to wiki/. */
export function pathForSlug(slug) {
  if (!isValidSlug(slug)) throw new HttpError(400, '页面路径无效');
  const file = path.resolve(wikiDir, slug + '.md');
  if (!file.startsWith(wikiDir + path.sep)) throw new HttpError(400, '页面路径越界');
  return file;
}

const HISTORY_KEEP = 20;

async function backupPrevious(slug, content) {
  const dir = dataPath('state', 'edit-history', ...slug.split('/'));
  await fs.mkdir(dir, { recursive: true });
  const stamp = now().replace(/[:.]/g, '-');
  await fs.writeFile(path.join(dir, `${stamp}.md`), content, 'utf8');
  const entries = (await fs.readdir(dir)).filter(name => name.endsWith('.md')).sort();
  for (const stale of entries.slice(0, Math.max(0, entries.length - HISTORY_KEEP))) {
    await fs.unlink(path.join(dir, stale));
  }
}

/**
 * Atomically write a page. `baseHash` guards against lost updates: when it does
 * not match the file currently on disk a 409 is thrown carrying the live content.
 */
export async function writePage(slug, text, { baseHash = null, create = false, force = false } = {}) {
  const existing = await resolveFile(slug);
  if (create && existing) throw new HttpError(409, '页面已存在', { slug: existing.slug });
  if (!create && !existing) throw new HttpError(404, '页面不存在');
  const file = existing ? existing.file : pathForSlug(slug);
  if (existing) {
    const current = await fs.readFile(file, 'utf8');
    const currentHash = sha(current);
    if (!force && baseHash && baseHash !== currentHash) {
      throw new HttpError(409, '页面在你打开之后已被修改', { current_hash: currentHash, current_content: current });
    }
    if (current !== text) await backupPrevious(existing.slug, current);
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temp, text, 'utf8');
    await fs.rename(temp, file);
  } catch (e) {
    await fs.rm(temp, { force: true });
    throw e;
  }
  invalidateScan();
  return { file, slug: existing ? existing.slug : normalizeSlug(slug), hash: sha(text) };
}

/** Count "## PDF 第 N 页" markers in a body. */
export function countPdfPages(body) {
  return (body.match(/^## PDF 第 \d+ 页$/gm) ?? []).length;
}
