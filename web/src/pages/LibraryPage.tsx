import { useEffect, useMemo, useRef, useState } from 'react';
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
import { readTagSelection, writeTagSelection, type TagSelection } from '../app/MultiTagFilter';
import { FilterPopover, OptionMenu } from '../app/library/FilterPopover';
import { TagPanel } from '../app/library/TagPanel';
import { LibrarySearchBox, type LibrarySearchBoxHandle } from '../app/library/LibrarySearchBox';
import { ActiveFilterBar, type ActiveFilter } from '../app/library/ActiveFilterBar';
import { countTags, includeMode, includedTags, setTagState, splitTag } from '../app/library/tagSelection';

const PAGE_SIZE = 50;

/** URL keys that are filters; sort/dir are view preferences and survive "清除全部". */
const FILTER_KEYS = ['type', 'tag', 'tags_all', 'tags_any', 'tags_none', 'entity_id', 'entity_label', 'status', 'stage', 'due', 'q', 'page', 'cursor'];

const SORT_OPTIONS = [
  { value: 'updated:desc', label: '最近更新' },
  { value: 'updated:asc', label: '最早更新' },
  { value: 'created:desc', label: '最近创建' },
  { value: 'title:asc', label: '标题 A→Z' },
  { value: 'title:desc', label: '标题 Z→A' },
  { value: 'type:asc', label: '按研究分类' },
];

