import fs from 'node:fs/promises';
import path from 'node:path';
import { repo } from './common.mjs';

export const articleSchema = JSON.parse(await fs.readFile(path.join(repo, 'config/article-metadata.schema.json'), 'utf8'));

function normalizeValue(raw,definition,label) {
  const spec=definition.$ref?articleSchema.$defs[definition.$ref.split('/').at(-1)]:definition;
  const types=Array.isArray(spec.type)?spec.type:[spec.type];
  const value=typeof raw==='string'?raw.trim():raw;
  if(value===null||value===''||(Array.isArray(value)&&!value.length)) {
    if(types.includes('null'))return null;
    throw new Error(`${label}不能为空`);
  }
  if(types.includes('array')) {
    if(!Array.isArray(value)||value.length>(spec.maxItems??100)||value.length<(spec.minItems??0))throw new Error(`${label}数组长度不正确`);
    const items=value.map(item=>normalizeValue(item,spec.items,label));
    return items.every(item=>typeof item==='string')?[...new Set(items)]:items;
  }
  if(types.includes('object')) {
    if(typeof value!=='object'||Array.isArray(value))throw new Error(`${label}需要对象`);
    const result={};
    for(const [key,item] of Object.entries(value)) {
      if(!Object.hasOwn(spec.properties,key))throw new Error(`${label}不支持字段 ${key}`);
      result[key]=normalizeValue(item,spec.properties[key],`${label}.${key}`);
    }
    for(const key of spec.required??[])if(!Object.hasOwn(result,key))throw new Error(`${label}缺少 ${key}`);
    return result;
  }
  if(types.includes('number')||types.includes('integer')) {
    if(typeof value!=='number'||!Number.isFinite(value)||(types.includes('integer')&&!Number.isInteger(value))||value<(spec.minimum??-Infinity)||value>(spec.maximum??Infinity))throw new Error(`${label}数值不正确`);
    return value;
  }
  if(typeof value!=='string'||value.length>(spec.maxLength??10000)||value.length<(spec.minLength??1))throw new Error(`${label}格式或长度不正确`);
  if(spec.enum&&!spec.enum.includes(value))throw new Error(`${label}值不受支持`);
  if(spec.format==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw new Error(`${label}需要真实日期 YYYY-MM-DD；无法确定时留空`);
  return value;
}

export function normalizeArticleMetadata(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('metadata 必须是对象');
  const out = {};
  for (const [key, raw] of Object.entries(input)) {
    const spec = Object.hasOwn(articleSchema.properties, key) ? articleSchema.properties[key] : null;
    if (!spec) throw new Error(`不支持的文献字段：${key}`);
    if(key==='analyst_expectations') {out[key]=normalizeValue(raw,spec,spec.title);continue;}
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
