import { getIndex, getScopedIndex, getPage, getRaw, getSummary, typesWithCounts, tagsWithCounts, homeData, filterPageIndex, dbError } from '../pages-service.mjs';
import { HttpError } from '../errors.mjs';
import { PAGE_TYPES } from '../slugs.mjs';
import { strings } from '../../query/contract.mjs';
import { readJson } from '../security.mjs';
import { normalizeSlug } from '../slugs.mjs';

function intParam(url, key, fallback, { min = 0, max = Infinity } = {}) {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new HttpError(400, `参数 ${key} 无效`);
  return value;
}

export function registerPageRoutes(router) {
  router.route('GET', '/api/index', async () => (await getIndex()).map(({ slug, title, type, category, updated_at }) => ({ slug, title, type, category, updated_at })));
  router.route('GET', '/api/types', () => typesWithCounts());
  router.route('GET', '/api/tags', () => tagsWithCounts());
  router.route('GET', '/api/home', () => homeData());
  router.route('POST', '/api/page-targets', async ({ req }) => {
    const body = await readJson(req, 128 * 1024);
    const slugs = strings(body.slugs, 'slugs', 500).map(normalizeSlug);
    return { items: (await getScopedIndex(slugs)).map(({ slug, title, type, category }) => ({ slug, title, type, category })) };
  });

  router.route('GET', '/api/pages', async ({ url }) => {
    const type = (url.searchParams.get('type') ?? '').split(',').map(s => s.trim()).filter(Boolean);
    for (const t of type) if (!PAGE_TYPES.includes(t) && !/^[a-z_]+$/.test(t)) throw new HttpError(400, '类型参数无效');
    const filters = {
      type,
      tag: url.searchParams.get('tag') || null,
      tags_all: strings(url.searchParams.getAll('tags_all')),
      tags_any: strings(url.searchParams.getAll('tags_any')),
      tags_none: strings(url.searchParams.getAll('tags_none')),
      status: url.searchParams.get('status') || null,
      stage: url.searchParams.get('stage') || null,
      due: url.searchParams.get('due') === 'true',
      q: (url.searchParams.get('q') ?? '').trim().slice(0, 200) || null,
      lookup: url.searchParams.get('lookup') === 'true',
      sort: url.searchParams.get('sort') || 'updated',
      dir: url.searchParams.get('dir') === 'asc' ? 'asc' : 'desc',
      limit: intParam(url, 'limit', 50, { min: 1, max: 200 }),
      offset: intParam(url, 'offset', 0, { min: 0 }),
    };
    if (filters.lookup) filters.limit = Math.min(20, filters.limit);
    const index = await getIndex();
    return { ...filterPageIndex(index, filters), degraded: Boolean(dbError()) };
  });

  router.route('GET', '/api/page/*/summary', ({ params }) => getSummary(params.wild));
  router.route('GET', '/api/page/*/raw', ({ params }) => getRaw(params.wild));
  router.route('GET', '/api/page/*', ({ params }) => getPage(params.wild));
  // Legacy query-string form kept for older scripts.
  router.route('GET', '/api/page', ({ url }) => getPage(url.searchParams.get('slug') || 'index'));
}
