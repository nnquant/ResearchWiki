export const ENTITY_VERSION = 'article-entities-v1';
export const ENTITY_FIELDS = ['companies', 'industries', 'subfields'];
const prefixes = { companies: '公司', industries: '行业', subfields: '领域' };

export function entityTags(fields = {}) {
  return ENTITY_FIELDS.flatMap(key => Array.isArray(fields[key])
    ? fields[key].filter(x => typeof x === 'string' && x.trim()).map(x => `${prefixes[key]}:${x.trim()}`) : []);
}

/**
 * Report identity fields (naming rules v3) exposed as filterable facets. Derived at index time only;
 * never written back into frontmatter `tags`.
 */
const FACET_PREFIXES = { institutions: '机构', authors: '作者', topic_primary: '主题' };
export function facetTags(fields = {}) {
  return [...new Set(Object.entries(FACET_PREFIXES).flatMap(([key, prefix]) => {
    const value = fields[key];
    const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    return values.filter(x => typeof x === 'string' && x.trim()).map(x => `${prefix}:${x.trim()}`);
  }))];
}

/** Replace tags generated from the previous entity lists, preserving other tags. */
export function withEntityTags(fields, previous = {}) {
  const previousTags = new Set(entityTags(previous));
  return { ...fields, tags: [...new Set([
    ...(Array.isArray(fields.tags) ? fields.tags : []).filter(t => !previousTags.has(t)),
    ...entityTags(fields),
  ])] };
}

export function needsEntityBackfill(record) {
  return record.llm?.status === 'complete' && record.llm?.entity_version !== ENTITY_VERSION;
}
