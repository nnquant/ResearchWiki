// Loaded by Bun for both CLI indexing and the MCP process. Only touches the configured service.
import { createSharedEmbeddingFetch } from './shared-embedding-fetch.mjs';
if (process.env.WIKI_SHARED_API === '1') {
  const originalFetch = globalThis.fetch;
  const endpoint = process.env.OLLAMA_BASE_URL.replace(/\/$/, '') + '/embeddings';
  globalThis.fetch = createSharedEmbeddingFetch({fetchImpl:originalFetch,endpoint,cacheDir:process.env.WIKI_EMBED_CACHE,
    onRetry:event=>console.error('[shared-embedding-retry] '+JSON.stringify(event))});
}
