import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';

export function sharedConnection(config, root) {
  const cfg = config.sharedApi;
  if (!cfg?.enabled) return null;
  const url = new URL(process.env.QUANT_API_URL || cfg.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('sharedApi.baseUrl 必须是服务根地址');
  let apiKey = process.env.QUANT_API_KEY?.trim();
  if (!apiKey && cfg.apiKeyFile) {
    try { apiKey = readFileSync(path.resolve(root, cfg.apiKeyFile), 'utf8').trim(); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  if (!apiKey) throw new Error('请设置 QUANT_API_KEY 或 sharedApi.apiKeyFile');
  return { baseUrl: url.origin, apiKey };
}

const delay = (ms, signal) => new Promise((resolve, reject) => {
  signal?.throwIfAborted();
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  signal?.addEventListener('abort', abort, { once: true });
});

export async function retryBusy(request, { sleep = delay, signal, attempts = 6 } = {}) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    const response = await request();
    if (response.status !== 429 || attempt >= attempts - 1) return response;
    await response.body?.cancel();
    await sleep(3000, signal);
  }
}

export function validateEmbeddingInput(body) {
  const input = typeof body.input === 'string' ? [body.input] : body.input;
  if (body.model !== 'bge-m3' || !Array.isArray(input) || !input.length || input.length > 32 || input.some(t => typeof t !== 'string' || !t.trim() || [...t].length > 2000)) {
    throw new Error('内网 embedding 只接受 bge-m3、1–32 段非空文本，每段最多 2000 字；请重新分块，不可截断正文');
  }
  const payload = { model: 'bge-m3', input, encoding_format: 'float' };
  if (Buffer.byteLength(JSON.stringify(payload)) > 512 * 1024) throw new Error('Embedding 请求超过 512 KiB');
  return payload;
}

export function createSharedClient({ baseUrl, apiKey, fetchImpl = fetch, sleep = delay, pollMs = 5000 }) {
  const base = new URL(baseUrl).origin;
  async function request(route, options = {}) {
    const { timeoutMs = 180000, signal = AbortSignal.timeout(timeoutMs), ...rest } = options;
    return retryBusy(() => fetchImpl(base + route, { ...rest, signal, redirect: 'error', headers: { ...rest.headers, authorization: `Bearer ${apiKey}` } }), { sleep, signal });
  }
  async function json(route, options) {
    const response = await request(route, options);
    if (!response.ok) { await response.body?.cancel(); throw new Error(`内网服务 ${route}: HTTP ${response.status}`); }
    return response.json();
  }
  return {
    request,
    health: () => json('/health', { timeoutMs: 10000 }),
    models: () => json('/v1/models', { timeoutMs: 10000 }),
    embeddings: input => json('/v1/embeddings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(validateEmbeddingInput({ model: 'bge-m3', input })) }),
    async parsePdf(bytes, out, { timeoutMs = 65 * 60 * 1000 } = {}) {
      if (bytes.subarray(0, 5).toString() !== '%PDF-' || bytes.length > 100 * 1024 * 1024) throw new Error('只接受不超过 100 MiB 的 PDF');
      await fs.mkdir(out, { recursive: true });
      const stateFile = path.join(out, 'remote-job.json');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const save = async state => { const temp = stateFile + '.tmp'; await fs.writeFile(temp, JSON.stringify(state, null, 2)); await fs.rename(temp, stateFile); };
      let state;
      try { state = JSON.parse(await fs.readFile(stateFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (state && state.baseUrl !== base) throw new Error('已有 PDF 任务属于其他服务，请先核对 remote-job.json');
      if (state?.sha256 && state.sha256 !== sha256) throw new Error('已有 PDF 任务属于其他原件，请使用独立解析目录');
      if (state && !state.id && state.status !== 'rejected') throw new Error('PDF 提交结果不确定；请让管理员查找已有任务，并将任务 ID 写入 remote-job.json 的 id 字段，避免重复上传');
      if (!state?.id) {
        state = { baseUrl: base, sha256, status: 'submitting', submitted_at: new Date().toISOString() };
        await save(state); // Persist intent before the non-idempotent POST.
        const response = await request('/mineru/jobs', { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: bytes });
        if (response.status !== 202) {
          // Only explicit rejection proves that no work was accepted. A 5xx can be ambiguous.
          if ([400, 401, 403, 404, 413, 415, 429].includes(response.status)) { state.status = 'rejected'; await save(state); }
          await response.body?.cancel();
          throw new Error(`PDF 提交失败：HTTP ${response.status}；任务状态已保存在 remote-job.json`);
        }
        const accepted = await response.json();
        state.id = accepted.id ?? accepted.job?.id;
        if (typeof state.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(state.id)) throw new Error('服务未返回有效任务 ID，请联系管理员核对，勿重复上传');
        state.status = 'queued'; await save(state);
      }
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(state.id)) throw new Error('无效的远程任务 ID');
      const signal = AbortSignal.timeout(timeoutMs);
      for (;;) {
        const result = await json(`/mineru/jobs/${state.id}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
        const job = result.job ?? result;
        state.status = job.status; state.checked_at = new Date().toISOString(); await save(state);
        if (job.status === 'failed') throw new Error(`远程 PDF 解析失败，任务 ${state.id}；请由管理员检查 parse.log`);
        if (job.status === 'succeeded') break;
        if (!['queued', 'running'].includes(job.status)) throw new Error(`远程任务 ${state.id} 返回未知状态`);
        await sleep(pollMs, signal);
      }
      const result = await request(`/mineru/jobs/${state.id}/result`, { timeoutMs: 180000 });
      if (!result.ok) { await result.body?.cancel(); throw new Error(`PDF 结果下载失败：HTTP ${result.status}；重试将复用任务 ${state.id}`); }
      const parts = []; let size = 0;
      for await (const part of result.body) {
        size += part.length;
        if (size > 256 * 1024 * 1024) throw new Error('解析 ZIP 超过 256 MiB');
        parts.push(part);
      }
      await extractMineruZip(Buffer.concat(parts), out);
      state.downloaded_at = new Date().toISOString(); await save(state);
      return state;
    },
  };
}

export async function extractMineruZip(bytes, out) {
  const entries = new AdmZip(bytes).getEntries();
  if (entries.length > 10000) throw new Error('ZIP 文件数超限');
  const names = new Set(); let size = 0;
  for (const entry of entries) {
    const name = entry.entryName;
    const segments = name.replace(/\/$/, '').split('/');
    if (name.includes('\\') || segments.some(p => !p || p === '.' || p === '..' || /[<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p)) || !['document', 'parse-report.json'].includes(segments[0])) throw new Error('ZIP 包含不安全或非解析文件路径');
    const key = name.toLowerCase();
    if (names.has(key)) throw new Error('ZIP 包含重复路径');
    names.add(key);
    if (((entry.attr >>> 16) & 0xf000) === 0xa000) throw new Error('ZIP 不允许符号链接');
    size += entry.header.size;
    if (entry.header.size > 128 * 1024 * 1024 || size > 512 * 1024 * 1024) throw new Error('ZIP 解压大小超限');
  }
  for (const required of ['parse-report.json', 'document/auto/document.md', 'document/auto/pages.md']) if (!names.has(required)) throw new Error(`ZIP 缺少 ${required}`);
  // Validate every CRC before writing any output; keep original folder layout for images.
  const files = entries.filter(e => !e.isDirectory).map(e => ({ name: e.entryName, data: e.getData() }));
  for (const file of files) {
    const target = path.resolve(out, file.name);
    // Do not follow pre-existing symlinks (including Windows junctions).
    let current = path.resolve(out);
    for (const part of [null, ...file.name.split('/')]) {
      if (part !== null) current = path.join(current, part);
      try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('解析路径包含符号链接'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.data);
  }
}
