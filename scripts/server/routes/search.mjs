import { search } from '../search-service.mjs';
import { HttpError } from '../errors.mjs';

export function registerSearchRoutes(router) {
  router.route('GET', '/api/search', async ({ url }) => {
    const q = url.searchParams.get('q') ?? '';
    const mode = url.searchParams.get('mode') === 'deep' ? 'deep' : 'fast';
    const types = (url.searchParams.get('types') ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new HttpError(400, 'limit 应在 1–50 之间');
    if (!Number.isInteger(offset) || offset < 0) throw new HttpError(400, 'offset 无效');
    return search({ q, mode, types, limit, offset });
  });
}
