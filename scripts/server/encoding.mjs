/** Honor explicit exclusions (br;q=0), wildcard preferences and identity. */
export function preferredEncoding(header = '', available = ['br', 'gzip']) {
  const weights = new Map(String(header).toLowerCase().split(',').map(part => {
    const [name, ...params] = part.trim().split(';');
    const q = params.find(p => p.trim().startsWith('q='));
    return [name, q ? Number(q.trim().slice(2)) : 1];
  }));
  return available.map(name => [name, weights.get(name) ?? weights.get('*') ?? 0])
    .filter(([, q]) => Number.isFinite(q) && q > 0 && q <= 1)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
