import {readGraphHeader} from './page-header.mjs';
export {readGraphHeader} from './page-header.mjs';
export {graphTagOptions} from './tag-options.mjs';
import { scanWiki } from './wiki-files.mjs';
import { typeForSlug } from './slugs.mjs';
import { articleCategory } from '../article-category.mjs';
import { withEntityTags } from '../article-entities.mjs';
import { entityMentions } from '../query/entities.mjs';
import { RELATION_FIELDS } from './slugs.mjs';

const cache = new Map();
let inflight;

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
