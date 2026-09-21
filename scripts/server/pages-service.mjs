import fs from 'node:fs/promises';
import path from 'node:path';
import { manifestSnapshot, assetUrl, dataPath, readJson, atomicJson, sha } from '../common.mjs';
import * as db from './db.mjs';
import { readPage, scanWiki, splitFrontmatter, countPdfPages } from './wiki-files.mjs';
import { normalizeSlug, editability, RELATION_FIELDS, relationTarget, typeForSlug, TYPE_LABELS, PAGE_TYPES, dirForType } from './slugs.mjs';
import { HttpError } from './errors.mjs';
import { articleMetadataOf } from '../article-metadata.mjs';
import { researchMetadata, isReviewDue } from '../research-schema.mjs';
import { articleCategory } from '../article-category.mjs';
import { withEntityTags } from '../article-entities.mjs';
import { matchesTags } from '../query/contract.mjs';
import { readGraphHeader } from './graph-inventory.mjs';

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
const metaFile = dataPath('state', 'page-meta-cache.json');
let loadedMeta;
let metaRevision = 0, persistedRevision = 0, fileIndexPending, fileIndexSnapshot;
function loadMeta() {
  return loadedMeta ??= readJson(metaFile, null).then(saved => {
    if (saved?.version === 1) for (const [slug, item] of saved.entries) metaCache.set(slug, item);
  }).catch(() => {});
}

async function pageMeta(entry) {
  const cached = metaCache.get(entry.slug);
  if (cached && cached.mtime === entry.mtime && cached.size === entry.size) return cached.meta;
  const { frontmatter, title, metadata_error } = await readGraphHeader(entry.file).catch(error => {
    if (error.code === 'ENOENT') throw error;
    return { frontmatter: {}, title: entry.slug, metadata_error: true };
  });
  const type = typeof frontmatter.type === 'string' ? frontmatter.type : (typeForSlug(entry.slug) ?? 'note');
  const meta = {
    slug: entry.slug,
    title: typeof frontmatter.title === 'string' && frontmatter.title.trim() ? frontmatter.title : (title ?? entry.slug),
    type,
    category: articleCategory(frontmatter, type),
    tags: withEntityTags(frontmatter).tags,
    aliases: Array.isArray(frontmatter.aliases) ? frontmatter.aliases.map(String) : [],
    review_status: typeof frontmatter.review_status === 'string' ? frontmatter.review_status : null,
    research: researchMetadata(frontmatter),
    excerpt: excerptOf('', frontmatter.summary || frontmatter.abstract),
    updated_at: new Date(entry.mtime).toISOString(),
    ...(metadata_error ? { metadata_error } : {}),
  };
  metaCache.set(entry.slug, { mtime: entry.mtime, size: entry.size, meta });
  metaRevision++;
  return meta;
}

/** File-only metadata shared by navigation, facets and the richer database index. */
export async function getFileIndex() {
  if (fileIndexPending) return fileIndexPending;
  fileIndexPending = (async () => {
    const files = await scanWiki();
    await loadMeta();
    for (const slug of metaCache.keys()) if (!files.has(slug)) { metaCache.delete(slug); metaRevision++; }
    const entries = [...files.values()]; let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(8, entries.length) }, async () => {
      while (cursor < entries.length) await pageMeta(entries[cursor++]);
    }));
    if (metaRevision !== persistedRevision) {
      persistedRevision = metaRevision;
      void atomicJson(metaFile, { version: 1, entries: [...metaCache] }).catch(() => { persistedRevision = -1; });
    }
    if (fileIndexSnapshot?.revision !== metaRevision) {
      fileIndexSnapshot = { revision: metaRevision, items: entries.map(entry => metaCache.get(entry.slug).meta) };
    }
    return { files, items: fileIndexSnapshot.items };
  })().finally(() => { fileIndexPending = null; });
  return fileIndexPending;
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
let indexSnapshot, indexPending;
export async function getIndex() {
  if (indexPending) return indexPending;
  indexPending = (async () => {
    const files = await scanWiki();
    if (indexSnapshot?.files === files && Date.now() - indexSnapshot.checked < 5000) return indexSnapshot.value;
    const version = await safeDb(db.indexVersion, null);
    const fingerprint = sha(JSON.stringify([...files.values()].map(e => [e.slug, e.mtime, e.size]).sort((a,b) => a[0].localeCompare(b[0]))));
    const key = `${version}:${fingerprint}`;
    if (version && indexSnapshot?.key === key && Date.now() - indexSnapshot.built < 60000) {
      indexSnapshot.files = files; indexSnapshot.checked = Date.now();
      return indexSnapshot.value;
    }
    await getFileIndex();
    const value = await buildPageIndex(files);
    indexSnapshot = { files, key, value, checked: Date.now(), built: Date.now() };
    return value;
  })().finally(() => { indexPending = null; });
  return indexPending;
}

