import { useEffect, useRef } from 'react';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY, type Simulation, type SimulationNodeDatum, type SimulationLinkDatum } from 'd3-force';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom';
import { drag } from 'd3-drag';
import type { Graph, GraphNode, GraphEdge } from '../api/types';
import { RELATION_LABELS, TYPE_META } from '../lib/types';

interface SimNode extends SimulationNodeDatum, GraphNode {}
interface SimEdge extends SimulationLinkDatum<SimNode> {
  weight?: number;
  link_type: string;
  link_source: string;
}

interface Props {
  graph: Graph;
  selected: string | null;
  onSelect: (node: GraphNode | null) => void;
  onOpen: (node: GraphNode) => void;
}

// Fixed screen-space size, including when zoomed; quantity is encoded in fill shade.
const NODE_RADIUS = 7;

function quantityShade(color: string, intensity: number): string {
  const hex = color.replace('#', '');
  if (!/^[\da-f]{6}$/i.test(hex)) return color;
  const mix = intensity < 0.5 ? 0.65 * (1 - intensity * 2) : 0.4 * (intensity * 2 - 1);
  const target = intensity < 0.5 ? 255 : 0;
  const channels = [0, 2, 4].map(offset => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16);
    return Math.round(channel + (target - channel) * mix);
  });
  return `rgb(${channels.join(',')})`;
}

