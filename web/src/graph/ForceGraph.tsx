import { useEffect, useRef } from 'react';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type Simulation, type SimulationNodeDatum, type SimulationLinkDatum } from 'd3-force';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom';
import { drag } from 'd3-drag';
import type { Graph, GraphNode, GraphEdge } from '../api/types';
import { TYPE_META } from '../lib/types';

interface SimNode extends SimulationNodeDatum, GraphNode {}
interface SimEdge extends SimulationLinkDatum<SimNode> {
  link_type: string;
  link_source: string;
}

interface Props {
  graph: Graph;
  selected: string | null;
  onSelect: (node: GraphNode | null) => void;
  onOpen: (node: GraphNode) => void;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

function nodeColor(type: string): string {
  return cssVar(TYPE_META[type]?.cssVar ?? '--t-other');
}

function radius(node: SimNode, center: boolean): number {
  return (center ? 9 : 5) + Math.min(node.degree, 12) * 0.5;
}

/** Canvas force-directed neighbourhood graph. Typed relations are drawn solid with arrows, mentions as thin gray lines. */
export function ForceGraph({ graph, selected, onSelect, onOpen }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<{ nodes: SimNode[]; edges: SimEdge[]; sim: Simulation<SimNode, SimEdge> | null; transform: ZoomTransform; hovered: SimNode | null }>({
    nodes: [], edges: [], sim: null, transform: zoomIdentity, hovered: null,
  });
  const propsRef = useRef({ selected, onSelect, onOpen, center: graph.center });
  propsRef.current = { selected, onSelect, onOpen, center: graph.center };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const state = stateRef.current;
    const previous = new Map(state.nodes.map(n => [n.id, n]));
    state.nodes = graph.nodes.map(n => ({ ...n, x: previous.get(n.id)?.x, y: previous.get(n.id)?.y }));
    const byId = new Map(state.nodes.map(n => [n.id, n]));
    state.edges = graph.edges
      .filter((e: GraphEdge) => byId.has(e.source) && byId.has(e.target))
      .map(e => ({ source: byId.get(e.source)!, target: byId.get(e.target)!, link_type: e.link_type, link_source: e.link_source }));

    let width = canvas.clientWidth;
    let height = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    function resize() {
      width = canvas!.clientWidth;
      height = canvas!.clientHeight;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      draw();
    }

    function draw() {
      const { transform, hovered } = state;
      const { selected: sel, center } = propsRef.current;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, width, height);
      ctx!.save();
      ctx!.translate(transform.x, transform.y);
      ctx!.scale(transform.k, transform.k);
      const text = cssVar('--text');
      const faint = cssVar('--faint');
      const border = cssVar('--border-strong');
      const accent = cssVar('--accent');
      const bg = cssVar('--bg');
      const focusSet = new Set<string>();
      const focus = hovered ?? state.nodes.find(n => n.id === sel) ?? null;
      if (focus) {
        focusSet.add(focus.id);
        for (const e of state.edges) {
          const s = e.source as SimNode; const t = e.target as SimNode;
          if (s.id === focus.id) focusSet.add(t.id);
          if (t.id === focus.id) focusSet.add(s.id);
        }
      }
      for (const e of state.edges) {
        const s = e.source as SimNode; const t = e.target as SimNode;
        if (s.x === undefined || t.x === undefined || s.y === undefined || t.y === undefined) continue;
        const typed = e.link_type !== 'mentions';
        const dim = focus ? !(focusSet.has(s.id) && focusSet.has(t.id) && (s.id === focus.id || t.id === focus.id)) : false;
        ctx!.globalAlpha = dim ? 0.15 : 1;
        ctx!.strokeStyle = typed ? accent : border;
        ctx!.lineWidth = (typed ? 1.6 : 0.8) / transform.k;
        ctx!.beginPath();
        ctx!.moveTo(s.x, s.y);
        ctx!.lineTo(t.x, t.y);
        ctx!.stroke();
        if (typed) {
          const angle = Math.atan2(t.y - s.y, t.x - s.x);
          const r = radius(t, t.id === center) + 2;
          const ax = t.x - Math.cos(angle) * r;
          const ay = t.y - Math.sin(angle) * r;
          const size = 6 / transform.k;
          ctx!.fillStyle = accent;
          ctx!.beginPath();
          ctx!.moveTo(ax, ay);
          ctx!.lineTo(ax - Math.cos(angle - 0.45) * size, ay - Math.sin(angle - 0.45) * size);
          ctx!.lineTo(ax - Math.cos(angle + 0.45) * size, ay - Math.sin(angle + 0.45) * size);
          ctx!.closePath();
          ctx!.fill();
          if (transform.k > 1.1) {
            const mx = (s.x + t.x) / 2; const my = (s.y + t.y) / 2;
            ctx!.font = `${10 / transform.k}px ${cssVar('--font-mono')}`;
            ctx!.fillStyle = faint;
            ctx!.textAlign = 'center';
            ctx!.fillText(e.link_type, mx, my - 3 / transform.k);
          }
        }
      }
      ctx!.globalAlpha = 1;
      const showAllLabels = transform.k > 1.25 || state.nodes.length <= 40;
      for (const n of state.nodes) {
        if (n.x === undefined || n.y === undefined) continue;
        const isCenter = n.id === center;
        const r = radius(n, isCenter);
        const dim = focus ? !focusSet.has(n.id) : false;
        ctx!.globalAlpha = dim ? 0.25 : 1;
        ctx!.fillStyle = nodeColor(n.type);
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx!.fill();
        if (isCenter || n.id === sel) {
          ctx!.strokeStyle = isCenter ? text : accent;
          ctx!.lineWidth = 2 / transform.k;
          ctx!.beginPath();
          ctx!.arc(n.x, n.y, r + 3 / transform.k, 0, Math.PI * 2);
          ctx!.stroke();
        }
        if (showAllLabels || isCenter || n.id === sel || n === hovered || n.degree >= 4) {
          const label = n.title.length > 42 ? `${n.title.slice(0, 40)}…` : n.title;
          ctx!.font = `${(isCenter ? 12.5 : 11) / transform.k}px ${cssVar('--font-sans')}`;
          ctx!.textAlign = 'center';
          ctx!.textBaseline = 'top';
          const w = ctx!.measureText(label).width;
          ctx!.fillStyle = bg;
          ctx!.globalAlpha = dim ? 0.2 : 0.75;
          ctx!.fillRect(n.x - w / 2 - 2 / transform.k, n.y + r + 2 / transform.k, w + 4 / transform.k, 14 / transform.k);
          ctx!.globalAlpha = dim ? 0.3 : 1;
          ctx!.fillStyle = isCenter ? text : cssVar('--text-2');
          ctx!.fillText(label, n.x, n.y + r + 3 / transform.k);
        }
      }
      ctx!.restore();
    }

