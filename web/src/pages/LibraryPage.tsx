import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { usePages } from '../api/hooks';
import { useResearchFacets } from '../app/useResearchFacets';
import { pageUrl } from '../api/client';
import { useCrumbs } from '../app/UiContext';
import { Loading, ErrorBlock, TypeBadge, StatusChip, Empty } from '../app/ui';
import { TYPE_ORDER, STATUS_LABELS, categoryLabel } from '../lib/types';
import { formatDate } from '../lib/format';
import { isEditableTarget } from '../lib/hotkeys';
import { RESEARCH_STAGES } from '../lib/research';
import { useUi } from '../app/UiContext';
import { MultiTagFilter, readTagSelection, writeTagSelection } from '../app/MultiTagFilter';
import { EntityFilter } from '../app/EntityFilter';

const PAGE_SIZE = 50;

export function LibraryPage() {
  const { openNewPage } = useUi();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { types, tags, onTagSearch } = useResearchFacets(Boolean(params.get('entity_id')));
  const [focus, setFocus] = useState(-1);

  const type = params.get('type') ?? '';
  const title = type ? categoryLabel(type) : '资料库';
  useCrumbs(type ? [{ label: '资料库', to: '/library' }, { label: title }] : [{ label: '资料库' }]);
  const tag = params.get('tag') ?? '';
  const entityId = params.get('entity_id') ?? '';
  const tagSelection = readTagSelection(params);
  const tagsKey = JSON.stringify(tagSelection);
  const status = params.get('status') ?? '';
  const stage = params.get('stage') ?? '';
  const due = params.get('due') === 'true';
  const q = params.get('q') ?? '';
  const sort = params.get('sort') ?? 'updated';
  const dir = params.get('dir') ?? 'desc';
  const page = Math.max(1, Number(params.get('page') ?? 1));
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (type) p.set('type', type);
    if (tag) p.set('tag', tag);
    if (entityId) p.set('entity_id', entityId);
    writeTagSelection(p, tagSelection);
    if (status) p.set('status', status);
    if (stage) p.set('stage', stage);
    if (due) p.set('due', 'true');
    if (q) p.set('q', q);
    p.set('sort', sort);
    p.set('dir', dir);
    p.set('limit', String(PAGE_SIZE));
    p.set('offset', String((page - 1) * PAGE_SIZE));
    return p;
  }, [type, tag, tagsKey, status, stage, due, q, sort, dir, page, entityId]);

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

  const orderedTypes = (types ?? []).sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return (
    <div className="content-wide">
      <div className="row" style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 'var(--fs-xl)' }}>{title}</h1>
        <button className="btn sm" onClick={() => openNewPage(type && type !== 'source' ? type : undefined)}>新建研究</button>
        <span className="muted small">{data ? `${data.total} 个页面` : ''}{isFetching && !isLoading ? ' · 刷新中' : ''}</span>
        {data?.degraded && <span className="chip warn">数据库不可用，显示磁盘索引</span>}
      </div>

      <EntityFilter />
      <div className="filters">
        <form onSubmit={e => { e.preventDefault(); update({ q: draft.trim() || null }); }}>
          <input className="input" value={draft} onChange={e => setDraft(e.target.value)} placeholder="标题、代码、别名或地区…" aria-label="筛选" />
        </form>
        <MultiTagFilter tags={tags ?? []} onSearch={onTagSearch} value={tagSelection} onChange={value => { const next = new URLSearchParams(params); writeTagSelection(next, value); next.delete('page'); setParams(next); }} />
        <button className="btn sm" onClick={() => { setDraft(''); setParams(new URLSearchParams()); }}>清除全部筛选</button>
        <select className="select" value={type} onChange={e => update({ type: e.target.value || null })} aria-label="研究分类">
          <option value="">全部研究分类</option>
          {orderedTypes.map(t => <option key={t.type} value={t.type}>{t.label} ({t.n})</option>)}
        </select>
        <select className="select" value={stage} onChange={e => update({ stage: e.target.value || null })} aria-label="研究阶段">
          <option value="">全部研究阶段</option>
          {Object.entries(RESEARCH_STAGES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <label className="row small"><input type="checkbox" checked={due} onChange={e => update({ due: e.target.checked ? 'true' : null })} />仅待复核</label>
        <select className="select" value={status} onChange={e => update({ status: e.target.value || null })} aria-label="状态">
          <option value="">全部状态</option>
          {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
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
                <th><button className={sort === 'type' ? 'active' : ''} onClick={() => toggleSort('type')}>研究分类 {sort === 'type' ? (dir === 'asc' ? '↑' : '↓') : ''}</button></th>
                <th>标签</th>
                <th>状态</th>
                <th>研究阶段 / 复核日</th>
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
                  <td>{(item.category ?? item.type) === 'source' ? <span className="chip">待分类文献</span> : <TypeBadge type={item.category ?? item.type} />}</td>
                  <td><div className="library-tags">{item.tags.map(t => <span key={t} className="chip">{t}</span>)}</div></td>
                  <td><StatusChip status={item.review_status} /></td>
                  <td><span className="small">{RESEARCH_STAGES[String(item.research?.research_stage) as keyof typeof RESEARCH_STAGES] ?? '—'}</span><div className="muted small">{String(item.research?.next_review ?? '')}</div></td>
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
