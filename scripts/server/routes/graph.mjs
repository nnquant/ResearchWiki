import { neighborhood } from '../graph-service.mjs';
import { HttpError } from '../errors.mjs';

export function registerGraphRoutes(router) {
  router.route('GET', '/api/graph/*', async ({ params, url }) => {
    const depth = Number(url.searchParams.get('depth') ?? 1);
    const limit = Number(url.searchParams.get('limit') ?? 150);
    if (![1, 2, 3].includes(depth)) throw new HttpError(400, 'depth 应为 1–3');
    if (!Number.isInteger(limit) || limit < 1 || limit > 400) throw new HttpError(400, 'limit 应在 1–400 之间');
    const linkTypes = (url.searchParams.get('link_types') ?? '').split(',').map(s => s.trim()).filter(Boolean);
    return neighborhood(params.wild, { depth, limit, linkTypes });
  });
}
