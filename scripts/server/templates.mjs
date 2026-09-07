import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { repo } from '../common.mjs';
import { PAGE_TYPES, TYPE_LABELS, dirForType } from './slugs.mjs';

const templatesDir = path.join(repo, 'config', 'templates');
let cache = null;

/** Templates keyed by type. `_default` is used for types without a dedicated file. */
export async function loadTemplates() {
  if (cache) return cache;
  const map = new Map();
  for (const name of await fs.readdir(templatesDir)) {
    if (!name.endsWith('.md')) continue;
    const parsed = matter(await fs.readFile(path.join(templatesDir, name), 'utf8'));
    map.set(name.replace(/\.md$/, ''), { meta: parsed.data ?? {}, body: parsed.content.replace(/^\s+/, '') });
  }
  cache = map;
  return map;
}

export async function listTemplates() {
  const templates = await loadTemplates();
  return PAGE_TYPES
    .filter(type => type !== 'source')
    .map(type => {
      const own = templates.get(type);
      const tpl = own ?? templates.get('_default');
      return {
        type,
        label: own?.meta.label ?? TYPE_LABELS[type] ?? type,
        description: tpl?.meta.description ?? '',
        dir: dirForType(type),
        fields: tpl?.meta.fields ?? [],
      };
    });
}

/** Render a new page's full markdown (frontmatter + body) for a type. */
export async function renderTemplate(type, { title, slug, tags = [], relations = {} }) {
  const templates = await loadTemplates();
  const tpl = templates.get(type) ?? templates.get('_default');
  const today = new Date().toISOString().slice(0, 10);
  const data = { title, type, status: 'draft', created: today };
  if (tags.length) data.tags = tags;
  for (const [field, targets] of Object.entries(relations)) {
    if (Array.isArray(targets) && targets.length) data[field] = targets;
  }
  const body = (tpl?.body ?? `# {{title}}\n`)
    .replaceAll('{{title}}', title)
    .replaceAll('{{slug}}', slug)
    .replaceAll('{{date}}', today);
  return matter.stringify(body, data);
}
