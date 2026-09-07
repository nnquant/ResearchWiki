import { parse as parseYaml } from 'yaml';
import type { Diagnostic } from '@codemirror/lint';
import type { IndexEntry } from '../api/types';
import { RELATION_FIELDS, TYPE_META } from '../lib/types';
import { normalizeSlug, slugDir } from '../lib/slug';
import { RESEARCH_FIELDS, researchError } from '../lib/research';

const PAGE_TYPES = Object.keys(TYPE_META);

export interface LintResult {
  diagnostics: Diagnostic[];
  frontmatter: Record<string, unknown> | null;
}

/** Client-side mirror of the server's validation so problems show before saving. */
export function lintPage(text: string, slug: string, index: IndexEntry[]): LintResult {
  const diagnostics: Diagnostic[] = [];
  const known = new Set(index.map(i => i.slug));
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!fmMatch) {
    diagnostics.push({ from: 0, to: Math.min(text.length, 3), severity: 'error', message: '页面必须以 --- frontmatter 开头，且包含 title 和 type' });
    return { diagnostics, frontmatter: null };
  }
  const fmStart = 4;
  const fmEnd = fmMatch[0].length;
  let frontmatter: Record<string, unknown> | null = null;
  try {
    const parsed = parseYaml(fmMatch[1]);
    frontmatter = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch (e) {
    diagnostics.push({ from: fmStart, to: fmEnd, severity: 'error', message: `frontmatter YAML 无法解析：${(e as Error).message}` });
    return { diagnostics, frontmatter: null };
  }

  const fieldRange = (field: string): [number, number] => {
    const re = new RegExp(`^${field}\\s*:`, 'm');
    const m = fmMatch[1].match(re);
    if (!m || m.index === undefined) return [fmStart, fmEnd];
    const from = fmStart + m.index;
    const lineEnd = fmMatch[1].indexOf('\n', m.index);
    return [from, fmStart + (lineEnd < 0 ? fmMatch[1].length : lineEnd)];
  };

  if (typeof frontmatter.title !== 'string' || !frontmatter.title.trim()) {
    diagnostics.push({ from: fmStart, to: fmEnd, severity: 'error', message: '缺少非空的 title' });
  }
  const dir = slugDir(slug);
  const expectedType = dir ? Object.entries(TYPE_META).find(([, m]) => m.dir === dir)?.[0] : 'note';
  if (typeof frontmatter.type !== 'string' || !PAGE_TYPES.includes(frontmatter.type)) {
    const [from, to] = fieldRange('type');
    diagnostics.push({ from, to, severity: 'error', message: `type 必须是：${PAGE_TYPES.join(', ')}` });
  } else if (dir && expectedType && frontmatter.type !== expectedType) {
    const [from, to] = fieldRange('type');
    diagnostics.push({ from, to, severity: 'error', message: `type "${frontmatter.type}" 与目录 ${dir}/ 不匹配（应为 ${expectedType}）` });
  }
  for (const field of ['tags', 'aliases']) {
    const value = frontmatter[field];
    if (value !== undefined && !(Array.isArray(value) && value.every(v => typeof v === 'string'))) {
      const [from, to] = fieldRange(field);
      diagnostics.push({ from, to, severity: 'error', message: `${field} 必须是字符串数组` });
    }
  }
  for (const field of Object.keys(RESEARCH_FIELDS)) {
    const message = researchError(field, frontmatter[field]);
    if (message) {
      const [from, to] = fieldRange(field);
      diagnostics.push({ from, to, severity: 'error', message });
    }
  }
  for (const field of RELATION_FIELDS) {
    const raw = frontmatter[field];
    if (raw === undefined || raw === null) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      const target = normalizeSlug(String(value).replace(/^\[\[|\]\]$/g, '').split('|')[0]);
      if (!target || !known.has(target)) {
        const [from, to] = fieldRange(field);
        diagnostics.push({ from, to, severity: 'error', message: `${field} 指向不存在的页面：${target || '(空)'}` });
      }
    }
  }
  // Unresolved wikilinks in the body are warnings — the page still saves.
  const body = text.slice(fmEnd);
  for (const m of body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
    const target = normalizeSlug(m[1].split('#')[0]);
    if (target && !known.has(target)) {
      const from = fmEnd + (m.index ?? 0);
      diagnostics.push({ from, to: from + m[0].length, severity: 'warning', message: `链接目标不存在：${target}` });
    }
  }
  return { diagnostics, frontmatter };
}
