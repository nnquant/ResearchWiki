import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useGraph, useIndex } from '../api/hooks';
import { pageUrl, graphUrl } from '../api/client';
import { useCrumbs } from '../app/UiContext';
import { ForceGraph } from '../graph/ForceGraph';
import { Loading, ErrorBlock, TypeBadge } from '../app/ui';
import { RELATION_LABELS, typeColor, typeLabel } from '../lib/types';
import type { GraphNode } from '../api/types';

export function GraphPage() {
  const params = useParams();
  const slug = params['*'] ?? '';
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const depth = Number(search.get('depth') ?? 1) === 2 ? 2 : 1;
  const linkTypes = (search.get('link_types') ?? '').split(',').filter(Boolean);
  const { data, isLoading, error } = useGraph(slug, depth, linkTypes);
  const { data: index } = useIndex();
  const [selected, setSelected] = useState<GraphNode | null>(null);

  const centerTitle = useMemo(() => index?.find(i => i.slug === slug)?.title ?? data?.nodes.find(n => n.id === data.center)?.title ?? slug, [index, data, slug]);
  useCrumbs([{ label: '关联图' }, { label: centerTitle }]);

  const presentTypes = useMemo(() => [...new Set((data?.nodes ?? []).map(n => n.type))], [data]);
  const presentLinkTypes = useMemo(() => [...new Set((data?.edges ?? []).map(e => e.link_type))], [data]);

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

  return (
    <div className="graph-page">
      <div className="graph-toolbar">
        <span className="muted">中心：</span>
        <Link to={pageUrl(slug)} className="mono">{centerTitle}</Link>
        <span className="faint">·</span>
        <div className="btn-group">
          <button className={`btn sm ${depth === 1 ? 'active' : ''}`} onClick={() => update({ depth: null })}>1 跳</button>
          <button className={`btn sm ${depth === 2 ? 'active' : ''}`} onClick={() => update({ depth: '2' })}>2 跳</button>
        </div>
        <span className="faint">关系：</span>
        {['supported_by', 'contradicted_by', 'derived_from', 'tests', 'uses_dataset', 'trades', 'measures', 'mentions'].map(t => (
          <button key={t} className={`chip chip-button ${linkTypes.includes(t) ? 'active' : ''} ${presentLinkTypes.includes(t) || linkTypes.includes(t) ? '' : 'faint'}`} onClick={() => toggleLinkType(t)} title={linkTypes.length ? '点击切换筛选' : '默认显示全部关系；点击只保留所选'}>
            {RELATION_LABELS[t] ?? t}
          </button>
        ))}
        <span className="spacer" style={{ flex: 1 }} />
        {data && <span className="faint">{data.nodes.length} 节点 · {data.edges.length} 边{data.truncated ? ' · 已截断' : ''}</span>}
      </div>
      <div className="graph-canvas">
        {isLoading && <Loading />}
        {error && <div style={{ padding: 24 }}><ErrorBlock error={error} title="图谱加载失败" /></div>}
        {data && data.nodes.length === 1 && data.edges.length === 0 && (
          <div className="empty" style={{ margin: 24 }}>
            <h3>还没有关联</h3>
            <p>{data.unindexed ? '页面尚未索引。' : '这个页面没有链接到其他页面，也没有被引用。'}</p>
          </div>
        )}
        {data && data.edges.length > 0 && (
          <ForceGraph graph={data} selected={selected?.id ?? null} onSelect={setSelected} onOpen={node => navigate(pageUrl(node.id))} />
        )}
        {data && (
          <div className="graph-legend">
            {presentTypes.map(t => <span key={t}><i style={{ background: typeColor(t) }} />{typeLabel(t)}</span>)}
            <span><i style={{ background: 'var(--accent)', borderRadius: 0, height: 2 }} />类型化关系</span>
            <span><i style={{ background: 'var(--border-strong)', borderRadius: 0, height: 1 }} />引用</span>
          </div>
        )}
        {selected && (
          <div className="graph-panel">
            <TypeBadge type={selected.type} />
            <div className="title">{selected.title}</div>
            <div className="faint small mono">{selected.id}</div>
            <div className="faint small">{selected.degree} 条连接</div>
            <div className="row" style={{ marginTop: 10 }}>
              <Link className="btn sm" to={pageUrl(selected.id)}>打开页面</Link>
              {selected.id !== data?.center && <Link className="btn sm" to={graphUrl(selected.id) + (depth === 2 ? '?depth=2' : '')}>以此为中心</Link>}
              <button className="btn ghost sm" onClick={() => setSelected(null)}>关闭</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