/** Canvas force-directed neighbourhood graph. Typed relations are drawn solid with arrows, mentions as thin gray lines. */
export function ForceGraph({ graph, selected, onSelect, onOpen }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<() => void>(() => {});
  const fitRef = useRef<() => void>(() => {});
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
      .map(e => ({ source: byId.get(e.source)!, target: byId.get(e.target)!, link_type: e.link_type, link_source: e.link_source, weight: e.weight }));

    let width = canvas.clientWidth;
    let height = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let palette: Record<string, string> = {};
    const nodeFills = new Map<string, string>();
    const quantities = state.nodes.filter(n => n.count !== undefined).map(n => Math.log1p(Math.max(0, n.count!)));
    const minQuantity = quantities.length ? Math.min(...quantities) : 0;
    const quantityRange = quantities.length ? Math.max(...quantities) - minQuantity : 0;
    const refreshPalette = () => {
      const style = getComputedStyle(document.documentElement);
      const names = ['--text', '--faint', '--border-strong', '--accent', '--bg', '--text-2', '--font-mono', '--font-sans', '--t-other', ...Object.values(TYPE_META).map(t => t.cssVar)];
      palette = Object.fromEntries(names.map(name => [name, style.getPropertyValue(name).trim()]));
      // Precompute colors only on data/theme changes, never during animation frames.
      for (const node of state.nodes) {
        const base = palette[node.type === 'tag' ? '--accent' : TYPE_META[node.type]?.cssVar ?? '--t-other'];
        const intensity = quantityRange ? (Math.log1p(Math.max(0, node.count ?? 0)) - minQuantity) / quantityRange : 0.5;
        nodeFills.set(node.id, node.count === undefined ? base : quantityShade(base, intensity));
      }
    };
    refreshPalette();
    const labelIds = new Set([...state.nodes].sort((a, b) => b.degree - a.degree).slice(0, 60).map(n => n.id));
    let frame = 0;
    let lastDraw = 0;

    function resize() {
      width = canvas!.clientWidth;
      height = canvas!.clientHeight;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      draw();
    }

    function draw() {
      if (frame) return;
      frame = window.requestAnimationFrame(time => {
        frame = 0;
        if (time - lastDraw < (state.nodes.length > 80 ? 32 : 15)) { draw(); return; }
        lastDraw = time;
        paint();
      });
    }

    function paint() {
      const { transform, hovered } = state;
      const { selected: sel, center } = propsRef.current;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, width, height);
      ctx!.save();
      ctx!.translate(transform.x, transform.y);
      ctx!.scale(transform.k, transform.k);
      const text = palette['--text'];
      const faint = palette['--faint'];
      const border = palette['--border-strong'];
      const accent = palette['--accent'];
      const bg = palette['--bg'];
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
        const tagLink = e.link_type === 'has_tag' || e.link_type === 'has_entity';
        const aggregate = e.link_type === 'aggregate';
        const typed = e.link_type !== 'mentions' && !tagLink && !aggregate;
        const dim = focus ? !(focusSet.has(s.id) && focusSet.has(t.id) && (s.id === focus.id || t.id === focus.id)) : false;
        ctx!.globalAlpha = dim ? 0.15 : 1;
        ctx!.strokeStyle = typed ? accent : border;
        ctx!.lineWidth = (aggregate ? 0.6 + Math.min(3, Math.log2(1 + (e.weight ?? 1)) * 0.3) : typed ? 1.6 : 0.8) / transform.k;
        ctx!.setLineDash(tagLink ? [4 / transform.k, 4 / transform.k] : []);
        ctx!.beginPath();
        ctx!.moveTo(s.x, s.y);
        ctx!.lineTo(t.x, t.y);
        ctx!.stroke();
        ctx!.setLineDash([]);
        if (typed) {
          const angle = Math.atan2(t.y - s.y, t.x - s.x);
          const r = (NODE_RADIUS + 2) / transform.k;
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
            ctx!.font = `${10 / transform.k}px ${palette['--font-mono']}`;
            ctx!.fillStyle = faint;
            ctx!.textAlign = 'center';
            ctx!.fillText(RELATION_LABELS[e.link_type] ?? e.link_type, mx, my - 3 / transform.k);
          }
        }
      }
      ctx!.globalAlpha = 1;
      const showAllLabels = transform.k > 1.25 || state.nodes.length <= 40;
      for (const n of state.nodes) {
        if (n.x === undefined || n.y === undefined) continue;
        const isCenter = n.id === center;
        const r = NODE_RADIUS / transform.k;
        const dim = focus ? !focusSet.has(n.id) : false;
        // Keep quantity shades stable during selection; dim only edges and labels.
        ctx!.globalAlpha = 1;
        ctx!.fillStyle = nodeFills.get(n.id)!;
        ctx!.beginPath();
        if (n.kind === 'entity') { ctx!.moveTo(n.x, n.y - r); ctx!.lineTo(n.x + r, n.y); ctx!.lineTo(n.x, n.y + r); ctx!.lineTo(n.x - r, n.y); ctx!.closePath(); }
        else if (n.kind === 'tag') ctx!.rect(n.x - r, n.y - r, r * 2, r * 2);
        else ctx!.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx!.fill();
        if (isCenter || n.id === sel || n === hovered) {
          ctx!.strokeStyle = isCenter ? text : accent;
          ctx!.lineWidth = 2 / transform.k;
          ctx!.beginPath();
          ctx!.arc(n.x, n.y, r + 3 / transform.k, 0, Math.PI * 2);
          ctx!.stroke();
        }
        if (isCenter || n.id === sel || n === hovered || n.kind === 'entity' || n.kind === 'tag' || n.kind === 'category' || (labelIds.has(n.id) && showAllLabels)) {
          const maxLabel = state.nodes.length > 40 && n.kind !== 'tag' ? 24 : 40;
          const title = n.title.length > maxLabel + 2 ? `${n.title.slice(0, maxLabel)}…` : n.title;
          const label = graph.view === 'overview' ? `${title} · ${n.count?.toLocaleString()}` : title;
          ctx!.font = `${(isCenter ? 12.5 : 11) / transform.k}px ${palette['--font-sans']}`;
          ctx!.textAlign = 'center';
          ctx!.textBaseline = 'top';
          const w = ctx!.measureText(label).width;
          ctx!.fillStyle = bg;
          ctx!.globalAlpha = dim ? 0.2 : 0.75;
          ctx!.fillRect(n.x - w / 2 - 2 / transform.k, n.y + r + 2 / transform.k, w + 4 / transform.k, 14 / transform.k);
          ctx!.globalAlpha = dim ? 0.3 : 1;
          ctx!.fillStyle = isCenter ? text : palette['--text-2'];
          ctx!.fillText(label, n.x, n.y + r + 3 / transform.k);
        }
      }
      ctx!.restore();
    }

    drawRef.current = draw;
    state.hovered = null;
    state.sim?.stop();
    const sim = forceSimulation<SimNode>(state.nodes)
      .force('link', forceLink<SimNode, SimEdge>(state.edges).id(d => d.id).distance(e => (e.link_type === 'mentions' ? 170 : 130)).strength(0.5))
      .force('charge', forceManyBody().strength(state.nodes.length > 80 ? -180 : -350))
      .force('center', forceCenter(width / 2, height / 2))
      .force('x', forceX(width / 2).strength(0.06))
      .force('y', forceY(height / 2).strength(0.06))
      .force('collide', forceCollide<SimNode>().radius(NODE_RADIUS + 34))
      .alpha(1)
      .alphaDecay(0.04)
      .on('tick', draw);
    state.sim = sim;
    const centerNode = state.nodes.find(n => n.id === graph.center);
    if (centerNode) { centerNode.fx = width / 2; centerNode.fy = height / 2; }
    const releaseTimer = window.setTimeout(() => { if (centerNode) { centerNode.fx = null; centerNode.fy = null; } }, 1200);

    function locate(event: MouseEvent | { x: number; y: number }): SimNode | undefined {
      const rect = canvas!.getBoundingClientRect();
      const px = ('clientX' in event ? event.clientX - rect.left : event.x);
      const py = ('clientY' in event ? event.clientY - rect.top : event.y);
      const [gx, gy] = state.transform.invert([px, py]);
      const closest = sim.find(gx, gy);
      if (!closest) return undefined;
      const hitRadius = 14 / state.transform.k;
      return Math.hypot(gx - (closest.x ?? 0), gy - (closest.y ?? 0)) <= hitRadius ? closest : undefined;
    }

    const selection = select(canvas);
    let interacted = false;
    const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.25, 4])
      .filter(event => !event.button && !(event.type === 'mousedown' && locate(event)))
      .on('zoom', event => { if (event.sourceEvent) interacted = true; state.transform = event.transform; draw(); });
    selection.call(zoomBehavior);
    selection.on('dblclick.zoom', null);
    const fit = () => {
      if (!state.nodes.length || !width || !height) return;
      const xs = state.nodes.map(n => n.x ?? 0), ys = state.nodes.map(n => n.y ?? 0);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const k = Math.max(0.25, Math.min(1.4, (width - 100) / Math.max(1, maxX - minX), (height - 100) / Math.max(1, maxY - minY)));
      selection.call(zoomBehavior.transform, zoomIdentity.translate(width / 2 - k * (minX + maxX) / 2, height / 2 - k * (minY + maxY) / 2).scale(k));
    };
    fitRef.current = fit;
    selection.call(zoomBehavior.transform, zoomIdentity);
    const fitTimer = window.setTimeout(() => { if (!interacted) fit(); }, 1500);
    sim.on('end', () => { if (!interacted) fit(); });

    const dragBehavior = drag<HTMLCanvasElement, unknown>()
      .subject(event => {
        const node = locate({ x: event.x, y: event.y });
        return node ? { x: state.transform.applyX(node.x ?? 0), y: state.transform.applyY(node.y ?? 0), node } : null;
      })
      .on('start', event => { interacted = true; const node = event.subject.node as SimNode; if (!event.active) sim.alphaTarget(0.3).restart(); node.fx = node.x; node.fy = node.y; })
      .on('drag', event => { const node = event.subject.node as SimNode; const [gx, gy] = state.transform.invert([event.x, event.y]); node.fx = gx; node.fy = gy; })
      .on('end', event => { const node = event.subject.node as SimNode; if (!event.active) sim.alphaTarget(0); node.fx = null; node.fy = null; });
    selection.call(dragBehavior);

    let clickTimer: number | null = null;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
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
    const themeObserver = new MutationObserver(() => { refreshPalette(); draw(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const onVisibility = () => { if (document.hidden) sim.stop(); else { if (sim.alpha() > 0.01) sim.restart(); draw(); } };
    document.addEventListener('visibilitychange', onVisibility);
    resize();

    return () => {
      sim.stop();
      if (frame) window.cancelAnimationFrame(frame);
      themeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearTimeout(releaseTimer);
      window.clearTimeout(fitTimer);
      if (clickTimer) window.clearTimeout(clickTimer);
      drawRef.current = () => {};
      fitRef.current = () => {};
      observer.disconnect();
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('mousemove', onMove);
      selection.on('.zoom', null).on('.drag', null);
    };
  }, [graph]);

  useEffect(() => {
    drawRef.current();
  }, [selected]);

  return <><canvas ref={canvasRef} aria-label="研究图谱：可通过旁边的材料列表查看节点" /><button className="btn sm graph-fit" onClick={() => fitRef.current()}>适应画布</button></>;
}
