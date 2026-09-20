import { queryProfile } from '../../query/profile.mjs';
import { execute } from '../../query/service.mjs';
import { combine, tagsFilter } from '../../query/contract.mjs';
import { HttpError } from '../errors.mjs';

export function registerSearchRoutes(router) {
  router.route('GET', '/api/search', async ({ url, res }) => {
    const q = url.searchParams.get('q') ?? '';
    const mode = url.searchParams.get('mode') ?? 'fast';
    if (!['fast', 'lexical', 'hybrid', 'deep'].includes(mode)) throw new HttpError(400, '检索模式无效');
    const types = (url.searchParams.get('types') ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new HttpError(400, 'limit 应在 1–50 之间');
    if (!Number.isInteger(offset) || offset < 0) throw new HttpError(400, 'offset 无效');
    const filters = combine(tagsFilter({ tags_all: url.searchParams.getAll('tags_all'), tags_any: url.searchParams.getAll('tags_any'), tags_none: url.searchParams.getAll('tags_none') }),
      types.length ? { field: queryProfile.webTypeField, op: 'in', value: types } : null,
      url.searchParams.get('entity_id') ? { field: 'entity_ids', op: 'contains_all', value: [url.searchParams.get('entity_id')] } : null);
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); }; res.once('close', cancel);
    try {
      if (offset) throw new HttpError(400, '请使用 cursor 翻页，offset 已停用');
      const request = url.searchParams.get('cursor') ? { cursor: url.searchParams.get('cursor'), limit, max_response_tokens: 32000 } : { query: q, mode: mode === 'fast' ? 'hybrid' : mode, filters, limit, max_response_tokens: 32000, explain: true };
      const result = await execute('search', request, { signal: controller.signal });
      return { ...result, engine: 'research-query', results: result.results.map(hit => ({ ...hit, category: hit.metadata.research_category,
        type: hit.metadata.page_type, page_id: null, chunk_text: hit.snippet, chunk_index: Number(hit.evidence?.block_id?.split(':').at(-1) ?? 0), chunk_source: hit.content_kind,
        pdf_page: hit.evidence?.pdf_page ?? null, stale: false, keyword_hit: hit.channels.some(c => c.channel !== 'vector') })) };
    } finally { res.removeListener('close', cancel); }
  });
}
