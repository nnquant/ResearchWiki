import { reportDictionaries, dictionaryKey } from '../report-dictionaries.mjs';

const tagOptionsCache = new WeakMap();
const tagGroup = tag => { const colon = tag.search(/[:：]/); return colon > 0 ? tag.slice(0, colon).trim() : ''; };
const tagValue = tag => { const colon = tag.search(/[:：]/); return colon > 0 ? tag.slice(colon + 1).trim() : tag; };

/** Display names for the 14 naming-rules-v3 topics. */
export const TOPIC_LABELS = {
  Semis: '半导体', 'Tech-Hardware': '科技硬件', Internet: '互联网', Software: '软件', 'Telecom-Media': '电信传媒',
  Macro: '宏观', 'Rates-Credit': '利率信用', FX: '外汇', Energy: '能源', 'Metals-Mining': '金属矿业',
  'Chemicals-Industrials': '化工工业', Financials: '金融', 'Cross-Asset': '跨资产', Other: '其他',
};

let dictionaryIndex;
function dictionaries() {
  if (dictionaryIndex) return dictionaryIndex;
  const institutions = new Map();
  for (const entry of reportDictionaries.institutions ?? []) {
    for (const name of [entry.id, ...(entry.aliases ?? [])]) institutions.set(dictionaryKey(name), entry);
  }
  const sectors = new Map((reportDictionaries.sectors ?? []).map(entry => [entry.id, entry]));
  return dictionaryIndex = { institutions, sectors };
}

/** Chinese display label and search aliases for 机构/主题 facet tags, from the report dictionaries. */
function facetMeta(tag) {
  const group = tagGroup(tag), value = tagValue(tag);
  if (group === '机构') {
    const entry = dictionaries().institutions.get(dictionaryKey(value));
    if (!entry) return {};
    const label = entry.aliases?.find(a => /[一-鿿]/.test(a));
    return { label: label && label !== value ? label : undefined, aliases: [entry.id, ...(entry.aliases ?? [])] };
  }
  if (group === '主题') {
    const label = TOPIC_LABELS[value];
    return { label, aliases: [...(label ? [label] : []), ...(dictionaries().sectors.get(value)?.aliases ?? [])] };
  }
  return {};
}

/**
 * Ranked tag options. `facets` adds index-derived report facets (机构/作者/主题) for the library, matching
 * dictionary aliases too (e.g. 高盛 → 机构:GoldmanSachs). `groups` counts every prefix over the whole
 * index so a filtered query never shrinks the category list.
 */
export function graphTagOptions(index, query = '', { facets = false } = {}) {
  let cached = tagOptionsCache.get(index);
  if (!cached) tagOptionsCache.set(index, cached = {});
  const mode = facets ? 'facets' : 'tags';
  let ranked = cached[mode];
  if (!ranked) {
    const counts = new Map();
    for (const page of index) {
      const tags = facets && page.facet_tags?.length ? [...page.tags, ...page.facet_tags] : page.tags;
      for (const tag of new Set(tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    ranked = [...counts].sort(([a, an], [b, bn]) => bn - an || a.localeCompare(b)).map(([tag, n]) => {
      const meta = facets ? facetMeta(tag) : {};
      return { tag, n, label: meta.label, haystack: [tag, ...(meta.aliases ?? [])].join('\n').toLocaleLowerCase() };
    });
    const groups = new Map();
    for (const { tag } of ranked) { const g = tagGroup(tag); groups.set(g, (groups.get(g) ?? 0) + 1); }
    ranked.groups = [...groups].map(([name, n]) => ({ name, n }));
    cached[mode] = ranked;
  }
  const q = query.trim().toLocaleLowerCase();
  const matching = q ? ranked.filter(item => item.haystack.includes(q)) : ranked;
  return {
    tags: matching.slice(0, 200).map(({ tag, n, label }) => (label ? { tag, n, label } : { tag, n })),
    total: matching.length,
    groups: ranked.groups,
  };
}
