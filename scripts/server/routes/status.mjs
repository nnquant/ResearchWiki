import { config, root, manifestSnapshot, manifestSummary, dataPath, readJson } from '../../common.mjs';
import { csrfToken } from '../security.mjs';
import { activeJob, queueLength } from '../jobs.mjs';
import * as db from '../db.mjs';
import { mcpHealth } from '../mcp-client.mjs';
import { ollamaHealth } from '../search-service.mjs';
import { scanWiki } from '../wiki-files.mjs';
import { dbError } from '../pages-service.mjs';

const HEALTH_TTL_MS = 5000;
let healthCache = { at: 0, value: null };
let healthPending;

async function services() {
  if (Date.now() - healthCache.at < HEALTH_TTL_MS && healthCache.value) return healthCache.value;
  healthPending ??= Promise.all([db.ping(), mcpHealth(), ollamaHealth()]).then(([postgres, mcp, ollama]) => {
    healthCache = { at: Date.now(), value: { postgres: { ok: postgres, error: postgres ? null : dbError() }, mcp, ollama, checked_at: new Date().toISOString() } };
    return healthCache.value;
  }).finally(() => { healthPending = null; });
  // Refresh health out of band after the first observation, bounded to 30s staleness.
  return healthCache.value && Date.now() - healthCache.at < 30000 ? healthCache.value : healthPending;
}

export function registerStatusRoutes(router) {
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

  router.route('GET', '/api/stats', async () => {
    const files = await scanWiki();
    let database = null;
    let error = null;
    try { database = await db.stats(); }
    catch (e) { error = e.message; }
    const { value: m } = await manifestSnapshot();
    const documents = Object.values(m.documents).map(({ title, source_kind, status, pages, characters, parser, error: err, wiki_slug }) => ({
      title, source_kind, status, pages, characters, parser, error: err ?? null, wiki_slug,
    }));
    return { files: files.size, database, database_error: error, documents, services: await services(), model: config.embeddingModel, dims: config.embeddingDimensions };
  });
}
