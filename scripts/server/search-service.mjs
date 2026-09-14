import { config, root, gb } from '../common.mjs';
import { sharedConnection, createSharedClient } from '../shared-api-client.mjs';
import { callTool } from './mcp-client.mjs';
import { pdfPageForChunk, categoryForPage } from './pages-service.mjs';
import { HttpError } from './errors.mjs';

const SNIPPET_CHARS = 700;
const ollamaModel = String(config.embeddingModel ?? 'ollama:bge-m3').replace(/^ollama:/, '');
const WARM_INTERVAL_MS = 4 * 60 * 1000;

/**
 * Keep the embedding model resident. Ollama unloads idle models; the first
 * query after that pays ~7 s of cold start and gbrain's 8 s embed deadline
 * turns it into an empty result set.
 */
export async function warmEmbeddings() {
  if (config.sharedApi?.enabled) return false;
  try {
    const response = await fetch(`${config.ollamaUrl}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: ollamaModel, input: 'warm', keep_alive: '2h' }),
      signal: AbortSignal.timeout(60000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function startEmbeddingWarmer() {
  if (config.sharedApi?.enabled) return; // Shared service controls its own model residency.
  warmEmbeddings();
  const timer = setInterval(warmEmbeddings, WARM_INTERVAL_MS);
  timer.unref();
}

export async function ollamaHealth() {
  try {
    if (config.sharedApi?.enabled) {
      const client = createSharedClient(sharedConnection(config, root));
      const models = await client.models();
      return { ok: true, model_present: models.data?.some(m => m.id === ollamaModel) ?? false, provider: 'shared', endpoint: config.sharedApi.baseUrl };
    }
    const res = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { ok: false };
    const body = await res.json();
    const loaded = (body.models ?? []).some(m => String(m.name).startsWith(ollamaModel));
    return { ok: true, model_present: loaded };
  } catch (error) {
    return { ok: false, provider: config.sharedApi?.enabled ? 'shared' : 'local', error: error.message };
  }
}

/** Reduce a chunk to readable prose: drop page markers, images, headings syntax, links and display math. */
function trimSnippet(text) {
  const clean = String(text ?? '')
    .replace(/\r/g, '')
    .replace(/^## PDF 第 \d+ 页\s*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/\$\$[\s\S]*?\$\$/g, ' [公式] ')
    .replace(/\$\$/g, ' ')
    .replace(/^[^\n]*(\\[a-zA-Z]+\s*[{(]|_ \{|\^ \{)[^\n]*$/gm, '[公式]')
    .replace(/(\[公式\]\s*){2,}/g, '[公式] ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label ?? target)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\*\*|__/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (clean.length <= SNIPPET_CHARS) return clean;
  return clean.slice(0, SNIPPET_CHARS) + ' …';
}

function normalizeHit(hit) {
  return {
    slug: hit.slug,
    page_id: hit.page_id ?? null,
    title: hit.title ?? hit.slug,
    type: hit.type ?? null,
    chunk_text: trimSnippet(hit.chunk_text),
    chunk_index: hit.chunk_index ?? 0,
    chunk_source: hit.chunk_source ?? null,
    score: typeof hit.score === 'number' ? hit.score : null,
    stale: Boolean(hit.stale),
    keyword_hit: hit.keyword_hit ?? null,
    raw_chunk: hit.chunk_text ?? '',
  };
}

/**
 * Hybrid search. `fast` = gbrain `search` (no LLM expansion), `deep` = gbrain `query`.
 * Goes through the MCP server so no bun process is spawned per keystroke; falls
 * back to the CLI when MCP is unavailable.
 */
export async function search({ q, mode = 'fast', types = [], limit = 20, offset = 0 }) {
  const query = String(q ?? '').trim();
  if (!query || query.length > 1000) throw new HttpError(400, '请输入 1–1000 字的研究问题');
  const started = Date.now();
  let hits = [];
  let engine = 'mcp';
  let degraded = [];
  try {
    const tool = mode === 'deep' ? 'query' : 'search';
    const args = { query, limit, offset, snippet_chars: 0 };
    if (types.length) args.types = types;
    const { data, meta } = await callTool(tool, args, { timeoutMs: config.sharedApi?.enabled ? 240000 : 90000 });
    hits = Array.isArray(data) ? data : [];
    degraded = meta?.retrieval?.degraded ?? [];
  } catch (mcpError) {
    engine = 'cli';
    const args = ['query', query, '--json'];
    if (types.length) args.push('--types', types.join(','));
    const { stdout } = await gb(args, { timeout: config.sharedApi?.enabled ? 240000 : 120000 });
    try { hits = JSON.parse(stdout); }
    catch { throw new HttpError(502, `检索失败：${mcpError.message}`); }
    hits = hits.slice(offset, offset + limit);
  }
  const results = [];
  for (const hit of hits.map(normalizeHit)) {
    const { raw_chunk, ...rest } = hit;
    rest.category = await categoryForPage(hit.slug) ?? hit.type;
    rest.pdf_page = hit.type === 'source' ? await pdfPageForChunk(hit.slug, raw_chunk) : null;
    results.push(rest);
  }
  return { query, mode, engine, latency_ms: Date.now() - started, degraded, results };
}
