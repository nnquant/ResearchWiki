// Reproducible compatibility patch for the pinned GBrain source. No text is truncated.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'vendor/gbrain/src/core/chunkers/recursive.ts');
let source = await fs.readFile(file, 'utf8');
const replacements = [
  ['export const MARKDOWN_CHUNKER_VERSION = 3;', "export const MARKDOWN_CHUNKER_VERSION = process.env.WIKI_SHARED_API === '1' ? 10003 : 3;"],
  ['const maxChars = opts?.maxChars || 6000;', "const maxChars = process.env.WIKI_SHARED_API === '1' ? Math.min(opts?.maxChars || 6000, 1300) : (opts?.maxChars || 6000);"],
];
for (const [before, after] of replacements) {
  if (source.includes(after)) continue;
  if (source.split(before).length !== 2) throw new Error('GBrain 分块器与固定版本不匹配，请检查兼容补丁');
  source = source.replace(before, after);
}
await fs.writeFile(file, source);
console.log('GBrain 分块兼容已就绪（内网模式：1300 字符正文，预留上下文空间）');
const retryFile=path.join(root,'vendor/gbrain/src/core/embed-retry.ts');
let retrySource=await fs.readFile(retryFile,'utf8');
const retryBefore='export const MAX_RATE_LIMIT_RETRIES = 5;';
const retryAfter="export const MAX_RATE_LIMIT_RETRIES = process.env.WIKI_SHARED_API === '1' ? 0 : 5;";
if(!retrySource.includes(retryAfter)) {
  if(retrySource.split(retryBefore).length!==2)throw new Error('GBrain 向量重试器与固定版本不匹配');
  retrySource=retrySource.replace(retryBefore,retryAfter);
  await fs.writeFile(retryFile,retrySource);
}
console.log('内网向量服务仅在小批次层重试，避免整篇重复请求');