    state.sim?.stop();
    const sim = forceSimulation<SimNode>(state.nodes)
      .force('link', forceLink<SimNode, SimEdge>(state.edges).id(d => d.id).distance(e => (e.link_type === 'mentions' ? 170 : 130)).strength(0.5))
      .force('charge', forceManyBody().strength(state.nodes.length > 80 ? -220 : -520))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide<SimNode>().radius(n => radius(n, n.id === graph.center) + 34))
      .alpha(1)
      .on('tick', draw);
    state.sim = sim;
    const centerNode = state.nodes.find(n => n.id === graph.center);
    if (centerNode) { centerNode.fx = width / 2; centerNode.fy = height / 2; }
    window.setTimeout(() => { if (centerNode) { centerNode.fx = null; centerNode.fy = null; } }, 1200);

    function locate(event: MouseEvent | { x: number; y: number }): SimNode | undefined {
      const rect = canvas!.getBoundingClientRect();
      const px = ('clientX' in event ? event.clientX - rect.left : event.x);
      const py = ('clientY' in event ? event.clientY - rect.top : event.y);
      const [gx, gy] = state.transform.invert([px, py]);
      return sim.find(gx, gy, 14 / state.transform.k);
    }

    const selection = select(canvas);
    const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.25, 4])
      .filter(event => !event.button && !(event.type === 'mousedown' && locate(event)))
      .on('zoom', event => { state.transform = event.transform; draw(); });
    selection.call(zoomBehavior);

    const dragBehavior = drag<HTMLCanvasElement, unknown>()
      .subject(event => {
        const node = locate({ x: event.x, y: event.y });
        return node ? { x: state.transform.applyX(node.x ?? 0), y: state.transform.applyY(node.y ?? 0), node } : null;
      })
      .on('start', event => { const node = event.subject.node as SimNode; if (!event.active) sim.alphaTarget(0.3).restart(); node.fx = node.x; node.fy = node.y; })
      .on('drag', event => { const node = event.subject.node as SimNode; const [gx, gy] = state.transform.invert([event.x, event.y]); node.fx = gx; node.fy = gy; })
      .on('end', event => { const node = event.subject.node as SimNode; if (!event.active) sim.alphaTarget(0); node.fx = null; node.fy = null; });
    selection.call(dragBehavior);

    let clickTimer: number | null = null;
    const onClick = (e: MouseEvent) => {
      const node = locate(e);
      if (clickTimer) { window.clearTimeout(clickTimer); clickTimer = null; if (node) propsRef.current.onOpen(node); return; }
      clickTimer = window.setTimeout(() => { clickTimer = null; propsRef.current.onSelect(node ?? null); }, 220);
    };
    const onMove = (e: MouseEvent) => {
      const node = locate(e) ?? null;
      if (node !== state.hovered) { state.hovered = node; canvas!.style.cursor = node ? 'pointer' : 'grab'; draw(); }
    };
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('mousemove', onMove);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    return () => {
      sim.stop();
      observer.disconnect();
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('mousemove', onMove);
      selection.on('.zoom', null).on('.drag', null);
    };
  }, [graph]);

  useEffect(() => {
    stateRef.current.sim?.restart();
  }, [selected]);

  return <canvas ref={canvasRef} aria-label="关联图" />;
}
