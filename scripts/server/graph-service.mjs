import { getNeighborhood } from './db.mjs';
import { graphInventory } from './graph-inventory.mjs';
import { createPageGraphIndex, buildPageGraph } from './page-graph.mjs';
import { loadRegistry } from '../query/entities.mjs';
import { HttpError } from './errors.mjs';
import { normalizeSlug } from './slugs.mjs';

let cached;
export async function neighborhood(slug, { depth = 2, limit = 150, linkTypes = [] } = {}) {
  const normalized = normalizeSlug(slug);
  const [inventory, registry] = await Promise.all([graphInventory(), loadRegistry()]);
  if (!cached || cached.version !== registry.version || cached.inventory.length !== inventory.length || inventory.some((p, i) => cached.inventory[i] !== p)) {
    cached = { inventory, version: registry.version, index: createPageGraphIndex(inventory, registry) };
  }
  const index = cached.index;
  if (!index.pages.has(normalized)) throw new HttpError(404, '页面不存在');
  let legacy = null, explicitUnavailable = false;
  if (!linkTypes.length || linkTypes.some(t => !['has_tag', 'has_entity'].includes(t))) {
    try { legacy = await getNeighborhood(normalized, { depth: Math.min(depth, 2), limit: Math.min(limit, 51), linkTypes: linkTypes.filter(t => !['has_tag', 'has_entity'].includes(t)) }); }
    catch { explicitUnavailable = true; }
  }
  return { ...buildPageGraph(index, normalized, { depth, limit, linkTypes, legacy }), explicit_unavailable: explicitUnavailable };
}
