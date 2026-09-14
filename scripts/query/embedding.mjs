import { config, root } from '../common.mjs';
import { sharedConnection } from './embedding-connection.mjs';

export async function embedQuery(query, signal) {
  const model = String(config.embeddingModel ?? 'ollama:bge-m3');
  let url, body, headers = { 'content-type': 'application/json' };
  if (config.sharedApi?.enabled) {
    const connection = sharedConnection(config, root);
    url = `${connection.baseUrl}/v1/embeddings`;
    headers.authorization = `Bearer ${connection.apiKey}`;
    body = { model: 'bge-m3', input: [query], encoding_format: 'float' };
  } else {
    url = `${config.ollamaUrl}/api/embed`;
    body = { model: model.replace(/^ollama:/, ''), input: query };
  }
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error' });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`embedding HTTP ${response.status}`); }
  const result = await response.json();
  const vector = result.data?.[0]?.embedding ?? result.embeddings?.[0];
  if (!Array.isArray(vector) || !vector.length || vector.length > 4096 || vector.some(x => !Number.isFinite(x))) throw new Error('embedding 返回无效向量');
  return { vector, model };
}
