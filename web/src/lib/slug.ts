const WORD = '\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}\\p{N}';
const KEEP_RE = new RegExp(`[^${WORD}.\\s_\\-]`, 'gu');

/** Mirror of the server's normalizeSegment (which mirrors gbrain's slugifySegment). */
export function normalizeSegment(segment: string): string {
  return segment
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[֑-ׇ]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(KEEP_RE, '')
    .replace(/[\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeSlug(input: string): string {
  return input
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\.mdx?$/i, '')
    .split('/')
    .map(normalizeSegment)
    .filter(Boolean)
    .join('/');
}

export function slugBasename(slug: string): string {
  const parts = slug.split('/');
  return parts[parts.length - 1] ?? slug;
}

export function slugDir(slug: string): string | null {
  return slug.includes('/') ? slug.split('/')[0] : null;
}
