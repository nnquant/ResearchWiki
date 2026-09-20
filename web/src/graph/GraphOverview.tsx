import type { Graph, GraphNode } from '../api/types';
import { TypeBadge } from '../app/ui';

export function GraphOverview({ graph, selected, panel, onSelect, onOpen }: {
  graph: Graph;
  selected?: GraphNode;
  panel: 'overview' | 'node';
  onSelect: (node: GraphNode | null) => void;
  onOpen: (node: GraphNode) => void;
}) {
  const categories = graph.nodes.filter(n => n.kind === 'category');
  const incident = selected ? graph.edges.filter(e => e.source === selected.id || e.target === selected.id) : [];
  if (panel === 'node') return <>
        {selected ? <>
          <div className="row"><TypeBadge type={selected.type} /><span className="spacer" /><button className="btn ghost sm" onClick={() => onSelect(null)}>关闭</button></div>
          <h2>{selected.title}</h2><p><strong>{selected.count?.toLocaleString()}</strong> 份材料</p>
          <button className="btn primary" onClick={() => onOpen(selected)}>展开材料 →</button>
          <h3>分类与标签的交叉覆盖</h3>
          <div className="graph-materials">{incident.map(edge => {
            const other = graph.nodes.find(n => n.id === (edge.source === selected.id ? edge.target : edge.source))!;
            return <button key={`${edge.source}/${edge.target}`} onClick={() => onSelect(other)}><span>{other.title}</span><strong>{edge.weight} 份共同材料</strong></button>;
          })}</div>
        </> : <><h2>选择一个节点</h2><p className="muted small">点击左侧节点查看覆盖数量和交叉关联，双击节点展开对应材料。</p></>}
  </>;
  return <>
    <div className="graph-stats"><div><strong>{graph.overview?.covered_pages.toLocaleString()}</strong><span>覆盖材料</span></div><div><strong>{categories.length}</strong><span>研究分类</span></div><div><strong>{graph.scope?.tags.toLocaleString()}</strong><span>原始标签名称</span></div></div>
    <h2>研究分类</h2>
    <div className="graph-category-cards" aria-label="全库分类汇总">
      {categories.map(node => <button key={node.id} title={`展开${node.title}的材料`} onClick={() => onOpen(node)}><TypeBadge type={node.type} /><strong>{node.count?.toLocaleString()}</strong></button>)}
    </div>
    <p className="graph-limit small">按范围内全部材料汇总，每篇只计入一个分类。标签覆盖可重叠。</p>
    <h2>高频标签入口</h2>
    <p className="muted small">展示 {graph.overview?.featured_tags} 个标签，其余 {graph.overview?.other_tags.toLocaleString()} 个可在“筛选”中搜索。</p>
        {graph.overview?.groups.map(group => <section key={group.key}>
          <h3>{group.label} · {group.distinct.toLocaleString()} 个名称</h3>
          <div className="graph-overview-tags">{graph.nodes.filter(n => n.kind === 'tag' && n.group === group.key).map(node => <button key={node.id} onClick={() => onOpen(node)}><span>{node.title}</span><strong>{node.count}</strong></button>)}</div>
          {group.shown === 0 && <p className="muted small">暂无重复出现的标签，可在“筛选”中搜索标签。</p>}
        </section>)}
  </>;
}
