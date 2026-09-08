// Loaded by Bun for both CLI indexing and the MCP process. Only touches the configured service.
import { retryBusy, validateEmbeddingInput } from './shared-api-client.mjs';
if (process.env.WIKI_SHARED_API === '1') {
  const originalFetch = globalThis.fetch;
  const endpoint = process.env.OLLAMA_BASE_URL.replace(/\/$/, '') + '/embeddings';
  let queue = Promise.resolve();
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== endpoint) return originalFetch(input, init);
    const request = new Request(input, init);
    const payload = validateEmbeddingInput(await request.json());
    const run = queue.then(() => retryBusy(() => originalFetch(endpoint, {
      method: 'POST', headers: request.headers, body: JSON.stringify(payload), signal: request.signal, redirect: 'error',
    }), { signal: request.signal }));
    queue = run.then(() => undefined, () => undefined);
    return run;
  };
}