async function buildPageIndex(files) {
  const rows = await safeDb(db.listIndex, null);
  const out = [];
  const seen = new Set();
  if (rows) {
    for (const row of rows) {
      const entry = files.get(row.slug);
      if (!entry) continue;
      seen.add(row.slug);
      const meta = await pageMeta(entry);
      out.push({
        slug: row.slug,
        title: row.title ?? row.slug,
        type: row.type ?? typeForSlug(row.slug) ?? 'note',
        category: meta.category,
        review_status: meta.review_status,
        tags: meta.tags,
        aliases: meta.aliases,
        research: meta.research,
        updated_at: row.updated_at,
        created_at: row.created_at,
        backlinks: row.backlinks,
        excerpt: meta.excerpt,
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

/** Entity browsing needs only matching headers, never the full-library body index. */
export async function getScopedIndex(slugs) {
  const files = await scanWiki();
  const entries = [...slugs].map(slug => files.get(slug)).filter(Boolean);
  const out = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(8, entries.length) }, async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      const { frontmatter: fm, title } = await readGraphHeader(entry.file);
      const type = typeof fm.type === 'string' ? fm.type : typeForSlug(entry.slug) ?? 'note';
      out.push({ slug: entry.slug, title: fm.title || title || entry.slug, type,
        category: articleCategory(fm, type), tags: withEntityTags(fm).tags,
        aliases: Array.isArray(fm.aliases) ? fm.aliases.map(String) : [],
        review_status: fm.review_status ?? null, research: researchMetadata(fm),
        excerpt: excerptOf('', fm.summary || fm.abstract),
        updated_at: new Date(entry.mtime).toISOString(), created_at: fm.created_at ?? null,
        backlinks: null });
    }
  }));
  return out;
}

