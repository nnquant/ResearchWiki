const tagOptionsCache = new WeakMap();
export function graphTagOptions(index, query = '') {
  let ranked = tagOptionsCache.get(index);
  if (!ranked) {
    const counts = new Map();
    for (const page of index) for (const tag of new Set(page.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    ranked = [...counts].sort(([a, an], [b, bn]) => bn - an || a.localeCompare(b));
    tagOptionsCache.set(index, ranked);
  }
  const q = query.trim().toLocaleLowerCase();
  const matching = q ? ranked.filter(([tag]) => tag.toLocaleLowerCase().includes(q)) : ranked;
  return { tags: matching.slice(0, 200).map(([tag, n]) => ({ tag, n })), total: matching.length };
}
