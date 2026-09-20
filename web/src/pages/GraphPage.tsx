import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useGraph } from '../api/hooks';
import { pageUrl, graphUrl } from '../api/client';
import { useCrumbs } from '../app/UiContext';
import { ForceGraph } from '../graph/ForceGraph';
import { Loading, ErrorBlock, TypeBadge } from '../app/ui';
import { RELATION_LABELS, RELATION_FIELDS } from '../lib/types';
import type { GraphNode } from '../api/types';
import { TagGraphPage } from './TagGraphPage';

export function GraphPage() {
  const params = useParams();
  return params['*'] ? <PageGraph /> : <TagGraphPage />;
}

function PageGraph() {
  const params = useParams();
  const slug = params['*'] ?? '';
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const depth = search.get('depth') === '1' ? 1 : 2;
  const linkTypes = (search.get('link_types') ?? '').split(',').filter(Boolean);
  const { data, isLoading, error } = useGraph(slug, depth, linkTypes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const center = data?.nodes.find(n => n.id === data.center);
  const selected = data?.nodes.find(n => n.id === selectedId) ?? center;
  const centerTitle = center?.title ?? slug;
  useCrumbs([{ label: '图谱', to: '/graph' }, { label: centerTitle }]);
  useEffect(() => setSelectedId(null), [slug, depth, search.get('link_types')]);
  const pages = data?.nodes.filter(n => n.kind === 'page' && n.id !== data.center) ?? [];
  const hubs = data?.nodes.filter(n => n.kind === 'entity' || n.kind === 'tag') ?? [];
  const connections = useMemo(() => data?.edges.filter(e => e.source === selected?.id || e.target === selected?.id) ?? [], [data, selected]);
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    setSearch(next);
  };
  const toggleLinkType = (type: string) => {
    const set = new Set(linkTypes);
    if (set.has(type)) set.delete(type); else set.add(type);
    update({ link_types: [...set].join(',') || null });
  };
  const openNode = (node: GraphNode) => {
    if (node.kind === 'entity') navigate(`/graph?${new URLSearchParams({ entity_id: node.entity_id ?? node.id, view: 'materials' })}`);
    else if (node.kind === 'tag') navigate(`/graph?${new URLSearchParams({ tags_all: node.tag ?? node.title, view: 'materials' })}`);
    else navigate(pageUrl(node.id));
  };
  return <div className="graph-workspace">
    <section className="graph-stage" aria-label="研报局部图谱">
      <div className="graph-stage-heading"><strong>{centerTitle}</strong><span className="muted small">{data ? `${data.nodes.length} 个节点 · ${data.edges.length} 条连接` : '正在加载…'}</span></div>
      <div className="graph-canvas">
        {isLoading && <Loading />}
        {error && <div className="graph-canvas-message"><ErrorBlock error={error} title="图谱加载失败" /></div>}
        {data && <ForceGraph graph={data} selected={selected?.id ?? null} onSelect={n => setSelectedId(n?.id ?? null)} onOpen={openNode} />}
        {data && <div className="graph-legend"><span>圆形：材料</span><span>菱形：实体</span><span>方形：标签</span><span>虚线：提及或包含 · 箭头：明确关系</span><span>双击打开 · 滚轮缩放</span></div>}
      </div>
    </section>
    <aside className="graph-tools" aria-label="研报图谱工具区">
      <header className="graph-tools-heading"><h1>研报图谱</h1><Link className="btn sm" to="/graph">全库概览</Link></header>
      <div className="graph-tool-content">
        <div className="btn-group"><button className={`btn sm ${depth === 1 ? 'active' : ''}`} onClick={() => update({ depth: '1' })}>本篇对象</button><button className={`btn sm ${depth === 2 ? 'active' : ''}`} onClick={() => update({ depth: null })}>相关材料</button></div>
        <p className="muted small">沿本篇的实体与标签寻找材料；共同提及不代表支持、反驳或因果关系。</p>
        <h2>关系筛选</h2>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className={`chip chip-button ${!linkTypes.length ? 'active' : ''}`} onClick={() => update({ link_types: null })}>全部</button>
          {['has_entity', 'has_tag', ...RELATION_FIELDS, 'mentions'].map(t => <button key={t} className={`chip chip-button ${linkTypes.includes(t) ? 'active' : ''}`} onClick={() => toggleLinkType(t)}>{RELATION_LABELS[t] ?? t}</button>)}
        </div>
        {data?.explicit_unavailable && <p className="graph-limit small">页面引用服务暂不可用，当前展示元数据中的实体、标签和明确关系。</p>}
        {Boolean(data?.metadata_errors) && <p className="graph-limit small">本篇元数据读取异常，实体与标签可能不完整。</p>}
        {data?.truncated && <p className="graph-limit small">当前为局部视图，最多展示 32 个实体／标签、50 份共同提及的材料，并保留有限的明确关系。选择节点可继续查看其范围或以另一篇材料为中心。</p>}
        {data && !data.edges.length && <p className="graph-limit small">{linkTypes.length ? '当前关系筛选没有结果，可切回“全部”。' : '本篇尚无研究实体、主题标签或明确关系。仅有“研报”等导入标签时，需待研究元数据补齐后才能发现关联。'}</p>}
        {selected && <section>
          <h2>{selected.kind === 'entity' ? '实体' : selected.kind === 'tag' ? '标签' : '材料'}详情</h2>
          {selected.kind === 'page' && <TypeBadge type={selected.type} />}
          <h3>{selected.title}</h3>
          {selected.kind === 'entity' && <p className="muted small">已确认的实体身份，已合并其核验别名。</p>}
          {selected.count !== undefined && <p className="muted small">覆盖 {selected.count.toLocaleString()} 份材料</p>}
          <div className="row" style={{ flexWrap: 'wrap' }}><button className="btn sm" onClick={() => openNode(selected)}>{selected.kind === 'page' ? '阅读原文' : '查看此范围的材料'}</button>{selected.kind === 'page' && selected.id !== data?.center && <Link className="btn sm" to={graphUrl(selected.id)}>以此为中心</Link>}</div>
          <div className="graph-connections">{connections.map((e, i) => {
            const other = data?.nodes.find(n => n.id === (e.source === selected.id ? e.target : e.source));
            return other && <div key={i} className="small"><button className="btn ghost sm" onClick={() => setSelectedId(other.id)}>{RELATION_LABELS[e.link_type] ?? e.link_type} · {other.title}</button><div className="faint">{e.context ?? e.link_source}</div></div>;
          })}</div>
        </section>}
        <h2>本篇实体与标签 · {hubs.length}</h2>
        <div className="row" style={{ flexWrap: 'wrap' }}>{hubs.map(n => <button key={n.id} className={`chip chip-button ${n.id === selected?.id ? 'active' : ''}`} onClick={() => setSelectedId(n.id)}>{n.kind === 'entity' ? '◇ ' : '# '}{n.title}</button>)}</div>
        <h2>当前关联材料 · {pages.length}</h2>
        {depth === 1 && Boolean(data?.discovery?.related_pages) && <button className="btn sm" onClick={() => update({ depth: null })}>展开相关材料（{data?.discovery?.related_pages.toLocaleString()} 份候选）</button>}
        <div className="graph-materials">{pages.map(n => <button key={n.id} onClick={() => setSelectedId(n.id)}><TypeBadge type={n.type} /><span>{n.title}</span></button>)}</div>
      </div>
      <footer className="graph-tools-footer"><Link to={pageUrl(slug)}>返回本篇研报 →</Link></footer>
    </aside>
  </div>;
}
