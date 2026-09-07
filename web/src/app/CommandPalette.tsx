import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useUi } from './UiContext';
import { useIndex, useSearch, useReindex } from '../api/hooks';
import { pageUrl } from '../api/client';
import { rankPages } from '../lib/fuzzy';
import { Highlight, snippetAround } from '../lib/highlight';
import { typeLabel } from '../lib/types';
import { TypeDot } from './ui';

interface Item {
  id: string;
  section: '操作' | '页面' | '内容匹配' | '深度检索';
  title: string;
  sub?: string;
  snippet?: string;
  type?: string;
  run: () => void;
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function CommandPalette() {
  const { closePalette, paletteInitial, openNewPage, toggleTheme, toast } = useUi();
  const navigate = useNavigate();
  const [query, setQuery] = useState(paletteInitial);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { data: index } = useIndex();
  const reindex = useReindex();
  const debounced = useDebounced(query.trim(), 400);
  const remote = useSearch({ q: debounced, mode: 'fast', limit: 5 }, debounced.length >= 2);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const go = (to: string) => { closePalette(); navigate(to); };

  const items = useMemo<Item[]>(() => {
    const q = query.trim();
    const actions: Item[] = [
      { id: 'a:new', section: '操作', title: '新建页面…', sub: '公司 / 行业 / 宏观 / 事件 / 估值 / 调研纪要', run: () => { closePalette(); openNewPage(); } },
      { id: 'a:import', section: '操作', title: '导入资料', sub: '文件、网页链接、IMA 知识库', run: () => go('/import') },
      { id: 'a:library', section: '操作', title: '打开资料库', run: () => go('/library') },
      { id: 'a:reindex', section: '操作', title: '更新检索索引', run: () => { closePalette(); reindex.mutate(undefined, { onSuccess: () => toast('已加入索引任务'), onError: e => toast(e.message, 'error') }); } },
      { id: 'a:theme', section: '操作', title: '切换深色 / 浅色主题', run: () => { closePalette(); toggleTheme(); } },
      { id: 'a:status', section: '操作', title: '打开状态页', run: () => go('/status') },
    ];
    const lower = q.toLowerCase();
    const matchedActions = q ? actions.filter(a => (a.title + (a.sub ?? '')).toLowerCase().includes(lower) || /^(新建|导入|索引|主题|状态|资料)/.test(q)) : actions;
    const pages: Item[] = rankPages(index ?? [], q, 8).map(({ item }) => ({
      id: `p:${item.slug}`,
      section: '页面',
      title: item.title,
      sub: item.slug,
      type: item.type,
      run: () => go(pageUrl(item.slug)),
    }));
    const content: Item[] = (remote.data?.results ?? []).map(hit => ({
      id: `c:${hit.slug}:${hit.chunk_index}`,
      section: '内容匹配',
      title: hit.title,
      sub: hit.pdf_page ? `${hit.slug} · PDF 第 ${hit.pdf_page} 页` : hit.slug,
      snippet: snippetAround(hit.chunk_text, debounced, 110),
      type: hit.type ?? undefined,
      run: () => go(`${pageUrl(hit.slug)}?find=${encodeURIComponent(hit.chunk_text.replace(/\s+/g, ' ').trim().slice(0, 80))}${hit.pdf_page ? `#pdf-page-${hit.pdf_page}` : ''}`),
    }));
    const deep: Item[] = q.length >= 2 ? [{
      id: 'd:search',
      section: '深度检索',
      title: `深度检索 “${q}”`,
      run: () => go(`/search?q=${encodeURIComponent(q)}&mode=deep`),
    }] : [];
    return q ? [...pages, ...content, ...deep, ...matchedActions] : [...actions, ...pages];
  }, [query, index, remote.data, debounced, closePalette, openNewPage, toggleTheme, reindex, toast]);

  useEffect(() => { setCursor(0); }, [query, items.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(items.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[cursor];
      if (item) item.run();
      else if (query.trim()) go(`/search?q=${encodeURIComponent(query.trim())}`);
    } else if (e.key === 'Escape') { closePalette(); }
  }

  let lastSection = '';
  const searching = debounced.length >= 2 && remote.isFetching;

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) closePalette(); }}>
      <div className="palette" role="dialog" aria-label="命令面板">
        <div className="palette-input">
          <span className="faint">⌕</span>
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKey} placeholder="搜索页面、内容，或输入操作…" aria-label="搜索" />
          {searching && <span className="spinner" />}

        </div>
        <div className="palette-list" ref={listRef}>
          {items.length === 0 && (
            <div className="palette-empty">{index && index.length === 0 ? 'Wiki 还是空的，先导入资料或新建页面。' : '没有匹配的页面。回车进行深度检索。'}</div>
          )}
          {items.map((item, i) => {
            const header = item.section !== lastSection ? item.section : null;
            lastSection = item.section;
            return (
              <div key={item.id}>
                {header && (
                  <div className="palette-section">
                    {header}
                    {header === '内容匹配' && remote.data && <span className="faint" style={{ textTransform: 'none', letterSpacing: 0 }}>{remote.data.latency_ms} ms</span>}
                  </div>
                )}
                <div data-index={i} className={`palette-item ${i === cursor ? 'active' : ''}`} onMouseEnter={() => setCursor(i)} onClick={item.run} role="option" aria-selected={i === cursor}>
                  <span className="icon">{item.type ? <TypeDot type={item.type} /> : item.section === '操作' ? '›' : '⌕'}</span>
                  <div className="body">
                    <div className="title"><Highlight text={item.title} query={query} /></div>
                    {item.sub && <div className="sub">{item.type ? `${typeLabel(item.type)} · ` : ''}{item.sub}</div>}
                    {item.snippet && <div className="snippet"><Highlight text={item.snippet} query={debounced} /></div>}
                  </div>

                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
