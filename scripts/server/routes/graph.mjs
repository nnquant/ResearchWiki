import { neighborhood } from '../graph-service.mjs';
import { HttpError } from '../errors.mjs';
import { buildTagGraph } from '../tag-graph.mjs';
import { graphTagOptions } from '../graph-inventory.mjs';
import { getFileIndex } from '../pages-service.mjs';
import { buildGraphOverview } from '../graph-overview.mjs';
import { withRead } from '../../query/store.mjs';
import { entityScopeSlugs } from '../../query/graph-query.mjs';

export function registerGraphRoutes(router) {
  router.route('GET', '/api/graph-navigation', async () => {
    const { items: index } = await getFileIndex();
    const groups = new Map();
    for (const p of [...index].sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.slug.localeCompare(b.slug))) {
      const type = p.category ?? p.type;
      if (!groups.has(type)) groups.set(type, { count: 0, items: [] });
      const group = groups.get(type); group.count++;
      if (group.items.length < 8) group.items.push({ slug: p.slug, title: p.title, type: p.type, category: p.category, updated_at: p.updated_at });
    }
    return { items: [...groups.values()].flatMap(g => g.items), counts: Object.fromEntries([...groups].map(([type, g]) => [type, g.count])) };
  });
  router.route('GET', '/api/graph-tags', async ({ url }) => graphTagOptions((await getFileIndex()).items, url.searchParams.get('q') ?? ''));
  router.route('GET', '/api/graph', async ({ url }) => {
    const p = url.searchParams;
    const limit = Number(p.get('limit') ?? 80);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new HttpError(400, 'limit 应在 1–200 之间');
    const filters = {
      limit, q: p.get('q') ?? '', type: p.get('type') ?? '',
      tags_all: [...p.getAll('tags_all'), ...p.getAll('tag')], tags_any: p.getAll('tags_any'), tags_none: p.getAll('tags_none'),
    };
    const entityId = p.get('entity_id');
    const scoped = entityId || filters.q || filters.type || filters.tags_all.length || filters.tags_any.length || filters.tags_none.length;
    const view = p.get('view') ?? (scoped ? 'materials' : 'overview');
    if (!['overview', 'materials'].includes(view)) throw new HttpError(400, 'view 应为 overview 或 materials');
    let inventory = (await getFileIndex()).items;
    let entityScope;
    if (entityId) { entityScope = await withRead(run => entityScopeSlugs(run, entityId)); inventory = inventory.filter(p => entityScope.slugs.has(p.slug)); }
    const result = view === 'overview' ? buildGraphOverview(inventory, filters) : buildTagGraph(inventory, filters);
    return { ...result, ...(entityScope ? { graph_index: entityScope.graph_index } : {}) };
  });
  router.route('GET', '/api/graph/*', async ({ params, url }) => {
    const depth = Number(url.searchParams.get('depth') ?? 2);
    const limit = Number(url.searchParams.get('limit') ?? 150);
    if (![1, 2, 3].includes(depth)) throw new HttpError(400, 'depth 应为 1–3');
    if (!Number.isInteger(limit) || limit < 1 || limit > 400) throw new HttpError(400, 'limit 应在 1–400 之间');
    const linkTypes = (url.searchParams.get('link_types') ?? '').split(',').map(s => s.trim()).filter(Boolean);
    return neighborhood(params.wild, { depth, limit, linkTypes });
  });
}
