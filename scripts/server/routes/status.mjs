import path from 'node:path';
import { config, repo, root, manifestSnapshot, manifestSummary, dataPath, readJson } from '../../common.mjs';
import { installAccess } from '../../agent/install-downloads.mjs';
import { csrfToken } from '../security.mjs';
import { activeJob, queueLength } from '../jobs.mjs';
import * as db from '../db.mjs';
import { ollamaHealth } from '../search-service.mjs';
import { scanWiki } from '../wiki-files.mjs';
import { dbError } from '../pages-service.mjs';
import { HttpError } from '../errors.mjs';

const HEALTH_TTL_MS = 5000;
let healthCache = { at: 0, value: null };
let healthPending;

async function services() {
  if (Date.now() - healthCache.at < HEALTH_TTL_MS && healthCache.value) return healthCache.value;
  healthPending ??= Promise.all([db.ping(), ollamaHealth()]).then(([postgres, ollama]) => {
    healthCache = { at: Date.now(), value: { postgres: { ok: postgres, error: postgres ? null : dbError() }, ollama, checked_at: new Date().toISOString() } };
    return healthCache.value;
  }).finally(() => { healthPending = null; });
  // Refresh health out of band after the first observation, bounded to 30s staleness.
  return healthCache.value && Date.now() - healthCache.at < 30000 ? healthCache.value : healthPending;
}

export function registerStatusRoutes(router) {
  router.route('GET', '/api/agent-access', () => installAccess(path.join(repo, 'outputs/private'), config.agent?.enabled !== false));
  router.route('GET', '/api/status', async () => {
    const counts = await manifestSummary();
    const files = await scanWiki();
    const indexState = await readJson(dataPath('state', 'index-state.json'), {});
    return {
      name: '投资研究 Wiki',
      version: '0.2.0',
      dataRoot: root,
      csrf: csrfToken,
      model: config.embeddingModel,
      active: activeJob(),
      queue: queueLength(),
      services: await services(),
      counts: {
        files: files.size,
        ...counts,
      },
      last_index_at: indexState.last_index_at ?? null,
    };
  });

  router.route('GET', '/api/stats', async ({ url }) => {
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 50);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, '统计文档分页参数无效');
    const files = await scanWiki();
    let database = null;
    let error = null;
    try { database = await db.stats(); }
    catch (e) { error = e.code === '57014' ? '统计查询超时，请稍后重试' : e.message; }
    const { value: m } = await manifestSnapshot();
    const allDocuments = Object.values(m.documents);
    const documents = allDocuments.slice(offset, offset + limit).map(({ title, source_kind, status, pages, characters, parser, error: err, wiki_slug }) => ({
      title, source_kind, status, pages, characters, parser, error: err ?? null, wiki_slug,
    }));
    return { files: files.size, database, database_error: error, documents, documents_total: allDocuments.length, documents_offset: offset, documents_limit: limit, services: await services(), model: config.embeddingModel, dims: config.embeddingDimensions };
  });
}