export function LibraryPage() {
  const { openNewPage } = useUi();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { types } = useResearchFacets(Boolean(params.get('entity_id')));
  const [focus, setFocus] = useState(-1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const searchBox = useRef<LibrarySearchBoxHandle>(null);

  const type = params.get('type') ?? '';
  const title = type ? categoryLabel(type) : '资料库';
  useCrumbs(type ? [{ label: '资料库', to: '/library' }, { label: title }] : [{ label: '资料库' }]);
  const tag = params.get('tag') ?? '';
  const entityId = params.get('entity_id') ?? '';
  const entityLabel = params.get('entity_label') ?? entityId;
  const tagSelection = readTagSelection(params);
  const tagsKey = JSON.stringify(tagSelection);
  const status = params.get('status') ?? '';
  const stage = params.get('stage') ?? '';
  const due = params.get('due') === 'true';
  const q = params.get('q') ?? '';
  const sort = params.get('sort') ?? 'updated';
  const dir = params.get('dir') ?? 'desc';
  const page = Math.max(1, Number(params.get('page') ?? 1));

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
  const setTags = (value: TagSelection) => {
    const next = new URLSearchParams(params);
    writeTagSelection(next, value);
    next.delete('page');
    setParams(next);
  };
  const clearAll = () => {
    const next = new URLSearchParams(params);
    FILTER_KEYS.forEach(key => next.delete(key));
    setParams(next);
  };

  const toggleSort = (key: string) => {
    if (sort === key) update({ dir: dir === 'asc' ? 'desc' : 'asc' });
    else update({ sort: key, dir: key === 'title' || key === 'type' ? 'asc' : 'desc' });
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isEditableTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'f') { e.preventDefault(); searchBox.current?.focus(); }
      else if (e.key === 'j') setFocus(f => Math.min(items.length - 1, f + 1));
      else if (e.key === 'k') setFocus(f => Math.max(0, f - 1));
      else if (e.key === 'Enter' && focus >= 0 && items[focus]) navigate(pageUrl(items[focus].slug));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, focus, navigate]);

  useEffect(() => { setFocus(-1); }, [query]);

  const orderedTypes = (types ?? []).sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const stageLabel = (RESEARCH_STAGES as Record<string, string>)[stage] ?? stage;
  const statusLabel = STATUS_LABELS[status] ?? status;
  const sortValue = `${sort}:${dir}`;
  const sortOptions = SORT_OPTIONS.some(o => o.value === sortValue)
    ? SORT_OPTIONS : [...SORT_OPTIONS, { value: sortValue, label: `${sort} ${dir === 'asc' ? '↑' : '↓'}` }];

  const tagMode = includeMode(tagSelection);
  const included = includedTags(tagSelection);
  const tagCount = countTags(tagSelection);
  const tagSummary = tagCount === 0 ? undefined
    : tagCount > 1 ? `${tagCount} 个`
    : included[0] ?? `排除 ${tagSelection.tags_none[0]}`;
  const includeKind = (t: string) => {
    const kind = splitTag(t).group || '标签';
    if (tagMode === 'mixed') return `${kind}（${tagSelection.tags_any.includes(t) ? '任一' : '同时'}）`;
    return tagMode === 'any' && included.length > 1 ? `${kind}（任一）` : kind;
  };
  const removeTag = (t: string) => setTags(setTagState(tagSelection, t, null));
  const active: ActiveFilter[] = [
    ...(entityId ? [{ key: 'entity', kind: '实体', value: entityLabel, onRemove: () => update({ entity_id: null, entity_label: null, cursor: null }) }] : []),
    ...(q ? [{ key: 'q', kind: '搜索', value: q, onRemove: () => update({ q: null }) }] : []),
    ...(type ? [{ key: 'type', kind: '分类', value: categoryLabel(type), onRemove: () => update({ type: null }) }] : []),
    ...included.map(t => ({ key: `inc:${t}`, kind: includeKind(t), value: splitTag(t).value, onRemove: () => removeTag(t) })),
    ...tagSelection.tags_none.map(t => ({ key: `exc:${t}`, kind: `排除${splitTag(t).group ? ` ${splitTag(t).group}` : ''}`, value: splitTag(t).value, tone: 'exclude' as const, onRemove: () => removeTag(t) })),
    ...(stage ? [{ key: 'stage', kind: '研究阶段', value: stageLabel, onRemove: () => update({ stage: null }) }] : []),
    ...(status ? [{ key: 'status', kind: '审核状态', value: statusLabel, onRemove: () => update({ status: null }) }] : []),
    ...(due ? [{ key: 'due', kind: '复核', value: '仅待复核', onRemove: () => update({ due: null }) }] : []),
  ];
  const dimensionCount = [type, tagCount, stage, status, due].filter(Boolean).length;

  return (
    <div className="content-wide">
      <div className="library-head">
        <h1>{title}</h1>
        <span className="muted small">
          {data && !active.length ? `${data.total.toLocaleString()} 个页面` : ''}
          {isFetching && !isLoading ? ' 刷新中…' : ''}
        </span>
        {data?.degraded && <span className="chip warn">数据库不可用，显示磁盘索引</span>}
        <button className="btn sm primary library-new" onClick={() => openNewPage(type && type !== 'source' ? type : undefined)}>+ 新建研究</button>
      </div>

      <div className={`library-toolbar${filtersOpen ? ' filters-open' : ''}`}>
        <div className="library-search-row">
          <LibrarySearchBox ref={searchBox} q={q}
            onSearch={value => update({ q: value })}
            onPickEntity={entity => update({ entity_id: entity.entity_id, entity_label: entity.name, cursor: null })}
            onAddTag={(t, state) => setTags(setTagState(tagSelection, t, state))} />
          <button type="button" className={`filter-btn library-filter-toggle${dimensionCount ? ' is-active' : ''}`}
            aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
            筛选{dimensionCount ? ` (${dimensionCount})` : ''}
          </button>
          <label className="library-sort">
            <span className="muted small">排序</span>
            <select className="select" value={sortValue} aria-label="排序"
              onChange={e => { const [s, d] = e.target.value.split(':'); update({ sort: s, dir: d }); }}>
              {sortOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>

        <div className="filter-row">
          <FilterPopover label="分类" value={type ? categoryLabel(type) : undefined} panelLabel="研究分类">
            {close => <OptionMenu allLabel="全部分类" value={type}
              options={orderedTypes.map(t => ({ value: t.type, label: t.label, count: t.n }))}
              onSelect={v => { update({ type: v }); close(); }} />}
          </FilterPopover>
          <FilterPopover label="标签" value={tagSummary} panelLabel="标签筛选" wide>
            {() => <TagPanel value={tagSelection} onChange={setTags} />}
          </FilterPopover>
          <FilterPopover label="研究阶段" value={stage ? stageLabel : undefined}>
            {close => <OptionMenu allLabel="全部阶段" value={stage}
              options={Object.entries(RESEARCH_STAGES).map(([value, label]) => ({ value, label: String(label) }))}
              onSelect={v => { update({ stage: v }); close(); }} />}
          </FilterPopover>
          <FilterPopover label="审核状态" value={status ? statusLabel : undefined}>
            {close => <OptionMenu allLabel="全部状态" value={status}
              options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
              onSelect={v => { update({ status: v }); close(); }} />}
          </FilterPopover>
          <button type="button" className={`filter-btn filter-toggle${due ? ' is-active' : ''}`} aria-pressed={due}
            title="只看已到复核日期的研究" onClick={() => update({ due: due ? null : 'true' })}>
            {due && <span aria-hidden="true">✓</span>}待复核
          </button>
        </div>

        <ActiveFilterBar filters={active} total={data?.total} onClearAll={clearAll} />
      </div>

      {isLoading && <Loading />}
      {error && <ErrorBlock error={error} title="加载失败" />}
      {data && items.length === 0 && (
        <Empty title="没有匹配的页面">
          <p>{active.length ? <>试试移除部分条件，或 <button type="button" className="btn sm" onClick={clearAll}>清除全部筛选</button></> : <>还没有页面，可以 <Link to="/import">导入资料</Link>。</>}</p>
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
                <th>审核状态</th>
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
                  <td><div className="library-tags">{item.tags.slice(0, 6).map(t => <span key={t} className="chip">{t}</span>)}{item.tags.length > 6 && <span className="faint" title={item.tags.slice(6).join('、')}>+{item.tags.length - 6}</span>}</div></td>
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
