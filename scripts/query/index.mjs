import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { randomUUID } from 'node:crypto';
import { root, manifest, dataPath } from '../common.mjs';
import { getSql, closeDb } from '../server/db.mjs';
import { normalizeSlug, typeForSlug, RELATION_FIELDS } from '../server/slugs.mjs';
import { decorateMetadata, queryProfile } from './profile.mjs';
import { dateOnly, validDate } from './dates.mjs';
import { hash, makeBlocks } from './blocks.mjs';
import { FIELDS, tokenText } from './contract.mjs';
import { fileURLToPath } from 'node:url';

const INDEX_VERSION = hash(JSON.stringify(['rq-index-2', queryProfile, FIELDS]));
export async function safeFile(relative) {
  if (!relative || typeof relative !== 'string') return null;
  const candidate = path.resolve(root, relative);
  const bases = ['wiki', 'parsed', 'raw'].map(d => path.resolve(root, d) + path.sep);
  if (!bases.some(b => candidate.startsWith(b))) throw new Error('材料路径越界');
  try {
    const real = await fs.realpath(candidate);
    if (!bases.some(b => real.startsWith(b))) throw new Error('材料真实路径越界');
    const stat = await fs.stat(real);
    if (!stat.isFile()) return null;
    return { file: real, relative, size: stat.size, mtime: stat.mtimeMs, ino: String(stat.ino), dev: String(stat.dev) };
  } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

async function wikiInventory() {
  const result = new Map();
  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        const relative = path.relative(root, file), info = await safeFile(relative);
        if (info) result.set(normalizeSlug(path.relative(dataPath('wiki'), file)), info);
      }
    }
  }
  await walk(dataPath('wiki'));
  return result;
}

export function metadataFor(fm, doc = {}, slug = '') {
  let combined = { ...(doc.article_metadata ?? {}), ...fm };
  const pageType = fm.type ?? (doc.id ? 'source' : typeForSlug(slug) ?? 'note');
  combined = decorateMetadata(combined, pageType);
  const metadata = { ...combined, page_type: pageType, research_category: combined.research_category ?? pageType, status: doc.status ?? 'wiki',
    ingested_at: doc.received_at ?? null, updated_at: fm.updated_at ?? doc.updated_at ?? null };
  metadata.tags = combined.tags ?? [];
  metadata.tickers = combined.tickers ?? [];
  for (const [field, type] of Object.entries(FIELDS)) {
    if (type === 'array') metadata[field] = Array.isArray(metadata[field]) ? [...new Set(metadata[field].filter(x => typeof x === 'string' && x.trim()))] : [];
    else if (type === 'date') {
      const value = dateOnly(metadata[field]);
      const day = typeof value === 'string' ? value.slice(0, 10) : value;
      metadata[field] = validDate(day) ? day : null;
    } else metadata[field] = typeof metadata[field] === 'string' ? metadata[field] : null;
  }
  metadata.relations = Object.fromEntries(RELATION_FIELDS.map(k => [k, (Array.isArray(fm[k]) ? fm[k] : fm[k] ? [fm[k]] : []).filter(x => typeof x === 'string').map(x => normalizeSlug(x.replace(/^\[\[|\]\]$/g, '').split('|')[0]))]));
  metadata.tag_provenance = 'unknown';
  return metadata;
}