/** Use the same page inventory as the sidebar, including pages not indexed by GBrain. */
export function filterPageIndex(index, filters) {
  let items = index;
  if (filters.type?.length) items = items.filter(x => filters.type.includes(x.category ?? x.type));
  if (filters.tag) items = items.filter(x => x.tags.includes(filters.tag));
  items = items.filter(x => matchesTags(x.tags, filters));
  if (filters.status) items = items.filter(x => x.review_status === filters.status);
  if (filters.stage) items = items.filter(x => x.research?.research_stage === filters.stage);
  if (filters.due) items = items.filter(x => isReviewDue(x));
  if (filters.q) {
    const q = filters.q.toLowerCase();
    items = items.filter(x => (filters.lookup
      ? [x.title, x.slug, ...(x.aliases ?? []), ...(x.research?.tickers ?? [])]
      : [x.title, x.slug, ...(x.tags ?? []), ...(x.aliases ?? []), ...(x.research?.tickers ?? []), x.research?.region ?? '']).some(value => String(value).toLowerCase().includes(q)));
  }
  const key = { updated: 'updated_at', created: 'created_at', title: 'title', type: 'type', slug: 'slug' }[filters.sort] ?? 'updated_at';
  const direction = filters.dir === 'asc' ? 1 : -1;
  const lookupScore = item => {
    const q = filters.q?.toLowerCase();
    if (!filters.lookup || !q) return 0;
    if ([item.title, item.slug].some(v => v?.toLowerCase() === q)) return 3;
    if ((item.aliases ?? []).some(v => v.toLowerCase() === q)) return 2;
    return [item.title, item.slug, ...(item.research?.tickers ?? [])].some(v => v?.toLowerCase().startsWith(q)) ? 1 : 0;
  };
  items = [...items].sort((a, b) => {
    const relevance = lookupScore(b) - lookupScore(a);
    if (relevance) return relevance;
    const left = key === 'type' ? a.category ?? a.type : a[key], right = key === 'type' ? b.category ?? b.type : b[key];
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

export async function typesWithCounts(index = null) {
  index ??= await getIndex();
  const counts = new Map();
  for (const item of index) {
    const category = item.category ?? item.type;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const known = PAGE_TYPES.map(type => ({ type, label: type === 'source' ? '待分类文献' : TYPE_LABELS[type] ?? type, dir: dirForType(type), n: counts.get(type) ?? 0 }));
  for (const [type, n] of counts) if (!PAGE_TYPES.includes(type)) known.push({ type, label: type, dir: null, n });
  return known;
}

const tagCountsCache = new WeakMap();
export async function tagsWithCounts() {
  const index = await getIndex();
  if (tagCountsCache.has(index)) return tagCountsCache.get(index);
  const counts = new Map();
  for (const item of index) for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const result = [...counts].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
  tagCountsCache.set(index, result);
  return result;
}

function groupRelations(links, into) {
  for (const link of links) {
    if (link.link_type === 'mentions') continue;
    (into[link.link_type] ??= []).push({ slug: link.slug, title: link.title, type: link.type, link_source: link.link_source, exists: true });
  }
}

/** Only expose saved translations that the existing asset routes can serve. */
export async function savedTranslationUrl(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) return null;
  const isPublic = file => ['raw', 'parsed', 'wiki'].some(dir => file.startsWith(dataPath(dir) + path.sep));
  const file = dataPath(relativePath);
  if (!isPublic(file)) return null;
  try {
    const real = await fs.realpath(file);
    if (!isPublic(real)) return null;
    const stat = await fs.stat(real);
    if (!stat.isFile() || stat.size === 0) return null;
    if (file.startsWith(dataPath('wiki') + path.sep) && path.extname(file) === '.md') {
      const slug = normalizeSlug(path.relative(dataPath('wiki'), file));
      return '/page/' + slug.split('/').map(encodeURIComponent).join('/');
    }
    return assetUrl(file);
  } catch {
    return null;
  }
}

async function provenanceFor(page) {
  const fm = page.frontmatter;
  if (page.type !== 'source' && !fm.raw_path && !fm.translation_path) return null;
  const doc = (await manifestSnapshot()).bySlug.get(page.slug) ?? null;
  const urlFor = rel => {
    if (!rel) return null;
    try { return assetUrl(dataPath(rel)); } catch { return null; }
  };
  return {
    raw_url: urlFor(fm.raw_path ?? doc?.raw_path),
    parsed_url: urlFor(fm.parsed_path ?? doc?.parsed_path),
    translation_url: await savedTranslationUrl(fm.translation_path ?? doc?.translation_path),
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
    category: articleCategory(fm, type),
    frontmatter: fm,
    research: researchMetadata(fm),
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
    tags: withEntityTags(fm).tags,
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

export async function categoryForPage(slug) {
  const entry = (await scanWiki()).get(normalizeSlug(slug));
  return entry ? (await pageMeta(entry)).category : null;
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
  const due = index.filter(x => isReviewDue(x)).sort((a, b) => a.research.next_review.localeCompare(b.research.next_review) || a.slug.localeCompare(b.slug));
  return { total: index.length, recent, unread, unindexed, due: due.slice(0, 8), due_total: due.length, types: await typesWithCounts(index) };
}
