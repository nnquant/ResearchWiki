import { useMemo, useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router';
import { useGraphNavigation } from '../api/hooks';
import { pageUrl } from '../api/client';
import { TYPE_META, TYPE_ORDER, typeColor, typeLabel } from '../lib/types';
import type { IndexEntry } from '../api/types';

const SHOW = 8;

function readOpen(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem('wiki.tree') ?? '{}') as Record<string, boolean>; }
  catch { return {}; }
}

/** Type-grouped page tree: each group shows its most recent pages with a link to the filtered library. */
export function PageTree() {
  const { data: navigation } = useGraphNavigation(true);
  const index = navigation?.items;
  const location = useLocation();
  const [open, setOpen] = useState<Record<string, boolean>>(readOpen);

  const groups = useMemo(() => {
    const map = new Map<string, IndexEntry[]>();
    for (const item of index ?? []) {
      const list = map.get(item.type) ?? [];
      list.push(item);
      map.set(item.type, list);
    }
    const order = [...TYPE_ORDER, ...[...map.keys()].filter(t => !TYPE_ORDER.includes(t))];
    return order
      .filter(type => map.has(type) || type === 'source')
      .map(type => ({
        type,
        items: (map.get(type) ?? []).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))),
      }));
  }, [index]);

  const toggle = (type: string) => {
    const next = { ...open, [type]: !(open[type] ?? defaultOpen(type)) };
    setOpen(next);
    try { localStorage.setItem('wiki.tree', JSON.stringify(next)); } catch { /* ignore */ }
  };

  return (
    <div>
      {groups.map(group => {
        const isOpen = open[group.type] ?? defaultOpen(group.type);
        const meta = TYPE_META[group.type];
        const selected = location.pathname === '/library' && new URLSearchParams(location.search).get('type') === group.type;
        return (
          <div key={group.type} className="tree-group" data-open={isOpen} style={{ ['--tree-color' as string]: typeColor(group.type) }}>
            <div className={`tree-head ${selected ? 'active' : ''}`}>
              <button className="tree-toggle" onClick={() => toggle(group.type)} aria-label={`${isOpen ? '收起' : '展开'}${typeLabel(group.type)}`} aria-expanded={isOpen}>
                <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m9 5 7 7-7 7" />
                </svg>
              </button>
              <Link className="tree-category" to={`/library?type=${encodeURIComponent(group.type)}`} aria-current={selected ? 'page' : undefined}>
                <span className="label">{typeLabel(group.type)}</span>
                <span className="count">{navigation?.counts[group.type] ?? group.items.length}</span>
              </Link>
            </div>
            {isOpen && (
              <ul className="tree-items">
                {group.items.slice(0, SHOW).map(item => (
                  <li key={item.slug}>
                    <NavLink to={pageUrl(item.slug)} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title={item.title}>
                      <span className="label">{item.title}</span>
                    </NavLink>
                  </li>
                ))}
                {(navigation?.counts[group.type] ?? group.items.length) > SHOW && (
                  <li><Link className="tree-more" to={`/library?type=${group.type}`}>查看全部 {navigation?.counts[group.type] ?? group.items.length} 条 →</Link></li>
                )}
                {group.items.length === 0 && (
                  <li className="tree-empty">{meta?.dir ? `还没有${typeLabel(group.type)}页面` : '空'}</li>
                )}
              </ul>
            )}
          </div>
        );
      })}
      {index && index.length === 0 && <div className="tree-empty" style={{ padding: 8 }}>Wiki 还是空的。{location.pathname !== '/import' && <Link to="/import">导入资料</Link>}</div>}
    </div>
  );
}

function defaultOpen(type: string): boolean {
  return type === 'source';
}
