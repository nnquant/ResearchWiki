import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { IndexEntry } from '../api/types';
import { rankPages } from '../lib/fuzzy';
import { slugBasename } from '../lib/slug';

/** Autocomplete `[[` with page titles; inserts `[[slug|title]]` (or `[[slug]]` when the title equals the slug tail). */
export function wikilinkCompletion(getIndex: () => IndexEntry[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/\[\[([^\]\n]*)$/);
    if (!match) return null;
    const typed = match.text.slice(2);
    const index = getIndex();
    const ranked = typed ? rankPages(index, typed, 12).map(r => r.item) : index.slice(0, 12);
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
