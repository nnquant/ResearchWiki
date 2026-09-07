import type { IndexEntry } from '../api/types';

const CJK = /[㐀-鿿豈-﫿]/;

function tokens(query: string): string[] {
  const out: string[] = [];
  for (const part of query.toLowerCase().split(/[\s/,，。、:：;；()（）\[\]【】|]+/)) {
    if (!part) continue;
    if (CJK.test(part)) {
      if (part.length === 1) out.push(part);
      for (let i = 0; i + 2 <= part.length; i++) out.push(part.slice(i, i + 2));
    } else {
      out.push(part);
    }
  }
  return out;
}

function scoreText(text: string, query: string, parts: string[]): number {
  const lower = text.toLowerCase();
  if (!lower) return 0;
  if (lower === query) return 100;
  let score = 0;
  const index = lower.indexOf(query);
  if (index >= 0) score += 60 - Math.min(index, 30);
  let matched = 0;
  for (const part of parts) {
    if (lower.includes(part)) matched++;
  }
  if (parts.length) score += (matched / parts.length) * 40;
  return score;
}

export interface Scored<T> {
  item: T;
  score: number;
}

/** Rank pages by title/slug/alias similarity to a query. Cheap enough for a few thousand entries per keystroke. */
export function rankPages(entries: IndexEntry[], rawQuery: string, limit = 8): Scored<IndexEntry>[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];
  const parts = tokens(query);
  const scored: Scored<IndexEntry>[] = [];
  for (const item of entries) {
    let score = scoreText(item.title, query, parts) * 1.0;
    score = Math.max(score, scoreText(item.slug, query, parts) * 0.9);
    for (const alias of item.aliases) score = Math.max(score, scoreText(alias, query, parts) * 0.95);
    for (const tag of item.tags) if (tag.toLowerCase() === query) score = Math.max(score, 70);
    if (score >= 25) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
  return scored.slice(0, limit);
}

export { tokens as queryTokens };
