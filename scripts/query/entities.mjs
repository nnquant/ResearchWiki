import fs from 'node:fs/promises';
import { hash } from './blocks.mjs';
import { securityAliases } from './security-identifiers.mjs';
import { businessRelations } from './entity-relations.mjs';

export const registryFile = new URL('../../config/entity-registry.json', import.meta.url);
export const entityTypes = ['company', 'security', 'industry', 'subfield', 'topic'];
export const normalizeEntityName = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const prefixes = { '公司': 'company', '行业': 'industry', '领域': 'subfield', '主题': 'topic', '代码': 'security' };
const fields = { companies: 'company', industries: 'industry', subfields: 'subfield', tickers: 'security' };
export const tagId = tag => `tag:${hash(tag).slice(0, 24)}`;

export function compileRegistry(input) {
  if (input?.version !== 1 || !Array.isArray(input.entities)) throw new Error('实体映射表必须为 version=1，包含 entities 数组');
  const entities = new Map(), aliases = new Map();
  for (const item of input.entities) {
    if (!/^entity:[a-z0-9:_-]{1,160}$/.test(item.entity_id ?? '') || item.entity_id.startsWith('entity:observed:') || !entityTypes.includes(item.type) ||
        typeof item.name !== 'string' || !item.name.trim() || item.name.length > 500 ||
        typeof item.source !== 'string' || !item.source.trim() || !Array.isArray(item.aliases) ||
        item.aliases.some(a => typeof a !== 'string' || !a.trim() || a.length > 500)) throw new Error('实体条目需要稳定 ID、类型、名称、别名数组和来源');
    if (entities.has(item.entity_id)) throw new Error(`实体 ID 重复：${item.entity_id}`);
    if (item.type === 'security' && (!item.market || !item.code || typeof item.code !== 'string')) throw new Error('证券实体必须保存 market 和字符串 code');
    entities.set(item.entity_id, { ...item, status: 'curated' });
    const names = [item.name, ...item.aliases, ...(item.type === 'security' ? [`${item.market}:${item.code}`, ...securityAliases(item)] : [])];
    for (const name of names) {
      const key = `${item.type}:${normalizeEntityName(name)}`;
      const values = aliases.get(key) ?? new Set(); values.add(item.entity_id); aliases.set(key, values);
    }
  }
  for (const entity of entities.values()) if (entity.issuer_id && entities.get(entity.issuer_id)?.type !== 'company') throw new Error('证券 issuer_id 必须指向已配置的公司实体');
  const contextRules = new Map();
  if(input.context_rules!=null&&!Array.isArray(input.context_rules)) throw new Error('context_rules 必须是数组');
  for(const rule of input.context_rules ?? []) {
    if(!rule||!entityTypes.includes(rule.type)||typeof rule.alias!=='string'||!rule.alias.trim()||rule.alias.length>100||entities.get(rule.entity_id)?.type!==rule.type||
      !Array.isArray(rule.definitions)||!rule.definitions.length||rule.definitions.length>20||rule.definitions.some(d=>typeof d!=='string'||d.length<3||d.length>200)||typeof rule.source!=='string'||!rule.source.trim()) throw new Error('上下文规则必须包含同类型实体、别名、完整释义与来源');
    const key=`${rule.type}:${normalizeEntityName(rule.alias)}`;
    contextRules.set(key,[...contextRules.get(key) ?? [],rule]);
  }
  return {entities,aliases,contextRules,version:hash(JSON.stringify(['entity-registry-v3-context',input]))};
}
export async function loadRegistry(directory = new URL('../../config/', import.meta.url)) {
  async function readLocal(name, empty) {
    let text;
    try { text = await fs.readFile(new URL(name, directory), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return empty; throw error; }
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  }
  const base=await readLocal('entity-registry.json',{version:1,entities:[]});
  const contextual=await readLocal('entity-context-rules.json',{version:1,entities:[],context_rules:[]});
  const relationInput=await readLocal('entity-relations.json',{version:1,sources:[],relations:[]});
  const registry=compileRegistry({...base,entities:[...base.entities,...contextual.entities],context_rules:[...(base.context_rules??[]),...contextual.context_rules]});
  registry.relations=businessRelations(registry,relationInput);
  registry.version=hash(JSON.stringify([registry.version,registry.relations]));
  return registry;
}

export function entityMentions(metadata) {
  const mentions = new Map();
  const add = (type, name, field, raw) => {
    if (typeof name !== 'string' || !name.trim()) return;
    const normalized = normalizeEntityName(name);
    mentions.set(`${type}\0${normalized}\0${field}\0${raw}`, { type, name: name.trim(), normalized, field, raw });
  };
  for (const [field, type] of Object.entries(fields)) for (const value of metadata[field] ?? []) add(type, value, field, value);
  for (const raw of metadata.tags ?? []) {
    const normalized = raw.normalize('NFKC');
    const colon = normalized.indexOf(':');
    const type = prefixes[normalized.slice(0, colon).trim()];
    if (colon > 0 && type) add(type, normalized.slice(colon + 1), 'tags', raw);
  }
  return [...mentions.values()];
}

export function resolveMention(mention, registry) {
  let ids = [...(registry.aliases.get(`${mention.type}:${mention.normalized}`) ?? [])].sort();
  let matching;
  // At ingestion reuse only independently known names and market-qualified codes.
  // Keep the original metadata; this match never becomes a new global alias.
  if (!ids.length && mention.type==='company') {
    const pair=mention.normalized.match(/^(.+?)\s*\(([^()]+)\)$/);
    if(pair) {
      const names=registry.aliases.get(`company:${normalizeEntityName(pair[1])}`)??new Set();
      const codes=registry.aliases.get(`security:${normalizeEntityName(pair[2])}`)??new Set();
      ids=[...new Set([...codes].map(id=>registry.entities.get(id)?.issuer_id).filter(id=>names.has(id)))];
      if(ids.length===1) matching='known_name_and_qualified_code';
    }
  }
  if (ids.length > 1) return { ...mention, status: 'ambiguous', candidates: ids, entity: null };
  if (ids.length === 1) return { ...mention, status: 'curated', candidates: ids, entity: registry.entities.get(ids[0]),matching };
  // Exact normalized text is an observed name, not a verified company identity.
  const entity = { entity_id: `entity:observed:${hash(`${mention.type}:${mention.normalized}`).slice(0, 24)}`, type: mention.type,
    name: mention.name, aliases: [], source: 'recorded_metadata', status: 'observed' };
  return { ...mention, status: 'observed', candidates: [], entity };
}
