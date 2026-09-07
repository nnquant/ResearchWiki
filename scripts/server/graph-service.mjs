import { getNeighborhood } from './db.mjs';
import { readPage } from './wiki-files.mjs';
import { HttpError } from './errors.mjs';
import { normalizeSlug } from './slugs.mjs';

/** Local neighbourhood graph around a page, built from the links table. */
export async function neighborhood(slug, { depth = 1, limit = 150, linkTypes = [] } = {}) {
  const normalized = normalizeSlug(slug);
  const graph = await getNeighborhood(normalized, { depth, limit, linkTypes });
  if (graph) return graph;
  const page = await readPage(normalized);
  if (!page) throw new HttpError(404, '页面不存在');
  return {
    center: page.slug,
    nodes: [{ id: page.slug, title: page.frontmatter.title ?? page.slug, type: page.frontmatter.type ?? 'note', degree: 0, level: 0 }],
    edges: [],
    truncated: false,
    unindexed: true,
  };
}
