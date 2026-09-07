import fs from 'node:fs/promises';
import path from 'node:path';
import { config, dataPath, sha, safeName } from '../../common.mjs';
import { ingestFile, ingestUrl, importIma, indexWiki } from '../../ingest.mjs';
import { readBody, readJson } from '../security.mjs';
import { HttpError, reply } from '../errors.mjs';
import { enqueue, listJobs, findJob } from '../jobs.mjs';
import { normalizeArticleMetadata } from '../../article-metadata.mjs';

export function registerIngestRoutes(router) {
  router.route('GET', '/api/jobs', () => listJobs());
  router.route('GET', '/api/jobs/:id', ({ params }) => {
    const job = findJob(params.id);
    if (!job) throw new HttpError(404, '任务不存在');
    return job;
  });

  router.route('POST', '/api/import/url', async ({ req }) => {
    const { url: source, metadata = {} } = await readJson(req);
    if (typeof source !== 'string' || !source.trim()) throw new HttpError(400, '请填写文章链接');
    let fields;
    try { fields = normalizeArticleMetadata(metadata); }
    catch (e) { throw new HttpError(422, e.message); }
    const job = enqueue('网页导入', async () => {
      const doc = await ingestUrl(source.trim(), { metadata: fields });
      await indexWiki();
      return { title: doc.title, slug: doc.wiki_slug };
    });
    return reply(202, job);
  });

  router.route('POST', '/api/import/ima', async ({ req }) => {
    const body = await readJson(req);
    const limit = Number(body.limit ?? 3);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new HttpError(400, '单次导入数量应在 1–50 之间');
    const name = body.name || config.imaKnowledgeBase;
    const job = enqueue(`IMA · ${name}`, async () => {
      const results = await importIma(name, limit, { nextOnly: true });
      await indexWiki();
      return results;
    });
    return reply(202, job);
  });

  router.route('POST', '/api/import/file', async ({ req, url }) => {
    const filename = safeName(url.searchParams.get('name') || 'document.pdf');
    if (!/\.(pdf|html?|md|txt)$/i.test(filename)) throw new HttpError(400, '请选择 PDF、HTML、MD、TXT 文件');
    const bytes = await readBody(req, 100 * 1024 * 1024);
    if (!bytes.length) throw new HttpError(400, '文件为空');
    const dir = dataPath('inbox', sha(bytes).slice(0, 16));
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, filename);
    await fs.writeFile(file, bytes);
    const sourceUrl = url.searchParams.get('source_url') || null;
    const job = enqueue(filename, async () => {
      const doc = await ingestFile(file, { source_url: sourceUrl });
      await indexWiki();
      return { title: doc.title, slug: doc.wiki_slug };
    });
    return reply(202, job);
  });

  router.route('POST', '/api/index', () => reply(202, enqueue('全量更新索引', () => indexWiki(), { key: 'full-index' })));
}
