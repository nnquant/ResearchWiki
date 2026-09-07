import { createElement, type ReactNode } from 'react';
import { queryTokens } from './fuzzy';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split text into plain and highlighted segments for the query's tokens. */
export function highlightParts(text: string, query: string): { text: string; hit: boolean }[] {
  const parts = queryTokens(query).filter(t => t.length >= 2 || /[㐀-鿿]/.test(t));
  if (!parts.length || !text) return [{ text, hit: false }];
  const regex = new RegExp(`(${[...new Set(parts)].sort((a, b) => b.length - a.length).map(escapeRegex).join('|')})`, 'gi');
  const out: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(regex)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ text: text.slice(last, index), hit: false });
    out.push({ text: match[0], hit: true });
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out;
}

export function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  return highlightParts(text, query).map((part, i) => (part.hit ? createElement('mark', { key: i }, part.text) : part.text));
}

/** Compact a chunk to a window around the first hit. */
export function snippetAround(text: string, query: string, radius = 220): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const parts = queryTokens(query).filter(t => t.length >= 2);
  let index = -1;
  const lower = clean.toLowerCase();
  for (const part of parts) {
    index = lower.indexOf(part);
    if (index >= 0) break;
  }
  if (index < 0) return clean.length > radius * 2 ? `${clean.slice(0, radius * 2)}…` : clean;
  const start = Math.max(0, index - radius);
  const end = Math.min(clean.length, index + radius);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`;
}
