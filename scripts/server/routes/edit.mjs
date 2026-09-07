import { readJson } from '../security.mjs';
import { HttpError, reply } from '../errors.mjs';
import { writePage, resolveFile } from '../wiki-files.mjs';
import { validatePageText } from '../validate.mjs';
import { listTemplates, renderTemplate } from '../templates.mjs';
import { enqueue } from '../jobs.mjs';
import { editability, normalizeSlug, normalizeSegment, isValidSlug, dirForType, PAGE_TYPES, RELATION_FIELDS, relationTarget } from '../slugs.mjs';
import { reindexPages, updateArticleMetadata } from '../../ingest.mjs';
import { articleSchema, normalizeArticleMetadata } from '../../article-metadata.mjs';

const mergeSlugs = (a, b) => ({ slugs: [...new Set([...(a?.slugs ?? []), ...(b?.slugs ?? [])])] });

/** Queue an incremental re-index for the given slugs, merging with a queued one. */
export function scheduleReindex(slugs) {
  return enqueue('更新索引', payload => reindexPages(payload?.slugs ?? []), { key: 'reindex', payload: { slugs }, merge: mergeSlugs });
}

export function registerEditRoutes(router) {
  router.route('GET', '/api/templates', () => listTemplates());
  router.route('GET', '/api/article-schema', () => articleSchema);
  router.route('PUT', '/api/page/*/metadata', async ({ req, params }) => {
    const slug = normalizeSlug(params.wild);
    if (!slug.startsWith('sources/') || !await resolveFile(slug)) throw new HttpError(404, '文献不存在');
    const body = await readJson(req);
    let fields;
    try { fields = normalizeArticleMetadata(body.metadata); }
    catch (e) { throw new HttpError(422, e.message); }
    return reply(202, enqueue('更新文献信息', async () => {
      await updateArticleMetadata(slug, fields);
      await reindexPages([slug]);
      return { slug };
    }));
  });

  router.route('PUT', '/api/page/*', async ({ req, params }) => {
    const slug = normalizeSlug(params.wild);
    const existing = await resolveFile(slug);
    if (!existing) throw new HttpError(404, '页面不存在');
    const { editable, reason } = editability(existing.slug);
    if (!editable) throw new HttpError(403, reason);
    const body = await readJson(req, 3 * 1024 * 1024);
    const content = String(body.content ?? '').replace(/\r\n/g, '\n');
    const validation = await validatePageText(content, { slug: existing.slug });
    if (!validation.ok) throw new HttpError(422, '页面内容未通过校验', { errors: validation.errors });
    const written = await writePage(existing.slug, content, { baseHash: body.base_hash ?? null, force: Boolean(body.force) });
    const job = scheduleReindex([written.slug]);
    return { slug: written.slug, hash: written.hash, job_id: job.id };
  });

  router.route('POST', '/api/pages', async ({ req }) => {
    const body = await readJson(req);
    const type = String(body.type ?? '');
    if (!PAGE_TYPES.includes(type) || type === 'source') throw new HttpError(400, '不支持的页面类型');
    const title = String(body.title ?? '').trim();
    if (!title) throw new HttpError(400, '标题不能为空');
    const dir = dirForType(type);
    let slug = body.slug ? normalizeSlug(String(body.slug)) : `${dir}/${normalizeSegment(title)}`;
    if (!slug.includes('/')) slug = `${dir}/${slug}`;
    if (!isValidSlug(slug) || !slug.startsWith(`${dir}/`) || slug === `${dir}/`) throw new HttpError(400, `slug 必须位于 ${dir}/ 目录下`);
    if (await resolveFile(slug)) throw new HttpError(409, '页面已存在', { slug });
    const tags = Array.isArray(body.tags) ? body.tags.map(String).filter(Boolean) : [];
    const relations = {};
    for (const field of RELATION_FIELDS) {
      const raw = body.relations?.[field];
      if (!Array.isArray(raw) || !raw.length) continue;
      relations[field] = raw.map(v => relationTarget(v)).filter(Boolean);
    }
    if (body.research != null && (typeof body.research !== 'object' || Array.isArray(body.research))) throw new HttpError(422, 'research 必须是对象');
    const content = await renderTemplate(type, { title, slug, tags, relations, research: body.research ?? {} });
    const validation = await validatePageText(content, { slug });
    if (!validation.ok) throw new HttpError(422, '页面内容未通过校验', { errors: validation.errors });
    const written = await writePage(slug, content, { create: true });
    const job = scheduleReindex([written.slug]);
    return reply(201, { slug: written.slug, hash: written.hash, job_id: job.id });
  });
}
