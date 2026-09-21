import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
export async function connection(options = {}, env = process.env) {
  let baseUrl = options.baseUrl ?? env.RESEARCHWIKI_URL;
  let token = env.RESEARCHWIKI_TOKEN, tokenFile = options.tokenFile ?? env.RESEARCHWIKI_TOKEN_FILE;
  if (!baseUrl) {
    // Only local mode loads server configuration. Remote clients need no data directory or DB.
    const { config, dataPath } = await import('../common.mjs');
    baseUrl = `http://127.0.0.1:${config.port}`;
    if (!token && !tokenFile) tokenFile = dataPath('runtime', 'mcp-read-token');
  }
  if (tokenFile) token = (await fs.readFile(tokenFile, 'utf8')).trim();
  if (!token?.trim()) throw Object.assign(new Error('请设置 RESEARCHWIKI_TOKEN 或 RESEARCHWIKI_TOKEN_FILE'), { code: 'AUTH_REQUIRED' });
  let url;
  try { url = new URL(baseUrl); } catch { /* reported below */ }
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw Object.assign(new Error('RESEARCHWIKI_URL 必须是无内嵌凭据的 HTTP(S) 服务地址'), { code: 'INVALID_ARGUMENT' });
  }
  return { baseUrl: url.href.replace(/\/$/, ''), token: token.trim() };
}
export async function agentRequest(operation, request = {}, { signal, ...options } = {}) {
  if (!['describe', 'resolve', 'query', 'search', 'read', 'related', 'graph'].includes(operation)) throw Object.assign(new Error('未知操作'), { code: 'INVALID_ARGUMENT' });
  const { baseUrl, token } = await connection(options);
  for (let attempt = 0; attempt < 2; attempt++) {
  const deadline = AbortSignal.timeout((request.timeout_ms ?? 15000) + 3000);
  try {
    const response = await fetch(`${baseUrl}/api/research/${operation}`, { method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(request),
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
    let result;
    try { result = await response.json(); }
    catch { throw Object.assign(new Error(`服务返回非 JSON 响应（HTTP ${response.status}），请检查服务地址或代理`), { code: 'INVALID_RESPONSE', status: response.status }); }
    if (!response.ok) throw Object.assign(new Error(result.error ?? '查询失败'), { code: result.code ?? 'REQUEST_FAILED', status: response.status, retry_after: response.headers.get('retry-after') ?? result.retry_after ?? null });
    return result;
  } catch (e) {
    if (['TimeoutError', 'AbortError'].includes(e.name)) e = Object.assign(new Error(e.message), { name: e.name, code: 'TIMEOUT', cause: e });
    else if (!e.code) e.code = 'SERVICE_UNAVAILABLE';
    if (attempt || signal?.aborted || !([429, 503, 504].includes(e.status) || e.code === 'TIMEOUT')) throw e;
    const retrySeconds = e.retry_after == null ? NaN : Number(e.retry_after);
    const retryMs = Number.isFinite(retrySeconds) ? retrySeconds * 1000 : Date.parse(e.retry_after) - Date.now();
    if (retryMs > 30000) throw e;
    const backoff = 300 * 2 ** attempt + Math.floor(Math.random() * 200);
    await delay(Math.max(backoff, Number.isFinite(retryMs) ? Math.max(0, retryMs) : 0), undefined, { signal });
  }
  }
}
