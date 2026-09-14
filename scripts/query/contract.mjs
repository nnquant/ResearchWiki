import { HttpError } from '../server/errors.mjs';

export const VERSION = 'research-query-v1';
export const FIELDS = {
  tags: 'array', tickers: 'array', companies: 'array', industries: 'array', subfields: 'array',
  institutions: 'array', authors: 'array', aliases: 'array', markets: 'array', research_topics: 'array',
  page_type: 'string', research_category: 'string', document_type: 'string', language: 'string',
  research_stage: 'string', review_status: 'string', region: 'string', status: 'string',
  published_at: 'date', data_as_of: 'date', ingested_at: 'date', updated_at: 'date',
};
export const OPS = ['eq', 'in', 'gte', 'lte', 'exists', 'contains_all', 'contains_any', 'contains_none'];
export function fail(code, message, status = 400) { throw new HttpError(status, message, { code }); }
export function object(value, name = 'request') {
  if (!value || Array.isArray(value) || typeof value !== 'object') fail('INVALID_ARGUMENT', `${name} 必须是对象`);
}
export function keys(value, allowed, name = 'request') {
  object(value, name);
  for (const k of Object.keys(value)) if (!allowed.includes(k)) fail('INVALID_ARGUMENT', `${name}: 不支持 ${k}`);
}
export function integer(value, fallback, min, max, name) {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < min || n > max) fail('INVALID_ARGUMENT', `${name} 应在 ${min}–${max} 之间`);
  return n;
}
export function strings(value, name = 'values', max = 100) {
  if (!Array.isArray(value) || value.length > max || value.some(x => typeof x !== 'string' || !x.trim() || x.length > 500)) fail('INVALID_ARGUMENT', `${name} 必须是非空字符串数组（最多 ${max} 项）`);
  return [...new Set(value)];
}
export function text(value, name, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('INVALID_ARGUMENT', `${name} 必须为 1–${max} 字符`);
  return value.trim();
}
export function validateFilters(node, depth = 0, count = { n: 0 }) {
  if (node == null) return null;
  if (++count.n > 100 || depth > 5) fail('INVALID_ARGUMENT', '过滤条件过于复杂');
  object(node, 'filters');
  const group = ['all', 'any', 'not'].find(k => Object.hasOwn(node, k));
  if (group) {
    keys(node, [group], 'filters');
    if (group === 'not') return { not: validateFilters(node.not, depth + 1, count) ?? fail('INVALID_ARGUMENT', 'not 不能为空') };
    if (!Array.isArray(node[group]) || !node[group].length) fail('INVALID_ARGUMENT', `${group} 必须是非空数组`);
    return { [group]: node[group].map(x => validateFilters(x, depth + 1, count) ?? fail('INVALID_ARGUMENT', '过滤项不能为空')) };
  }
  keys(node, ['field', 'op', 'value'], 'filter');
  if (!Object.hasOwn(FIELDS, node.field) || !OPS.includes(node.op)) fail('INVALID_ARGUMENT', '未知过滤字段或操作符');
  const kind = FIELDS[node.field];
  if (node.op === 'exists') {
    if (typeof node.value !== 'boolean') fail('INVALID_ARGUMENT', 'exists 的值必须是布尔值');
  } else if (['in', 'contains_all', 'contains_any', 'contains_none'].includes(node.op)) {
    strings(node.value);
    if (!node.value.length) fail('INVALID_ARGUMENT', '过滤值不能为空');
    if (node.op !== 'in' && kind !== 'array') fail('INVALID_ARGUMENT', 'contains 操作只适用于多值字段');
  } else {
    text(node.value, 'filter.value', 500);
    if (['gte', 'lte'].includes(node.op) && kind !== 'date') fail('INVALID_ARGUMENT', '范围比较只支持日期字段');
  }
  if (kind === 'date' && node.op !== 'exists') {
    for (const v of Array.isArray(node.value) ? node.value : [node.value]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) fail('INVALID_ARGUMENT', '日期格式应为有效 YYYY-MM-DD');
    }
  }
  return node;
}

/** Every value is bound; only validated field/operation names influence SQL. */
export function filterSql(filter, params, alias = 'd') {
  if (!filter) return 'TRUE';
  const bind = value => { params.push(value); return `$${params.length}`; };
  if (filter.all) return '(' + filter.all.map(f => filterSql(f, params, alias)).join(' AND ') + ')';
  if (filter.any) return '(' + filter.any.map(f => filterSql(f, params, alias)).join(' OR ') + ')';
  if (filter.not) return `(NOT ${filterSql(filter.not, params, alias)})`;
  const { field, op, value } = filter;
  const key = bind(field), json = `${alias}.metadata -> ${key}`, scalar = `${alias}.metadata ->> ${key}`;
  if (op === 'exists') return `((${json} IS NOT NULL AND ${json} <> 'null'::jsonb AND ${json} <> '[]'::jsonb AND ${json} <> '\"\"'::jsonb) = ${bind(value)})`;
  if (FIELDS[field] === 'array') {
    const list = bind(Array.isArray(value) ? value : [value]);
    const operator = op === 'contains_all' ? '?&' : '?|';
    const expr = `COALESCE(${json} ${operator} ${list}::text[], FALSE)`;
    return op === 'contains_none' ? `NOT (${expr})` : expr;
  }
  if (op === 'in') return `COALESCE(${scalar} = ANY(${bind(value)}::text[]), FALSE)`;
  return `COALESCE(${scalar} ${{ eq: '=', gte: '>=', lte: '<=' }[op]} ${bind(value)}, FALSE)`;
}

export function tagsFilter({ tags_all = [], tags_any = [], tags_none = [] } = {}) {
  const all = [];
  for (const [op, values] of [['contains_all', tags_all], ['contains_any', tags_any], ['contains_none', tags_none]]) {
    strings(values);
    if (values.length) all.push({ field: 'tags', op, value: values });
  }
  return all.length ? { all } : null;
}
export function matchesTags(tags = [], { tags_all = [], tags_any = [], tags_none = [] } = {}) {
  return tags_all.every(t => tags.includes(t)) && (!tags_any.length || tags_any.some(t => tags.includes(t))) && !tags_none.some(t => tags.includes(t));
}
export function combine(...filters) { const all = filters.filter(Boolean); return all.length ? { all } : null; }

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
export function terms(value) {
  return [...segmenter.segment(value.normalize('NFKC').toLowerCase())].filter(s => s.isWordLike).map(s => s.segment);
}
export function tokenText(value) { return terms(value).join(' '); }
export function tsQuery(value) { return [...new Set(terms(value))].slice(0, 80).map(t => `'${t.replace(/'/g, "''")}'`).join(' | '); }

export const FILTER_SCHEMA = {
  anyOf: [
    { type: 'object', properties: { field: { enum: Object.keys(FIELDS) }, op: { enum: OPS }, value: { anyOf: [{ type: 'string' }, { type: 'boolean' }, { type: 'array', items: { type: 'string' } }] } }, required: ['field', 'op', 'value'], additionalProperties: false },
    ...['all', 'any'].map(k => ({ type: 'object', properties: { [k]: { type: 'array', minItems: 1, maxItems: 100, items: { $ref: '#/$defs/filter' } } }, required: [k], additionalProperties: false })),
    { type: 'object', properties: { not: { $ref: '#/$defs/filter' } }, required: ['not'], additionalProperties: false },
  ],
};
