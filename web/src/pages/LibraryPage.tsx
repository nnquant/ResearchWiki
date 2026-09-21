import { MultiTagFilter, readTagSelection, writeTagSelection } from '../app/MultiTagFilter';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { usePages, useTypes, useGraphTags } from '../api/hooks';
import { pageUrl } from '../api/client';
import { useCrumbs } from '../app/UiContext';
import { Loading, ErrorBlock, TypeBadge, StatusChip, Empty } from '../app/ui';
import { TYPE_ORDER, STATUS_LABELS, typeLabel } from '../lib/types';
import { formatDate } from '../lib/format';
import { isEditableTarget } from '../lib/hotkeys';

const PAGE_SIZE = 50;

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: types } = useTypes();
  const [tagQuery, setTagQuery] = useState('');
  const { data: tagOptions } = useGraphTags(tagQuery);
  const tags = tagOptions?.tags;
  const [focus, setFocus] = useState(-1);

  const type = params.get('type') ?? '';
  const title = type ? typeLabel(type) : '资料库';
  useCrumbs(type ? [{ label: '资料库', to: '/library' }, { label: title }] : [{ label: '资料库' }]);
  const selectedTags = readTagSelection(params);
  const tag = JSON.stringify(selectedTags);
  const status = params.get('status') ?? '';
  const q = params.get('q') ?? '';
  const sort = params.get('sort') ?? 'updated';
  const dir = params.get('dir') ?? 'desc';
  const page = Math.max(1, Number(params.get('page') ?? 1));
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (type) p.set('type', type);
    writeTagSelection(p, JSON.parse(tag));
    if (status) p.set('status', status);
    if (q) p.set('q', q);
    p.set('sort', sort);
    p.set('dir', dir);
    p.set('limit', String(PAGE_SIZE));
    p.set('offset', String((page - 1) * PAGE_SIZE));
    return p;
  }, [type, tag, status, q, sort, dir, page]);

  const { data, isLoading, error, isFetching } = usePages(query);
  const items = data?.items ?? [];

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };

  const toggleSort = (key: string) => {
    if (sort === key) update({ dir: dir === 'asc' ? 'desc' : 'asc' });
    else update({ sort: key, dir: key === 'title' || key === 'type' ? 'asc' : 'desc' });
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isEditableTarget(e.target) || e.ctrlKey || e.metaKey) return;
      if (e.key === 'j') setFocus(f => Math.min(items.length - 1, f + 1));
      else if (e.key === 'k') setFocus(f => Math.max(0, f - 1));
      else if (e.key === 'Enter' && focus >= 0 && items[focus]) navigate(pageUrl(items[focus].slug));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, focus, navigate]);

  useEffect(() => { setFocus(-1); }, [query]);

  const orderedTypes = (types ?? []).filter(t => t.n > 0).sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return (
    <div className="content-wide">
      <div className="row" style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 'var(--fs-xl)' }}>{title}</h1>
        <span className="muted small">{data ? `${data.total} 个页面` : ''}{isFetching && !isLoading ? ' · 刷新中' : ''}</span>
        {data?.degraded && <span className="chip warn">数据库不可用，显示磁盘索引</span>}
      </div>

      <div className="filters">
        <form onSubmit={e => { e.preventDefault(); update({ q: draft.trim() || null }); }}>
          <input className="input" value={draft} onChange={e => setDraft(e.target.value)} placeholder="按标题或 slug 筛选…" aria-label="筛选" />
        </form>
        <select className="select" value={type} onChange={e => update({ type: e.target.value || null })} aria-label="类型">
          <option value="">全部类型</option>
          {orderedTypes.map(t => <option key={t.type} value={t.type}>{t.label} ({t.n})</option>)}
        </select>
        <select className="select" value={status} onChange={e => update({ status: e.target.value || null })} aria-label="状态">
          <option value="">全部状态</option>
          {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <MultiTagFilter onSearch={setTagQuery} tags={tags ?? []} value={selectedTags} onChange={value => { const next = new URLSearchParams(params); writeTagSelection(next, value); next.delete('page'); setParams(next); }} />
        {(type || Object.values(selectedTags).some(v => v.length) || status || q) && <button className="btn ghost sm" onClick={() => setParams(new URLSearchParams())}>清除筛选</button>}
      </div>

      {isLoading && <Loading />}
      {error && <ErrorBlock error={error} title="加载失败" />}
      {data && items.length === 0 && (
        <Empty title="没有匹配的页面">
          <p>调整筛选条件，或 <Link to="/import">导入资料</Link>。</p>
        </Empty>
      )}
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th><button className={sort === 'title' ? 'active' : ''} onClick={() => toggleSort('title')}>标题 {sort === 'title' ? (dir === 'asc' ? '↑' : '↓') : ''}</button></th>
                <th><button className={sort === 'type' ? 'active' : ''} onClick={() => toggleSort('type')}>类型 {sort === 'type' ? (dir === 'asc' ? '↑' : '↓') : ''}</button></th>
                <th>标签</th>
                <th>状态</th>
                <th><button className={sort === 'updated' ? 'active' : ''} onClick={() => toggleSort('updated')}>更新 {sort === 'updated' ? (dir === 'asc' ? '↑' : '↓') : ''}</button></th>
                <th style={{ textAlign: 'right' }}>反链</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.slug} className={i === focus ? 'focused' : ''} onClick={() => navigate(pageUrl(item.slug))}>
                  <td className="title">
                    <Link to={pageUrl(item.slug)} onClick={e => e.stopPropagation()}>{item.title}</Link>
                    {item.excerpt && <span className="article-excerpt" title={item.excerpt}>{item.excerpt}</span>}
                  </td>
                  <td><TypeBadge type={item.type} /></td>
                  <td>{item.tags.slice(0, 6).map(t => <span key={t} className="chip" style={{ marginRight: 4 }}>{t}</span>)}{item.tags.length > 6 && <span className="muted" title={item.tags.slice(6).join("、")}>+{item.tags.length - 6}</span>}</td>
                  <td><StatusChip status={item.review_status} /></td>
                  <td className="date">{formatDate(item.updated_at)}</td>
                  <td className="num">{item.backlinks ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && totalPages > 1 && (
        <div className="pager">
          <button className="btn sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>上一页</button>
          <span>第 {page} / {totalPages} 页</span>
          <button className="btn sm" disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })}>下一页</button>
        </div>
      )}
    </div>
  );
}
