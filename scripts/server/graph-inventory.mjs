import fs from 'node:fs/promises';
import { scanWiki, splitFrontmatter } from './wiki-files.mjs';
import { typeForSlug } from './slugs.mjs';
import { articleCategory } from '../article-category.mjs';
import { withEntityTags } from '../article-entities.mjs';
import { entityMentions } from '../query/entities.mjs';
import { RELATION_FIELDS } from './slugs.mjs';

const cache = new Map();
let inflight;

/** Read only the YAML header, in bounded chunks. Large article bodies stay off this path. */
export async function readGraphHeader(file) {
  const handle = await fs.open(file, 'r');
  try {
    const chunks = [];
    let size = 0;
    while (size < 1024 * 1024) {
      const buffer = Buffer.alloc(8192);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, size);
      chunks.push(buffer.subarray(0, bytesRead)); size += bytesRead;
      const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '');
      if (!/^---\r?\n/.test(text)) return { frontmatter: {}, title: text.match(/^# (.+)$/m)?.[1] };
      const end = /\r?\n---(?:\r?\n|$)/g;
      end.lastIndex = text.indexOf('\n');
      const match = end.exec(text);
      if (match) {
        const { frontmatter, error } = splitFrontmatter(text.slice(0, match.index + match[0].length));
        if (error) throw new Error('材料 YAML 元数据格式无效');
        return { frontmatter };
      }
      if (bytesRead < buffer.length) throw new Error('材料 YAML 元数据缺少结束标记');
    }
    throw new Error('材料 YAML 元数据超过 1 MiB');
  } finally { await handle.close(); }
}

/** Share concurrent scans; reuse unchanged metadata and evict deleted pages. No database or full text. */
export function graphInventory() {
  if (inflight) return inflight;
  inflight = (async () => {
    const entries = await scanWiki();
    for (const slug of cache.keys()) if (!entries.has(slug)) cache.delete(slug);
    const work = [...entries.values()];
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(8, work.length) }, async () => {
      while (cursor < work.length) {
        const entry = work[cursor++];
        const old = cache.get(entry.slug);
        if (old?.mtime === entry.mtime && old?.size === entry.size) continue;
        try {
          const { frontmatter: fm, title } = await readGraphHeader(entry.file);
          const type = typeof fm.type === 'string' ? fm.type : typeForSlug(entry.slug) ?? 'note';
          cache.set(entry.slug, { mtime: entry.mtime, size: entry.size, page: {
            slug: entry.slug, title: typeof fm.title === 'string' && fm.title.trim() ? fm.title : title ?? entry.slug,
            type, category: articleCategory(fm, type), tags: withEntityTags(fm).tags.filter(t => typeof t === 'string' && t.trim()),
            entity_mentions: entityMentions(fm),
            relations: Object.fromEntries(RELATION_FIELDS.map(key => [key, Array.isArray(fm[key]) ? fm[key] : Array.isArray(fm.relations?.[key]) ? fm.relations[key] : []])),
            updated_at: new Date(entry.mtime).toISOString(),
          } });
        } catch (error) {
          if (error.code === 'ENOENT') { cache.delete(entry.slug); continue; }
          // Keep the material visible and surface incomplete metadata instead of dropping it silently.
          cache.set(entry.slug, { mtime: entry.mtime, size: entry.size, page: {
            slug: entry.slug, title: entry.slug, type: typeForSlug(entry.slug) ?? 'note', tags: [],
            updated_at: new Date(entry.mtime).toISOString(), metadata_error: true,
          } });
        }
      }
    }));
    return [...cache.values()].map(row => row.page);
  })().finally(() => { inflight = null; });
  return inflight;
}

export function graphTagOptions(index, query = '') {
  const counts = new Map();
  const q = query.trim().toLocaleLowerCase();
  for (const page of index) for (const tag of new Set(page.tags)) {
    if (!q || tag.toLocaleLowerCase().includes(q)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const ranked = [...counts].sort(([a, an], [b, bn]) => bn - an || a.localeCompare(b));
  return { tags: ranked.slice(0, 200).map(([tag, n]) => ({ tag, n })), total: ranked.length };
}
