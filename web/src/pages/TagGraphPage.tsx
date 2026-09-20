import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTagGraph, useGraphTags } from '../api/hooks';
import { categoryLabel } from '../lib/types';
import { graphUrl, pageUrl } from '../api/client';
import type { GraphNode } from '../api/types';
import { MultiTagFilter, readTagSelection, writeTagSelection } from '../app/MultiTagFilter';
import { useCrumbs, useUi } from '../app/UiContext';
import { ErrorBlock, Loading, TypeBadge } from '../app/ui';
import { ForceGraph } from '../graph/ForceGraph';
import { GraphOverview } from '../graph/GraphOverview';
import { EntityFilter } from '../app/EntityFilter';

export function TagGraphPage() {
  useCrumbs([{ label: '图谱' }]);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { openNewPage, toast } = useUi();
  const [tagQuery, setTagQuery] = useState('');
  const [debouncedTagQuery, setDebouncedTagQuery] = useState('');
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedTagQuery(tagQuery), 250); return () => window.clearTimeout(timer); }, [tagQuery]);
  const { data: tagOptions } = useGraphTags(debouncedTagQuery);
  const { data, error, isLoading, isFetching, refetch } = useTagGraph(params);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<'overview' | 'filters' | 'node'>('overview');
  const selectNode = (node: GraphNode | null) => { setSelectedId(node?.id ?? null); if (node) setTool('node'); };
  const [draft, setDraft] = useState(params.get('q') ?? '');
  useEffect(() => setDraft(params.get('q') ?? ''), [params]);
  useEffect(() => setSelectedId(null), [data]);
  const selected = data?.nodes.find(n => n.id === selectedId);
  const selection = readTagSelection(params);
  const hasScope = Boolean(params.get('entity_id') || params.get('q') || params.get('type') || Object.values(selection).some(tags => tags.length));
  const view = params.get('view') ?? (hasScope ? 'materials' : 'overview');
  const pages = data?.nodes.filter(n => n.kind === 'page') ?? [];
  const related = selected?.kind === 'tag' ? pages.filter(n => data?.edges.some(e => e.source === n.id && e.target === selected.id)) : pages;
  const update = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next); };
  const focusTag = (tag: string) => {
    const next = new URLSearchParams(params);
    next.set('view', 'materials');
    writeTagSelection(next, { ...selection, tags_all: [...new Set([...selection.tags_all, tag])] });
    setParams(next);
  };
  const openNode = (node: GraphNode) => {
    if (node.kind === 'tag') focusTag(node.tag!);
    else if (node.kind === 'category') { const next = new URLSearchParams(params); next.set('type', node.category!); next.set('view', 'materials'); setParams(next); }
    else navigate(pageUrl(node.id));
  };
  const libraryParams = new URLSearchParams(params);
  libraryParams.delete('limit');
  libraryParams.delete('view');
  const searchParams = new URLSearchParams();
  writeTagSelection(searchParams, selection);
  if (params.get('type')) searchParams.set('types', params.get('type')!);
  for (const key of ['entity_id', 'entity_label']) if (params.get(key)) searchParams.set(key, params.get(key)!);
  // Title filtering and full-text queries have different meanings; carry only the research scope.
  const saveView = async () => {
    try { await navigator.clipboard.writeText(window.location.href); toast('已复制图谱链接，可收藏或分享此筛选视图', 'ok'); }
    catch { toast('复制失败，可直接收藏浏览器地址栏中的链接', 'error'); }
  };

  return <div className="graph-workspace">
    <section className="graph-stage" aria-label="图谱画布">
      <div className="graph-stage-heading"><strong>{view === 'overview' ? (hasScope ? '范围概览' : '全库概览') : '材料网络'}</strong><span className="muted small">{data ? `${data.nodes.length} 个节点 · ${data.edges.length} 条连接` : '正在加载…'}</span></div>
      <div className="graph-canvas" aria-busy={isFetching}>
        {error && <div className="graph-canvas-message"><ErrorBlock error={error} title="标签图谱加载失败" /></div>}
        {isLoading && <Loading label={view === 'overview' ? '正在汇总全库概览…' : '正在生成标签网络…'} />}
        {data && data.nodes.length === 0 && <div className="empty"><h3>没有符合条件的材料</h3><p>请在右侧调整标签、研究分类或标题筛选。</p><button className="btn" onClick={() => setTool('filters')}>调整筛选</button></div>}
        {data && data.nodes.length > 0 && <>
          <ForceGraph graph={data} selected={selectedId} onSelect={selectNode} onOpen={openNode} />
          <div className="graph-legend">{data.view === 'overview' ? <><span>圆形：研究分类</span><span>方形：标签聚合</span><span>连线：共同材料</span></> : <><span>圆形：研究材料</span><span>方形：标签</span><span>虚线：包含标签</span></>}<span title="按当前视图中的材料数量使用对数色阶，颜色越深数量越多">{data.view === 'overview' ? '材料数量' : '标签覆盖'}：少 <i className="graph-quantity-scale" /> 多</span><span>点击查看 · 双击展开 · 滚轮缩放</span></div>
        </>}
      </div>
    </section>
    <aside className="graph-tools" aria-label="图谱工具区">
    <header className="graph-tools-heading"><h1>图谱</h1><Link className="btn small" to="/entities">实体治理</Link></header>
    <div className="row graph-view-switch"><div className="btn-group">
      <button className={`btn ${view === 'overview' ? 'active' : ''}`} onClick={() => update('view', 'overview')}>{hasScope ? '范围概览' : '全库概览'}</button>
      <button className={`btn ${view === 'materials' ? 'active' : ''}`} onClick={() => update('view', 'materials')}>材料网络</button>
    </div>{hasScope && <button className="btn ghost" onClick={() => setParams({})}>返回全库概览</button>}</div>
    <div className="graph-tool-tabs" aria-label="工具面板">
      {([['overview', '总览'], ['filters', hasScope ? '筛选 · 已启用' : '筛选'], ['node', selected ? '节点 · 已选中' : '节点']] as const).map(([key, label]) => <button key={key} className={tool === key ? 'active' : ''} aria-pressed={tool === key} aria-controls="graph-tool-content" onClick={() => setTool(key)}>{label}</button>)}
    </div>
    <div className="graph-tool-content" id="graph-tool-content">
    {Boolean(data?.metadata_errors) && <p className="graph-limit small">{data?.metadata_errors} 份材料的元数据读取异常，标签覆盖不完整；请检查材料的 YAML 元数据。</p>}
    {tool === 'filters' && <section className="graph-filter-box">
      <h2>筛选范围</h2>
      <p className="muted small">按公司、行业、主题或标签组合圈定材料。</p>
      <form className="graph-filter-form" onSubmit={e => { e.preventDefault(); update('q', draft.trim()); }}>
        <label htmlFor="graph-title-filter">标题、路径或标签</label>
        <div className="row">
        <input id="graph-title-filter" className="input" aria-label="筛选图谱材料" placeholder="输入关键词…" value={draft} onChange={e => setDraft(e.target.value)} />
        <button className="btn" type="submit">筛选</button>
        </div>
        <label htmlFor="graph-category-filter">研究分类</label>
        <select id="graph-category-filter" className="select" aria-label="图谱研究分类" value={params.get('type') ?? ''} onChange={e => update('type', e.target.value)}><option value="">全部研究分类</option>{data?.types?.map(t => <option key={t.type} value={t.type}>{categoryLabel(t.type)}</option>)}</select>
        {view === 'materials' && <select className="select" aria-label="图谱材料上限" value={params.get('limit') ?? '80'} onChange={e => update('limit', e.target.value)}>{[40, 80, 150, 200].map(n => <option key={n} value={n}>最近 {n} 份材料</option>)}</select>}
      </form>
      <EntityFilter />
      <h3>标签组合</h3>
      <MultiTagFilter tags={tagOptions?.tags ?? []} value={selection} onSearch={setTagQuery} onChange={value => { const next = new URLSearchParams(params); writeTagSelection(next, value); setParams(next); }} />
      {(tagOptions?.total ?? 0) > 200 && <p className="small muted">标签选择器展示频次最高的 200 项，输入关键词可搜索其余标签。</p>}
      <button className="btn ghost" onClick={() => setParams({})}>重置全部筛选</button>
      <p className="small muted">{view === 'overview' ? '概览按全部材料聚合，连线表示覆盖交集。' : '共同标签只提供研究线索，不代表因果或观点支持。'}</p>
    </section>}
    {data && tool !== 'filters' && (data.view === 'overview' ? <GraphOverview graph={data} selected={selected} panel={tool} onSelect={selectNode} onOpen={openNode} /> : <>
      {tool === 'overview' ? <>
        <div className="graph-stats"><div><strong>{data.scope?.pages.toLocaleString()}</strong><span>范围内材料</span></div><div><strong>{data.scope?.tags.toLocaleString()}</strong><span>标签</span></div><div><strong>{pages.length}</strong><span>当前材料</span></div></div>
        <p className="small muted">当前展示 {data.scope?.shown_tags} 个标签 · {data.edges.length} 条连接{Boolean(data.scope?.untagged) && ` · ${data.scope?.untagged} 份尚无标签`}</p>
        {data.truncated && <p className="graph-limit small">当前为局部视图：最近 {data.scope?.page_limit} 份材料、最多 40 个标签，每份材料最多 10 条连接。可在“筛选”中缩小范围或提高材料上限。</p>}
        <h2>当前材料 · {pages.length}</h2><div className="graph-materials">{pages.map(n => <button key={n.id} onClick={() => selectNode(n)}><TypeBadge type={n.type} /><span>{n.title}</span></button>)}</div>
      </> : <>
          {selected ? <>
            <div className="row"><TypeBadge type={selected.type} /><span className="spacer" /><button className="btn ghost sm" onClick={() => setSelectedId(null)}>关闭</button></div>
            <h2>{selected.title}</h2>
            {selected.kind === 'tag' ? <><p className="muted small">范围内 {selected.count} 份材料包含此标签，当前展示 {selected.degree} 份。</p><button className="btn sm" onClick={() => focusTag(selected.tag!)}>加入必含标签</button></> : <>
              <p className="muted small">{selected.degree} 条可见标签连接</p>
              <div className="row">{selected.tags?.map(tag => <button key={tag} className="chip chip-button" onClick={() => focusTag(tag)}>{tag}</button>)}</div>
              {(selected.tag_count ?? 0) > 80 && <p className="small muted">仅列出前 80 个标签，完整标签请查看原文。</p>}
              <div className="graph-actions"><Link className="btn primary" to={pageUrl(selected.id)}>阅读原文</Link><Link className="btn" to={graphUrl(selected.id)}>查看页面关系</Link><button className="btn" onClick={() => openNewPage('claim', selected.id)}>基于此材料创建观点</button></div>
            </>}
          </> : <><h2>研究线索</h2><p className="muted small">选择标签查看相关材料，选择材料查看原文、页面关系或创建有来源的观点。</p></>}
          {selected?.kind !== 'page' && <><h3>当前材料 · {related.length}</h3><div className="graph-materials">{related.map(n => <button key={n.id} onClick={() => selectNode(n)}><TypeBadge type={n.type} /><span>{n.title}</span>{n.degree === 0 && <span className="faint small">暂无可见标签连接</span>}</button>)}</div></>}
      </>}
    </>)}
    </div>
    <footer className="graph-tools-footer"><div className="graph-scope-links small"><Link to={`/library?${libraryParams}`}>查看范围内资料</Link><Link to={`/search?${searchParams}`}>检索范围内正文 →</Link></div><div className="row"><button className="btn sm" onClick={saveView}>复制视图链接</button><button className="btn sm" disabled={isFetching} onClick={() => void refetch()}>{isFetching ? '更新中…' : '刷新图谱'}</button></div></footer>
    </aside>
  </div>;
}
