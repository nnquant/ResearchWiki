import { splitFrontmatter, scanWiki } from './wiki-files.mjs';
import { PAGE_TYPES, RELATION_FIELDS, typeForSlug, dirForSlug, relationTarget } from './slugs.mjs';

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Validate a page's full markdown before it is written. Returns
 * { ok, frontmatter, body, errors: [{ field, message }] }.
 */
export async function validatePageText(text, { slug }) {
  const errors = [];
  if (typeof text !== 'string' || !text.length) errors.push({ field: 'content', message: '内容不能为空' });
  if (Buffer.byteLength(text ?? '', 'utf8') > MAX_BYTES) errors.push({ field: 'content', message: '内容超过 2 MB' });
  if (errors.length) return { ok: false, frontmatter: {}, body: '', errors };

  const { frontmatter, body, error } = splitFrontmatter(text);
  if (error) errors.push({ field: 'frontmatter', message: `frontmatter 不是有效的 YAML：${error}` });
  if (!/^---\r?\n/.test(text)) errors.push({ field: 'frontmatter', message: '页面必须以 --- frontmatter 开头' });

  if (typeof frontmatter.title !== 'string' || !frontmatter.title.trim()) {
    errors.push({ field: 'title', message: 'frontmatter 需要非空的 title' });
  }
  const expectedType = typeForSlug(slug);
  if (typeof frontmatter.type !== 'string' || !PAGE_TYPES.includes(frontmatter.type)) {
    errors.push({ field: 'type', message: `type 必须是以下之一：${PAGE_TYPES.join(', ')}` });
  } else if (dirForSlug(slug) && frontmatter.type !== expectedType) {
    errors.push({ field: 'type', message: `type "${frontmatter.type}" 与目录 "${dirForSlug(slug)}/" 不匹配（应为 ${expectedType}）` });
  }
  for (const field of ['tags', 'aliases']) {
    const value = frontmatter[field];
    if (value != null && !(Array.isArray(value) && value.every(v => typeof v === 'string'))) {
      errors.push({ field, message: `${field} 必须是字符串数组` });
    }
  }
  const files = await scanWiki();
  for (const field of RELATION_FIELDS) {
    const raw = frontmatter[field];
    if (raw === undefined || raw === null) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      const target = relationTarget(value);
      if (!target) { errors.push({ field, message: `${field} 含有空的目标` }); continue; }
      if (!files.has(target)) errors.push({ field, message: `${field} 指向不存在的页面：${target}` });
    }
  }
  return { ok: errors.length === 0, frontmatter, body, errors };
}
