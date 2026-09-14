import { readFileSync } from 'node:fs';
import path from 'node:path';

// Only embedding connection settings are shared; PDF parsing and ingest clients remain outside this layer.
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