/** Separate, resumable text projection. No LLM, embedding, or source-file mutation. */
export async function buildIndex({ progress = () => {}, force = false } = {}) {
  const sql = await getSql();
  await sql.unsafe(await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  const lease = await sql.reserve();
  const [lock] = await lease`SELECT pg_try_advisory_lock(78314026) AS acquired`;
  if (!lock.acquired) { lease.release(); throw new Error('已有查询索引任务运行'); }
  const started = new Date().toISOString(), run = randomUUID();
  const stats = { run, started_at: started, seen: 0, changed: 0, unchanged: 0, failed: 0, text_ready: 0, manifest_statuses: {}, errors: [] };
  try {
    await lease`INSERT INTO research_query.state VALUES ('building', ${sql.json({ run, started_at: started })}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
    const catalog = await manifest(), files = await wikiInventory();
    const priorRows = await lease`SELECT document_id,source_key,slug,signature FROM research_query.documents`;
    const previous = new Map(priorRows.map(x => [x.source_key, x]));
    const priorWikiSlugs = new Map(priorRows.filter(x => x.source_key.startsWith('wiki:')).map(x => [x.slug, x]));
    const items = [];
    for (const doc of Object.values(catalog.documents)) {
      stats.manifest_statuses[doc.status ?? 'unknown'] = (stats.manifest_statuses[doc.status ?? 'unknown'] ?? 0) + 1;
      const slug = normalizeSlug(doc.wiki_slug ?? `sources/${doc.id}`);
      const wiki = files.get(slug); files.delete(slug);
      items.push({ doc, slug, wiki, source_key: `manifest:${doc.id}` });
    }
    for (const [slug, wiki] of files) items.push({ doc: {}, slug, wiki, source_key: `wiki:${wiki.dev}:${wiki.ino}` });
    const seen = [];
    for (const item of items) {
      const { doc, slug, wiki, source_key } = item;
      const old = previous.get(source_key) ?? (!doc.id ? priorWikiSlugs.get(slug) : null), id = old?.document_id ?? (doc.id ? `doc:${doc.id}` : `wiki:${randomUUID()}`);
      seen.push(id); stats.seen++;
      try {
        const source = doc.id ? (await safeFile(doc.paged_path) ?? await safeFile(doc.parsed_path) ?? wiki) : wiki;
        const signature = hash(JSON.stringify({ version: INDEX_VERSION, doc, wiki, source }));
        if (!force && old?.signature === signature) { stats.unchanged++; continue; }
        const wikiText = wiki ? await fs.readFile(wiki.file, 'utf8') : '';
        let fm = {}, wikiBody = wikiText, metadataError = null;
        try { const parsed = matter(wikiText); fm = parsed.data; wikiBody = parsed.content; } catch (e) { metadataError = e.message; }
        const body = source ? (source === wiki ? wikiBody : await fs.readFile(source.file, 'utf8')) : '';
        // A concurrent writer cannot publish a mismatched fingerprint/body pair.
        for (const info of [wiki, source].filter(Boolean)) {
          const fresh = await fs.stat(info.file);
          if (fresh.mtimeMs !== info.mtime || fresh.size !== info.size) throw new Error('材料在读取过程中更新；下次索引重试');
        }
        const metadata = metadataFor(fm, doc, slug);
        metadata.metadata_error = metadataError;
        metadata.text_available = Boolean(body);
        const title = fm.title || doc.title || slug;
        const provenance = { raw_path: fm.raw_path ?? doc.raw_path ?? null, parsed_path: source?.relative ?? null, source_url: fm.source_url ?? doc.source_url ?? null,
          sha256: doc.sha256 ?? fm.sha256 ?? null, parser: doc.parser ?? null, content_kind: doc.id ? 'source' : fm.translation_of ? 'translation' : 'research_page',
          published_at_source: metadata.published_at ? 'recorded_metadata' : 'unknown', tag_provenance: 'unknown' };
        const revision = hash(JSON.stringify({ body, metadata, provenance, title }));
        const blocks = makeBlocks(body, revision);
        const family = String(doc.sha256 ?? fm.translation_of ?? id);
        const header = tokenText([title, ...metadata.tags, ...metadata.tickers, ...metadata.aliases, ...metadata.companies, metadata.summary ?? ''].join(' '));
        await sql.begin(async tx => {
          await tx`INSERT INTO research_query.documents (document_id,source_key,slug,title,family_id,revision_id,metadata,provenance,signature,text_chars,source_mtime,search_vector)
            VALUES (${id},${source_key},${slug},${title},${family},${revision},${tx.json(metadata)},${tx.json(provenance)},${signature},${body.length},${Math.max(wiki?.mtime ?? 0, source?.mtime ?? 0)},to_tsvector('simple',${header}))
            ON CONFLICT(document_id) DO UPDATE SET source_key=excluded.source_key,slug=excluded.slug,title=excluded.title,family_id=excluded.family_id,revision_id=excluded.revision_id,metadata=excluded.metadata,provenance=excluded.provenance,signature=excluded.signature,text_chars=excluded.text_chars,source_mtime=excluded.source_mtime,search_vector=excluded.search_vector,deleted=false,indexed_at=now()`;
          const inserted = await tx`INSERT INTO research_query.revisions (document_id,revision_id,metadata,provenance) VALUES (${id},${revision},${tx.json({ ...metadata, title, slug })},${tx.json(provenance)}) ON CONFLICT DO NOTHING RETURNING revision_id`;
          if (inserted.length) {
            for (let i = 0; i < blocks.length; i += 100) {
              const batch = blocks.slice(i, i + 100).map(b => ({ ...b, document_id: id, revision_id: revision, tokens: tokenText(b.text) }));
              await tx`INSERT INTO research_query.blocks (document_id,revision_id,block_id,ordinal,start_offset,end_offset,pdf_page,section,text,search_vector)
                SELECT x.document_id,x.revision_id,x.block_id,x.ordinal,x.start_offset,x.end_offset,x.pdf_page,x.section,x.text,to_tsvector('simple',x.tokens)
                FROM jsonb_to_recordset(${tx.json(batch)}::jsonb) AS x(document_id text,revision_id text,block_id text,ordinal int,start_offset int,end_offset int,pdf_page int,section jsonb,text text,tokens text)`;
            }
          }
        });
        stats.changed++; if (body) stats.text_ready++;
      } catch (e) {
        if (e instanceof TypeError || /^42|^08|^28|^53/.test(e.code ?? '')) throw e;
        stats.failed++;
        if (stats.errors.length < 50) stats.errors.push({ document_id: id, code: e.code ?? 'INDEX_ERROR', message: e.message });
      }
      if (stats.seen % 100 === 0) progress({ ...stats, errors: undefined });
    }
    await sql.begin(async tx => {
      await tx`UPDATE research_query.documents SET deleted=true WHERE NOT (document_id=ANY(${seen}::text[]))`;
      await tx`UPDATE research_query.documents t SET family_id=o.family_id FROM research_query.documents o
        WHERE t.metadata->>'translation_of'=o.slug AND NOT t.deleted AND NOT o.deleted AND t.family_id<>o.family_id`;
      const [counts] = await tx`SELECT count(*)::int AS total,count(*) FILTER(WHERE text_chars>0)::int AS text_ready FROM research_query.documents WHERE NOT deleted`;
      stats.catalog_documents = counts.total;
      stats.text_ready = counts.text_ready;
      stats.finished_at = new Date().toISOString();
      stats.snapshot_id = hash(JSON.stringify(stats));
      await tx`INSERT INTO research_query.state VALUES ('last_index',${tx.json(stats)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
      await tx`DELETE FROM research_query.state WHERE key='building'`;
    });
    return stats;
  } finally { await lease`SELECT pg_advisory_unlock(78314026)`; lease.release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const stats = await buildIndex({ force: process.argv.includes('--force'), progress: p => console.error(JSON.stringify(p)) }); console.log(JSON.stringify(stats, null, 2)); if (stats.failed) process.exitCode = 1; }
  catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { await closeDb(); }
}

