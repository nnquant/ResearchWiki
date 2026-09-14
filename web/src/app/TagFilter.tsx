import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { TagCount } from '../api/types';

interface Props {
  tags: TagCount[];
  value: string;
  onChange: (tag: string | null) => void;
  canClear: boolean;
  onClear: () => void;
}

export function TagFilter({ tags, value, onChange, canClear, onClear }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const groups = useMemo(() => {
    const grouped = new Map<string, { tag: string; label: string; n: number }[]>([['', []]]);
    for (const item of tags) {
      const colon = item.tag.search(/[:：]/);
      const category = colon > 0 ? item.tag.slice(0, colon).trim() : '';
      const label = category ? item.tag.slice(colon + 1).trim() || item.tag : item.tag;
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category)!.push({ ...item, label });
    }
    return [...grouped].filter(([, items]) => items.length > 0);
  }, [tags]);
  const visibleGroups = groups.map(([name, items]) => [name, items.filter(item =>
    search.trim() ? item.tag.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) : name === category,
  )] as const).filter(([, items]) => items.length > 0);

  useEffect(() => {
    if (!open) return;
    searchInput.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  const close = () => { setOpen(false); trigger.current?.focus(); };

  return (
    <div className="tag-filter" ref={root} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} onKeyDown={event => {
      // Keep the library's j/k/Enter navigation out of the picker.
      event.stopPropagation();
      if (event.key === 'Escape' && open) { event.preventDefault(); close(); }
    }}>
      <div className={`tag-filter-field ${open ? 'is-open' : ''}`}>
        <button type="button" className="tag-filter-trigger" ref={trigger}
          aria-label={value ? `标签筛选：${value}` : '选择分类与标签'}
          aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined}
          onClick={() => {
            setSearch('');
            const colon = value.search(/[:：]/);
            setCategory(colon > 0 ? value.slice(0, colon).trim() : '');
            setOpen(!open);
          }}>
          {value ? <span className="chip tag-filter-value">{value}</span> : <span className="tag-filter-placeholder">选择分类与标签…</span>}
        </button>
        <button type="button" className="tag-filter-clear" disabled={!canClear}
          title="清除所有筛选条件" aria-label="清除筛选"
          onClick={() => { onClear(); setSearch(''); close(); }}>清除</button>
      </div>
      {open && (
        <div className="tag-filter-panel" id={id} role="dialog" aria-label="分类与标签筛选">
          <div className="tag-filter-search">
            <input ref={searchInput} className="input" value={search} onChange={event => setSearch(event.target.value)}
              placeholder="搜索分类或标签…" aria-label="搜索分类或标签" />
          </div>
          <div className="tag-filter-categories" aria-label="标签类别">
            {groups.map(([name, items]) => (
              <button type="button" key={name} aria-pressed={!search.trim() && category === name}
                onClick={() => { setCategory(name); setSearch(''); }}>
                {name || '全部'} <span>{items.length}</span>
              </button>
            ))}
          </div>
          <div className="tag-filter-groups">
            {visibleGroups.map(([category, items]) => (
              <section className="tag-filter-group" key={category} aria-label={category || '全部'}>
                <h3>{category || '全部'} <span>{items.length}</span></h3>
                <div className="tag-filter-options">
                  {items.map(item => (
                    <button type="button" key={item.tag} className="chip tag-filter-option"
                      aria-pressed={value === item.tag} title={item.tag}
                      onClick={() => { onChange(value === item.tag ? null : item.tag); close(); }}>
                      {value === item.tag && <span aria-hidden="true">✓</span>}
                      {item.label}<span className="tag-filter-count">{item.n}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {visibleGroups.length === 0 && <p className="muted small">{search ? '没有匹配的标签' : '暂无可选标签'}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
