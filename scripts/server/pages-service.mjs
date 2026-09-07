import fs from 'node:fs/promises';
import { manifest, assetUrl, dataPath } from '../common.mjs';
import * as db from './db.mjs';
import { readPage, scanWiki, splitFrontmatter, countPdfPages } from './wiki-files.mjs';
import { normalizeSlug, editability, RELATION_FIELDS, relationTarget, typeForSlug, TYPE_LABELS, PAGE_TYPES, dirForType } from './slugs.mjs';
import { HttpError } from './errors.mjs';
import { articleMetadataOf } from '../article-metadata.mjs';

let lastDbError = null;
export function dbError() { return lastDbError; }

async function safeDb(fn, fallback) {
  try {
    const value = await fn();
    lastDbError = null;
    return value;
  } catch (e) {
    lastDbError = e.message;
    return fallback;
  }
}

/** Frontmatter metadata cache keyed by slug, invalidated by mtime. */
const metaCache = new Map();

async function pageMeta(entry) {
  const cached = metaCache.get(entry.slug);
  if (cached && cached.mtime === entry.mtime) return cached.meta;
  const text = await fs.readFile(entry.file, 'utf8');
  const { frontmatter, body } = splitFrontmatter(text);
  const meta = {
    slug: entry.slug,
    title: typeof frontmatter.title === 'string' && frontmatter.title.trim() ? frontmatter.title : (text.match(/^# (.+)$/m)?.[1] ?? entry.slug),
    type: typeof frontmatter.type === 'string' ? frontmatter.type : (typeForSlug(entry.slug) ?? 'note'),
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [],
    aliases: Array.isArray(frontmatter.aliases) ? frontmatter.aliases.map(String) : [],
    review_status: typeof frontmatter.review_status === 'string' ? frontmatter.review_status : null,
    excerpt: excerptOf(body, frontmatter.abstract),
    updated_at: new Date(entry.mtime).toISOString(),
  };
  metaCache.set(entry.slug, { mtime: entry.mtime, meta });
  return meta;
}

/**
 * Pages the pipeline manages itself: gbrain skips the root index.md, and
 * 文献目录 is rewritten on every index run (mtime moves, content often not).
 */
const PIPELINE_PAGES = new Set(['index', '文献目录']);

function isStale(slug, mtime, updatedAt) {
  if (PIPELINE_PAGES.has(slug)) return false;
  return mtime > new Date(updatedAt).getTime() + 1000;
}

/** Lightweight index of every page (DB rows first, disk-only pages appended). */
export async function getIndex() {
  const files = await scanWiki();
  const rows = await safeDb(db.listIndex, null);
  const out = [];
  const seen = new Set();
  if (rows) {
    for (const row of rows) {
      const entry = files.get(row.slug);
      if (!entry) continue;
      seen.add(row.slug);
      out.push({
        slug: row.slug,
        title: row.title ?? row.slug,
        type: row.type ?? typeForSlug(row.slug) ?? 'note',
        review_status: row.review_status ?? null,
        tags: row.tags ?? [],
        aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
        updated_at: row.updated_at,
        created_at: row.created_at,
        backlinks: row.backlinks,
        excerpt: (await pageMeta(entry)).excerpt,
        indexed: true,
        stale: isStale(row.slug, entry.mtime, row.updated_at),
      });
    }
  }
  for (const [slug, entry] of files) {
    if (seen.has(slug)) continue;
    const meta = await pageMeta(entry);
    out.push({ ...meta, indexed: PIPELINE_PAGES.has(slug), stale: !PIPELINE_PAGES.has(slug) });
  }
  return out;
}

/** Use the same page inventory as the sidebar, including pages not indexed by GBrain. */
export function filterPageIndex(index, filters) {
  let items = index;
  if (filters.type?.length) items = items.filter(x => filters.type.includes(x.type));
  if (filters.tag) items = items.filter(x => x.tags.includes(filters.tag));
  if (filters.status) items = items.filter(x => x.review_status === filters.status);
  if (filters.q) {
    const q = filters.q.toLowerCase();
    items = items.filter(x => (x.title + ' ' + x.slug).toLowerCase().includes(q));
  }
  const key = { updated: 'updated_at', created: 'created_at', title: 'title', type: 'type', slug: 'slug' }[filters.sort] ?? 'updated_at';
  const direction = filters.dir === 'asc' ? 1 : -1;
  items = [...items].sort((a, b) => {
    const left = a[key], right = b[key];
    if (left == null && right != null) return 1;
    if (left != null && right == null) return -1;
    const compared = key.endsWith('_at')
      ? (new Date(left ?? 0).getTime() - new Date(right ?? 0).getTime())
      : String(left ?? '').localeCompare(String(right ?? ''), 'zh-CN');
    return direction * compared || a.slug.localeCompare(b.slug);
  });
  const offset = filters.offset ?? 0, limit = filters.limit ?? 50;
  return { total: items.length, items: items.slice(offset, offset + limit).map(x => ({ ...x, backlinks: x.backlinks ?? null })) };
}

export async function typesWithCounts() {
  const index = await getIndex();
  const counts = new Map();
  for (const item of index) counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
  const known = PAGE_TYPES.map(type => ({ type, label: TYPE_LABELS[type] ?? type, dir: dirForType(type), n: counts.get(type) ?? 0 }));
  for (const [type, n] of counts) if (!PAGE_TYPES.includes(type)) known.push({ type, label: type, dir: null, n });
  return known;
}

export async function tagsWithCounts() {
  const rows = await safeDb(db.tagCounts, null);
  if (rows) return rows;
  const counts = new Map();
  for (const item of await getIndex()) for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
}

function groupRelations(links, into) {
  for (const link of links) {
    if (link.link_type === 'mentions') continue;
    (into[link.link_type] ??= []).push({ slug: link.slug, title: link.title, type: link.type, link_source: link.link_source, exists: true });
  }
}

async function provenanceFor(page) {
  const fm = page.frontmatter;
  if (page.type !== 'source' && !fm.raw_path) return null;
  const docs = Object.values((await manifest()).documents);
  const doc = docs.find(d => normalizeSlug(d.wiki_slug ?? '') === page.slug) ?? null;
  const urlFor = rel => {
    if (!rel) return null;
    try { return assetUrl(dataPath(rel)); } catch { return null; }
  };
  return {
    raw_url: urlFor(fm.raw_path ?? doc?.raw_path),
    parsed_url: urlFor(fm.parsed_path ?? doc?.parsed_path),
    page_map_url: urlFor(doc?.page_map),
    source_url: fm.source_url ?? doc?.source_url ?? null,
    source_kind: fm.source_kind ?? doc?.source_kind ?? null,
    sha256: fm.sha256 ?? doc?.sha256 ?? null,
    parser: fm.parser ?? doc?.parser ?? null,
    received_at: fm.received_at ?? doc?.received_at ?? null,
    published_at: Object.hasOwn(fm, 'published_at') ? fm.published_at : (doc?.published_at ?? null),
    pages: doc?.pages ?? null,
    characters: doc?.characters ?? null,
    status: doc?.status ?? null,
    knowledge_base: doc?.source_meta?.knowledge_base ?? null,
    llm_model: doc?.llm?.model ?? null,
    llm_processed_at: doc?.llm?.completed_at ?? null,
  };
}

/** Full page payload for the reader. */
export async function getPage(slugInput) {
  const page = await readPage(slugInput);
  if (!page) throw new HttpError(404, '页面不存在');
  const fm = page.frontmatter;
  const type = typeof fm.type === 'string' ? fm.type : (typeForSlug(page.slug) ?? 'note');
  const row = await safeDb(() => db.getPageRow(page.slug), null);
  const links_out = row ? await safeDb(() => db.getLinksOut(row.id), []) : [];
  const backlinks = row ? await safeDb(() => db.getBacklinks(row.id), []) : [];
  const files = await scanWiki();

  const relations = { out: {}, in: {} };
  groupRelations(links_out, relations.out);
  groupRelations(backlinks, relations.in);
  for (const field of RELATION_FIELDS) {
    const raw = fm[field];
    if (raw === undefined || raw === null) continue;
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      const target = relationTarget(value);
      if (!target || relations.out[field]?.some(x => x.slug === target)) continue;
      const entry = files.get(target);
      const meta = entry ? await pageMeta(entry) : null;
      (relations.out[field] ??= []).push({
        slug: target, title: meta?.title ?? target, type: meta?.type ?? typeForSlug(target), link_source: 'frontmatter', exists: Boolean(entry),
      });
    }
  }

  const { editable, reason } = editability(page.slug);
  const updatedAt = row?.updated_at ? new Date(row.updated_at) : new Date(page.mtime);
  return {
    slug: page.slug,
    title: typeof fm.title === 'string' && fm.title.trim() ? fm.title : (row?.title ?? page.slug),
    type,
    type_label: TYPE_LABELS[type] ?? type,
    frontmatter: fm,
    article_metadata: type === 'source' ? articleMetadataOf(fm) : null,
    frontmatter_error: page.frontmatterError,
    markdown: page.body,
    hash: page.hash,
    mtime: new Date(page.mtime).toISOString(),
    updated_at: updatedAt.toISOString(),
    created_at: row?.created_at ?? null,
    indexed: Boolean(row) || PIPELINE_PAGES.has(page.slug),
    stale: row ? isStale(page.slug, page.mtime, row.updated_at) : !PIPELINE_PAGES.has(page.slug),
    editable,
    edit_reason: reason,
    tags: row?.tags?.length ? row.tags : (Array.isArray(fm.tags) ? fm.tags.map(String) : []),
    aliases: Array.isArray(fm.aliases) ? fm.aliases.map(String) : [],
    review_status: typeof fm.review_status === 'string' ? fm.review_status : null,
    pdf_pages: countPdfPages(page.body),
    provenance: await provenanceFor({ ...page, type }),
    links_out,
    backlinks,
    relations,
  };
}

export async function getRaw(slugInput) {
  const page = await readPage(slugInput);
  if (!page) throw new HttpError(404, '页面不存在');
  const { editable, reason } = editability(page.slug);
  return { slug: page.slug, content: page.text, hash: page.hash, editable, edit_reason: reason };
}

export function excerptOf(body, abstract = null) {
  const hasAbstract = typeof abstract === 'string' && abstract.trim().length > 0;
  const content = hasAbstract ? abstract : body;
  const lines = content.replace(/```[\s\S]*?```/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').split(/\r?\n/).filter(line => {
    const t = line.trim();
    return t && (hasAbstract || !t.startsWith('#')) && !/^>\s*(文献全文|原始证据)/.test(t) && !t.startsWith('![') && !t.startsWith('[原始文件]') && !/^-{3,}$/.test(t);
  });
  const text = lines.join(' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label ?? target)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^(?:#{1,6}|>|[-+])\s+/g, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(text);
  return chars.length > 200 ? chars.slice(0, 200).join('') + '…' : text;
}

export async function getSummary(slugInput) {
  const page = await readPage(slugInput);
  if (!page) throw new HttpError(404, '页面不存在');
  const meta = await pageMeta(page);
  return { ...meta, pdf_pages: countPdfPages(page.body) };
}

/** Body cache for chunk → PDF page mapping (small, mtime-checked). */
const bodyCache = new Map();

async function cachedBody(slug) {
  const page = await readPage(slug);
  if (!page) return null;
  const hit = bodyCache.get(page.slug);
  if (hit && hit.mtime === page.mtime) return hit.body;
  if (bodyCache.size > 64) bodyCache.delete(bodyCache.keys().next().value);
  bodyCache.set(page.slug, { mtime: page.mtime, body: page.body });
  return page.body;
}

const PAGE_MARK = /^## PDF 第 (\d+) 页$/gm;

/** Locate which "PDF 第 N 页" section a search chunk came from. Best effort. */
export async function pdfPageForChunk(slug, chunkText) {
  const body = await cachedBody(slug);
  if (!body || !chunkText) return null;
  const lines = chunkText.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && !l.startsWith('>'));
  let idx = -1;
  for (const line of lines) {
    if (line.length < 24) continue;
    idx = body.indexOf(line.slice(0, 90));
    if (idx >= 0) break;
  }
  if (idx < 0 && lines[0]) idx = body.indexOf(lines[0].slice(0, 30));
  if (idx >= 0) {
    let pageNo = null;
    for (const m of body.matchAll(PAGE_MARK)) {
      if (m.index > idx) break;
      pageNo = Number(m[1]);
    }
    if (pageNo) return pageNo;
  }
  const inChunk = chunkText.match(/^## PDF 第 (\d+) 页$/m);
  return inChunk ? Number(inChunk[1]) : null;
}

export async function homeData() {
  const index = await getIndex();
  const recent = [...index].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 8);
  const unread = index.filter(x => ['unread', 'unreviewed'].includes(x.review_status ?? '')).slice(0, 8);
  const unindexed = index.filter(x => !x.indexed || x.stale).length;
  return { total: index.length, recent, unread, unindexed, types: await typesWithCounts() };
}
