import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { useTagOptions } from '../../api/hooks';
import { splitTag } from './tagSelection';
import { ExcludeIcon } from './icons';
import { ENTITY_TYPE_LABELS, entityStatusLabel, useEntityResolve, type EntityCandidate } from './useEntityResolve';

type Suggestion =
  | { kind: 'text' }
  | { kind: 'entity'; entity: EntityCandidate }
  | { kind: 'tag'; tag: string; n: number; label?: string };

interface Props {
  q: string;
  onSearch: (q: string | null) => void;
  onPickEntity: (entity: EntityCandidate) => void;
  onAddTag: (tag: string, state: 'include' | 'exclude') => void;
}

export interface LibrarySearchBoxHandle { focus: () => void }

/**
 * One search box for full-text, entity and tag. Enter runs full-text search; entities and tags only apply when
 * explicitly picked, so an ambiguous name is never silently resolved.
 */
export const LibrarySearchBox = forwardRef<LibrarySearchBoxHandle, Props>(function LibrarySearchBox({ q, onSearch, onPickEntity, onAddTag }, ref) {
  const [draft, setDraft] = useState(q);
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useImperativeHandle(ref, () => ({ focus: () => { input.current?.focus(); input.current?.select(); } }), []);

  useEffect(() => setDraft(q), [q]);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(draft.trim()), 250);
    return () => clearTimeout(timer);
  }, [draft]);

  const suggesting = open && Boolean(term);
  const entities = useEntityResolve(term, { limit: 6, enabled: suggesting });
  const tags = useTagOptions(term, suggesting);
  const entityRows = suggesting ? entities.data?.results ?? [] : [];
  const tagRows = suggesting ? (tags.data?.tags ?? []).slice(0, 8) : [];
  const items: Suggestion[] = draft.trim() ? [
    { kind: 'text' },
    ...entityRows.map(entity => ({ kind: 'entity' as const, entity })),
    ...tagRows.map(t => ({ kind: 'tag' as const, tag: t.tag, n: t.n, label: t.label })),
  ] : [];
  const showPanel = open && items.length > 0;
  useEffect(() => setActive(0), [term]);

  const finish = () => { setOpen(false); setActive(0); };
  const pick = (item: Suggestion, tagState: 'include' | 'exclude' = 'include') => {
    if (item.kind === 'text') onSearch(draft.trim() || null);
    else { setDraft(q); if (item.kind === 'entity') onPickEntity(item.entity); else onAddTag(item.tag, tagState); }
    finish();
  };
  const clear = () => { setDraft(''); onSearch(null); finish(); input.current?.focus(); };
  const optionId = (i: number) => `${id}-opt-${i}`;
  const pending = suggesting && (entities.isFetching || tags.isFetching);

  let index = 0;
  const option = (item: Suggestion, body: ReactNode, extra?: ReactNode) => {
    const i = index++;
    return (
      <li key={i} id={optionId(i)} role="option" aria-selected={active === i} className="omnibox-option"
        onPointerEnter={() => setActive(i)}
        onPointerDown={event => event.preventDefault()}
        onClick={() => pick(item)}>
        {body}{extra}
      </li>
    );
  };

  return (
    <div className="omnibox" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) finish(); }}>
      <form className="omnibox-field" role="search" onSubmit={event => { event.preventDefault(); pick(items[active] ?? { kind: 'text' }); }}>
        <span className="omnibox-icon" aria-hidden="true">⌕</span>
        <input ref={input} value={draft} placeholder="搜索标题、正文、代码等，输入公司名可匹配实体"
          role="combobox" aria-label="搜索资料库" aria-autocomplete="list" aria-expanded={showPanel}
          aria-controls={showPanel ? `${id}-list` : undefined} aria-activedescendant={showPanel ? optionId(active) : undefined}
          onChange={event => { setDraft(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' && items.length) { event.preventDefault(); setOpen(true); setActive(a => (a + 1) % items.length); }
            else if (event.key === 'ArrowUp' && items.length) { event.preventDefault(); setActive(a => (a - 1 + items.length) % items.length); }
            else if (event.key === 'Escape') {
              event.preventDefault(); event.stopPropagation();
              if (showPanel) finish(); else if (draft || q) clear(); else input.current?.blur();
            }
          }} />
        {pending && <span className="omnibox-pending" aria-live="polite">匹配中…</span>}
        {(draft || q) && <button type="button" className="omnibox-clear" aria-label="清除搜索" title="清除搜索（Esc）" onClick={clear}>×</button>}
        {!draft && !q && <kbd className="key omnibox-kbd" title="按 f 聚焦搜索">f</kbd>}
      </form>
      {showPanel && (
        <ul className="omnibox-panel" id={`${id}-list`} role="listbox" aria-label="搜索建议">
          {option({ kind: 'text' }, <><span className="omnibox-option-main">全文搜索 “{draft.trim()}”</span><span className="omnibox-hint">↵</span></>)}
          {entityRows.length > 0 && <li className="omnibox-group" role="presentation">实体{entities.data?.ambiguous ? ' · 多个候选，请选择具体对象' : ''}</li>}
          {entityRows.map(entity => option({ kind: 'entity', entity },
            <>
              <span className="omnibox-option-main">{entity.name}</span>
              <span className="omnibox-option-meta">{ENTITY_TYPE_LABELS[entity.entity_type] ?? entity.entity_type} · {entity.document_count.toLocaleString()} 份材料 · {entityStatusLabel(entity)}</span>
            </>))}
          {tagRows.length > 0 && <li className="omnibox-group" role="presentation">标签 · 机构 · 作者 · 主题</li>}
          {tagRows.map(t => { const { group, value } = splitTag(t.tag); return option({ kind: 'tag', tag: t.tag, n: t.n, label: t.label },
            <>
              {group && <span className="omnibox-kind">{group}</span>}
              <span className="omnibox-option-main" title={t.tag}>{t.label ?? value}</span>
              <span className="omnibox-option-meta">{t.label ? `${value} · ` : ''}{t.n.toLocaleString()} 篇</span>
            </>,
            <button type="button" className="omnibox-exclude" tabIndex={-1} title="排除此标签" aria-label={`排除 ${t.tag}`}
              onClick={event => { event.stopPropagation(); pick({ kind: 'tag', tag: t.tag, n: t.n }, 'exclude'); }}><ExcludeIcon /></button>); })}
        </ul>
      )}
    </div>
  );
});
