import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { PageList } from '../api/types';
import { api } from '../api/client';
import { slugBasename } from '../lib/slug';

/** Autocomplete `[[` with page titles; inserts `[[slug|title]]` (or `[[slug]]` when the title equals the slug tail). */
export function wikilinkCompletion() {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const match = context.matchBefore(/\[\[([^\]\n]*)$/);
    if (!match) return null;
    const typed = match.text.slice(2);
    const controller = new AbortController();
    context.addEventListener('abort', () => controller.abort(), { onDocChange: true });
    const result = await api<PageList>(`/api/pages?${new URLSearchParams({ q: typed, limit: '12', lookup: 'true' })}`, { signal: controller.signal }).catch(() => null);
    if (!result || context.aborted) return null;
    const ranked = result.items;
    const closing = context.state.sliceDoc(context.pos, context.pos + 2) === ']]' ? '' : ']]';
    return {
      from: match.from,
      filter: false,
      options: ranked.map(item => ({
        label: item.title,
        detail: item.slug,
        type: 'text',
        apply: item.title === slugBasename(item.slug) ? `[[${item.slug}${closing}` : `[[${item.slug}|${item.title}${closing}`,
      })),
    };
  };
}
