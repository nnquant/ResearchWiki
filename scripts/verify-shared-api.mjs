import fs from 'node:fs/promises';
import path from 'node:path';
import { config, root, dataPath, atomicJson, sha } from './common.mjs';
import { sharedConnection, createSharedClient } from './shared-api-client.mjs';
const connection = sharedConnection(config, root);
if (!connection) throw new Error('sharedApi 尚未启用');
const client = createSharedClient(connection);
const health = await client.health();
const vectors = await client.embeddings(['内网 GPU 服务验收：行业、宏观与公司研究。', 'Cross-sectional momentum']);
if (vectors.data?.length !== 2 || vectors.data.some(x => x.embedding?.length !== 1024 || !x.embedding.every(Number.isFinite))) throw new Error('Embedding 向量验收失败');
const report = { at: new Date().toISOString(), endpoint: connection.baseUrl, health, vectors: vectors.data.map(x => ({ index: x.index, dimensions: x.embedding.length })) };
if (process.argv[2]) {
  const file = path.resolve(process.argv[2]);
  const bytes = await fs.readFile(file);
  const output = dataPath('state', 'shared-api-acceptance-pdf', sha(bytes).slice(0, 24));
  const job = await client.parsePdf(bytes, output);
  report.pdf = { job_id: job.id, output, parse_report: JSON.parse(await fs.readFile(path.join(output, 'parse-report.json'), 'utf8')), characters: (await fs.readFile(path.join(output, 'document/auto/pages.md'), 'utf8')).length };
}
await atomicJson(dataPath('state', 'shared-api-client-acceptance.json'), report);
console.log(JSON.stringify(report, null, 2));
