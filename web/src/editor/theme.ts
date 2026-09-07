import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/** Editor chrome driven by the design tokens so it follows the dark/light theme. */
export function editorTheme(dark: boolean) {
  const base = EditorView.theme({
    '&': { backgroundColor: 'var(--bg)', color: 'var(--text)', height: '100%' },
    '.cm-content': { padding: '20px 0', caretColor: 'var(--accent)', maxWidth: '900px', margin: '0 auto' },
    '.cm-scroller': { overflow: 'auto', padding: '0 24px' },
    '.cm-line': { padding: '0 4px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-activeLine': { backgroundColor: 'var(--surface)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(110,168,255,0.25) !important' },
    '.cm-cursor': { borderLeftColor: 'var(--accent)' },
    '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--faint)', border: 'none' },
    '.cm-tooltip': { backgroundColor: 'var(--bg-elev)', border: '1px solid var(--border-strong)', color: 'var(--text)', borderRadius: '6px' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '3px 8px' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--surface-3)', color: 'var(--text)' },
    '.cm-completionDetail': { color: 'var(--faint)', fontStyle: 'normal', marginLeft: '8px' },
    '.cm-panels': { backgroundColor: 'var(--bg-elev)', color: 'var(--text)', borderColor: 'var(--border)' },
    '.cm-panel input, .cm-panel button': { backgroundColor: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: '4px' },
    '.cm-searchMatch': { backgroundColor: 'var(--mark)' },
    '.cm-lintRange-error': { backgroundImage: 'none', borderBottom: '1px dotted var(--danger)' },
    '.cm-lintRange-warning': { backgroundImage: 'none', borderBottom: '1px dotted var(--warn)' },
    '.cm-diagnostic': { borderLeftColor: 'var(--warn)' },
  }, { dark });

  const highlight = HighlightStyle.define([
    { tag: tags.heading1, fontWeight: '600', fontSize: '1.25em', color: 'var(--text)' },
    { tag: tags.heading2, fontWeight: '600', fontSize: '1.12em', color: 'var(--text)' },
    { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontWeight: '600', color: 'var(--text)' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strong, fontWeight: '600' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: tags.link, color: 'var(--accent)' },
    { tag: tags.url, color: 'var(--muted)' },
    { tag: tags.monospace, color: 'var(--t-factor)' },
    { tag: tags.quote, color: 'var(--muted)' },
    { tag: tags.list, color: 'var(--accent)' },
    { tag: tags.contentSeparator, color: 'var(--faint)' },
    { tag: tags.processingInstruction, color: 'var(--faint)' },
    { tag: tags.labelName, color: 'var(--t-claim)' },
    { tag: tags.comment, color: 'var(--faint)' },
    { tag: tags.meta, color: 'var(--faint)' },
    { tag: tags.string, color: 'var(--t-report)' },
    { tag: tags.keyword, color: 'var(--t-hypothesis)' },
  ]);

  return [base, syntaxHighlighting(highlight)];
}
