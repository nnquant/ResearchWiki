import fs from 'node:fs/promises';
import path from 'node:path';
import { repo } from './common.mjs';

export const articleSchema = JSON.parse(await fs.readFile(path.join(repo, 'config/article-metadata.schema.json'), 'utf8'));

export function normalizeArticleMetadata(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('metadata 必须是对象');
  const out = {};
  for (const [key, raw] of Object.entries(input)) {
    const spec = Object.hasOwn(articleSchema.properties, key) ? articleSchema.properties[key] : null;
    if (!spec) throw new Error(`不支持的文献字段：${key}`);
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (value === null || value === '' || (Array.isArray(value) && !value.length)) { out[key] = null; continue; }
    if (spec.type.includes('array')) {
      if (!Array.isArray(value) || value.length > spec.maxItems || value.some(x => typeof x !== 'string' || x.length > 10000)) throw new Error(`${spec.title}需要字符串数组，最多 ${spec.maxItems} 项`);
      const items = [...new Set(value.map(x => x.trim()).filter(Boolean))];
      out[key] = items.length ? items : null;
    } else if (spec.type.includes('number')) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < spec.minimum || value > spec.maximum) throw new Error(`${spec.title}应在 ${spec.minimum}–${spec.maximum} 之间`);
      out[key] = value;
    } else {
      if (typeof value !== 'string' || value.length > (spec.maxLength ?? 20000)) throw new Error(`${spec.title}格式或长度不正确`);
      if (spec.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error(`${spec.title}需要真实日期 YYYY-MM-DD；无法确定时留空`);
      if (spec.enum && !spec.enum.includes(value)) throw new Error(`${spec.title}值不受支持`);
      out[key] = value;
    }
  }
  if (out.sample_start && out.sample_end && out.sample_start > out.sample_end) throw new Error('样本开始不能晚于样本结束');
  return out;
}

export function articleMetadataOf(frontmatter) {
  return Object.fromEntries(Object.keys(articleSchema.properties).map(key => [key, frontmatter[key] ?? null]));
}
