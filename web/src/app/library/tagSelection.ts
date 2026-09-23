import type { TagSelection } from '../MultiTagFilter';

export type TagState = 'include' | 'exclude' | null;
/** How multiple included tags combine. 'mixed' only arises from older URLs carrying both tags_all and tags_any. */
export type IncludeMode = 'all' | 'any' | 'mixed';

export const EMPTY_TAGS: TagSelection = { tags_all: [], tags_any: [], tags_none: [] };

export function includedTags(value: TagSelection) { return [...value.tags_all, ...value.tags_any]; }

export function includeMode(value: TagSelection): IncludeMode {
  if (value.tags_all.length && value.tags_any.length) return 'mixed';
  return value.tags_any.length ? 'any' : 'all';
}

export function tagState(value: TagSelection, tag: string): TagState {
  if (value.tags_none.includes(tag)) return 'exclude';
  return value.tags_all.includes(tag) || value.tags_any.includes(tag) ? 'include' : null;
}

/** Set one tag's state; a tag is never both included and excluded. */
export function setTagState(value: TagSelection, tag: string, state: TagState): TagSelection {
  const next: TagSelection = {
    tags_all: value.tags_all.filter(t => t !== tag),
    tags_any: value.tags_any.filter(t => t !== tag),
    tags_none: value.tags_none.filter(t => t !== tag),
  };
  if (state === 'exclude') next.tags_none.push(tag);
  if (state === 'include') (includeMode(value) === 'any' ? next.tags_any : next.tags_all).push(tag);
  return next;
}

export function setIncludeMode(value: TagSelection, mode: 'all' | 'any'): TagSelection {
  const included = [...new Set(includedTags(value))];
  return { tags_all: mode === 'all' ? included : [], tags_any: mode === 'any' ? included : [], tags_none: value.tags_none };
}

export function countTags(value: TagSelection) { return value.tags_all.length + value.tags_any.length + value.tags_none.length; }

export function splitTag(tag: string) {
  const colon = tag.search(/[:：]/);
  const group = colon > 0 ? tag.slice(0, colon).trim() : '';
  return { group, value: group ? tag.slice(colon + 1).trim() || tag : tag };
}

/** Report-identity facets first, then entity tags; unknown prefixes follow by size. */
const GROUP_ORDER = ['主题', '机构', '作者', '行业', '领域', '公司'];
export function orderGroups<T extends { name: string; n: number }>(groups: T[]): T[] {
  const rank = (name: string) => { const i = GROUP_ORDER.indexOf(name); return i < 0 ? (name ? GROUP_ORDER.length : GROUP_ORDER.length + 1) : i; };
  return [...groups].sort((a, b) => rank(a.name) - rank(b.name) || b.n - a.n);
}
export const groupLabel = (name: string) => name || '其他';
