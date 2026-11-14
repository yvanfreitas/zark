import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
  type Connection as RFConnection,
  type Edge,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import { useStore, currentDrawing } from '../store';
import { tr, useT } from '../i18n';
import { canvasMenu, selectionMenu } from '../actions';
import { flowView } from '../flow';
import { buildGraph, drawingBounds } from './build';
import { nodeTypes } from './nodes';
import { edgeTypes } from './ZarkEdge';
import { hoverCss, hoverTargets, type Hover } from './hover';
import { ConnectionPicker, QuickCreate } from '../panels/CanvasDialogs';

const snap = (v: number, g: number) => Math.round(v / g) * g;

/** Absolute position of a node, walking up parentId chains (sub flows use relative coords). */
function absolute(nodes: Node[], id: string): { x: number; y: number } {
  const n = nodes.find((x) => x.id === id);
  if (!n) return { x: 0, y: 0 };
  if (!n.parentId) return n.position;
  const p = absolute(nodes, n.parentId);
  return { x: p.x + n.position.x, y: p.y + n.position.y };
}

export function Canvas({ mode = 'edit' }: { mode?: 'edit' | 'render' }) {
  const model = useStore((s) => s.model)!;
  const index = useStore((s) => s.index)!;
  const drawing = useStore(currentDrawing);
  const selection = useStore((s) => s.selection);
  const flowState = useStore((s) => s.flow);
  const filters = useStore((s) => s.filters);
  const focusRequest = useStore((s) => s.focusRequest);
  const readOnly = useStore((s) => s.readOnly);
  const interactive = mode === 'edit' && !readOnly;
  const rf = useReactFlow();

  const view = useMemo(() => flowView(model, index, flowState), [model, index, flowState]);
  const built = useMemo(
    () =>
      drawing
        ? buildGraph(index, drawing, model.catalog, {
            problems: model.problems,
            filters: mode === 'render' ? {} : filters,
            selection: selection.nodes,
            activeSteps: view?.activeSteps,
            flowRefs: view?.flowRefs,
            interactive,
            animate: mode === 'edit',
          }, model.icons)
        : { nodes: [], edges: [] },
    [drawing, index, model, filters, selection.nodes, view, interactive, mode],
  );

  // Local copy so dragging is smooth; replaced whenever the model changes.
  const [nodes, setNodes] = useState<Node[]>(built.nodes);
  useEffect(() => {
    const selected = new Set(useStore.getState().selection.nodes);
    setNodes(built.nodes.map((n) => ({ ...n, selected: selected.has(n.id) })));
  }, [built.nodes]);
  const edges = useMemo(() => built.edges.map((e) => ({ ...e, selected: selection.edges.includes(e.id) })), [built.edges, selection.edges]);

  // Hover highlight: a stylesheet keyed by data-id, so nodes and edges never re-render.
  // Off while a flow is open: the flow already owns the dim/highlight.
  const [hover, setHover] = useState<Hover | null>(null);
  // An element removed (or a drawing switched) under the pointer never fires mouseleave: ignore stale ids.
  const hoverAlive = hover && ('edge' in hover ? built.edges.some((e) => e.id === hover.edge) : built.nodes.some((n) => n.id === hover.node));
  const hovering = hoverAlive && !flowState ? hover : null;
  const hoverStyle = useMemo(() => (hovering ? hoverCss(hoverTargets(hovering, built.edges)) : ''), [hovering, built.edges]);

  // Batched canvas writes: many moves in 300 ms become one call and one save.
  const pending = useRef(new Map<string, { x?: number; y?: number; w?: number; h?: number }>());
  const timer = useRef<number>(undefined);
  const flush = useCallback(() => {
    const s = useStore.getState();
    const d = currentDrawing(s);
    if (!d || !pending.current.size) return;
    const ops: unknown[] = [];
    const moves: { id: string; x: number; y: number; w?: number; h?: number }[] = [];
    for (const [id, v] of pending.current) {
      if (id.startsWith('note:')) {
        const note = d.notes?.find((n) => `note:${n.id}` === id);
        if (note) ops.push({ op: 'set-note', note: { ...note, x: v.x ?? note.x, y: v.y ?? note.y } });
      } else if (d.nodes?.[id]) moves.push({ id, x: v.x ?? d.nodes[id].x, y: v.y ?? d.nodes[id].y, w: v.w, h: v.h });
    }
    pending.current.clear();
    if (moves.length) ops.unshift({ op: 'move-nodes', nodes: moves });
    if (ops.length) void s.write('POST', `/api/drawings/${d.id}/ops`, { ops }, [d.file]);
  }, []);
  const queue = useCallback(
    (id: string, v: { x?: number; y?: number; w?: number; h?: number }) => {
      pending.current.set(id, { ...pending.current.get(id), ...v });
      clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 300);
    },
    [flush],
  );
  useEffect(() => () => clearTimeout(timer.current), []);

  const grid = model.config.grid;
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((current) => {
        const next = applyNodeChanges(changes, current);
        for (const c of changes) {
          if (c.type === 'position' && c.dragging === false) {
            const abs = absolute(next, c.id);
            queue(c.id, { x: snap(abs.x, grid), y: snap(abs.y, grid) });
          }
          if (c.type === 'dimensions' && c.resizing === false && c.dimensions) {
            const abs = absolute(next, c.id);
            queue(c.id, { x: snap(abs.x, grid), y: snap(abs.y, grid), w: snap(c.dimensions.width, grid), h: snap(c.dimensions.height, grid) });
          }
        }
        return next;
      });
    },
    [grid, queue],
  );

  // Keyboard nudges from the global shortcut handler.
  useEffect(() => {
    const onNudge = (e: Event) => {
      const { dx, dy } = (e as CustomEvent).detail as { dx: number; dy: number };
      const s = useStore.getState();
      const d = currentDrawing(s);
      if (!d) return;
      for (const id of s.selection.nodes) {
        const n = d.nodes?.[id];
        if (n) queue(id, { x: n.x + dx * grid, y: n.y + dy * grid });
      }
      setNodes((cur) => cur.map((n) => (s.selection.nodes.includes(n.id) && n.draggable ? { ...n, position: { x: n.position.x + dx * grid, y: n.position.y + dy * grid } } : n)));
    };
    window.addEventListener('zark:nudge', onNudge);
    return () => window.removeEventListener('zark:nudge', onNudge);
  }, [grid, queue]);

  const onSelectionChange = useCallback(({ nodes: ns, edges: es }: OnSelectionChangeParams) => {
    const s = useStore.getState();
    const nIds = ns.map((n) => n.id);
    const eIds = es.map((e) => e.id);
    if (nIds.join() !== s.selection.nodes.join() || eIds.join() !== s.selection.edges.join()) s.select(nIds, eIds);
  }, []);

  const [picker, setPicker] = useState<{ source: string; target: string } | null>(null);
  const [quick, setQuick] = useState<{ x: number; y: number; left: number; top: number } | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const open = () => {
      const box = wrapper.current?.getBoundingClientRect();
      if (!box || readOnly) return;
      const p = rf.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
      setQuick({ x: snap(p.x, grid), y: snap(p.y, grid), left: box.width / 2, top: box.height / 2 });
    };
    window.addEventListener('zark:quick-create', open);
    return () => window.removeEventListener('zark:quick-create', open);
  }, [rf, grid, readOnly]);
  const onConnect = useCallback((c: RFConnection) => {
    if (c.source && c.target && c.source !== c.target && !c.source.includes(':') && !c.target.includes(':')) setPicker({ source: c.source, target: c.target });
  }, []);

  // Right-click (or the menu key): the same actions the inspector and the shortcuts offer.
  const openMenu = useCallback(
    (e: { clientX: number; clientY: number; preventDefault: () => void }, target?: { node?: string; edge?: string }) => {
      if (!interactive) return;
      e.preventDefault();
      const s = useStore.getState();
      // Right-clicking outside the selection moves the selection there first.
      if (target?.node && !s.selection.nodes.includes(target.node)) s.select([target.node]);
      if (target?.edge && !s.selection.edges.includes(target.edge)) s.select([], [target.edge]);
      const box = wrapper.current!.getBoundingClientRect();
      const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const newEntity = () => setQuick({ x: snap(at.x, grid), y: snap(at.y, grid), left: e.clientX - box.left, top: e.clientY - box.top });
      if (!target) s.select([]);
      const items = target ? selectionMenu() : canvasMenu({ x: snap(at.x, grid), y: snap(at.y, grid) }, newEntity);
      if (items.length) s.set({ menu: { x: e.clientX, y: e.clientY, items } });
    },
    [interactive, rf, grid],
  );
  useEffect(() => {
    const onKey = () => {
      const { nodes: ns, edges: es } = useStore.getState().selection;
      const el = ns.length
        ? wrapper.current?.querySelector(`.react-flow__node[data-id="${CSS.escape(ns[0])}"]`)
        : es.length
          ? wrapper.current?.querySelector(`.react-flow__edge[data-id="${CSS.escape(es[0])}"]`)
          : wrapper.current;
      const r = el?.getBoundingClientRect();
      if (!r) return;
      const point = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, preventDefault: () => undefined };
      openMenu(point, ns.length ? { node: ns[0] } : es.length ? { edge: es[0] } : undefined);
    };
    const onEdge = (e: Event) => {
      const d = (e as CustomEvent).detail as { ref: string; clientX: number; clientY: number };
      openMenu({ ...d, preventDefault: () => undefined }, { edge: d.ref });
    };
    window.addEventListener('zark:context-menu', onKey);
    window.addEventListener('zark:edge-menu', onEdge);
    return () => {
      window.removeEventListener('zark:context-menu', onKey);
      window.removeEventListener('zark:edge-menu', onEdge);
    };
  }, [openMenu]);

  // Fit when switching drawings or on request (Shift+C / Cmd+Shift+C).
  const initialized = useNodesInitialized();
  const fittedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (mode !== 'edit' || !initialized || !drawing || fittedFor.current === drawing.id) return;
    fittedFor.current = drawing.id;
    requestAnimationFrame(() => rf.fitView({ padding: 0.15, duration: 0, maxZoom: 1.2 }));
  }, [initialized, drawing, rf, mode]);
  useEffect(() => {
    if (!focusRequest) return;
    const sel = useStore.getState().selection.nodes;
    rf.fitView({ padding: 0.2, duration: 300, maxZoom: 1.4, nodes: sel.length ? sel.map((id) => ({ id })) : undefined });
  }, [focusRequest, rf]);

  if (!drawing) return <div className="grid h-full place-items-center text-[var(--muted)]">{tr('canvas.noDrawing')}</div>;

  if (mode === 'render') return <RenderFrame drawing={drawing} index={index} nodes={nodes} edges={edges} setNodes={setNodes} />;

  return (
    <div ref={wrapper} className={`relative h-full w-full${hovering ? ' zark-hovering' : ''}`}>
      {hoverStyle && <style>{hoverStyle}</style>}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        onNodeContextMenu={(e, node: Node) => openMenu(e, { node: node.id })}
        onEdgeContextMenu={(e, edge: Edge) => openMenu(e, { edge: edge.id })}
        onSelectionContextMenu={(e) => openMenu(e, { node: useStore.getState().selection.nodes[0] })}
        onPaneContextMenu={(e) => openMenu(e)}
        onNodeMouseEnter={(_, node) => setHover(node.type === 'entity' ? { node: node.id } : null)}
        onNodeMouseLeave={() => setHover(null)}
        onEdgeMouseEnter={(_, edge) => setHover({ edge: edge.id, source: edge.source, target: edge.target })}
        onEdgeMouseLeave={() => setHover(null)}
        onNodeDoubleClick={(_, node) => {
          const inner = index.drawingsByScope.get(node.id)?.[0];
          if (inner) useStore.getState().openDrawing(inner.id);
        }}
        onDoubleClick={(e) => {
          if (readOnly || !(e.target as HTMLElement).classList.contains('react-flow__pane')) return;
          const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setQuick({ x: snap(p.x, grid), y: snap(p.y, grid), left: e.clientX - box.left, top: e.clientY - box.top });
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/zark-entity')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData('application/zark-entity');
          if (!id) return;
          e.preventDefault();
          const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          void useStore.getState().write('POST', `/api/drawings/${drawing.id}/ops`, { ops: [{ op: 'place', nodes: [{ id, x: snap(p.x, grid), y: snap(p.y, grid) }] }] }, [drawing.file]);
        }}
        zoomOnDoubleClick={false}
        snapToGrid
        snapGrid={[grid, grid]}
        connectionMode={ConnectionMode.Loose}
        deleteKeyCode={null}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        minZoom={0.1}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        onlyRenderVisibleElements={nodes.length > 120}
        elementsSelectable
      >
        <Background variant={BackgroundVariant.Dots} gap={grid * 3} size={1.2} color="var(--dots)" />
        <MiniMap pannable zoomable className="!bg-[var(--surface)]" maskColor="var(--minimap-mask)" nodeColor="var(--minimap-node)" />
        <Controls showInteractive={false} />
      </ReactFlow>
      {interactive && !quick && !picker && <CanvasHint flow={!!flowState} />}
      {picker && <ConnectionPicker {...picker} onClose={() => setPicker(null)} />}
      {quick && <QuickCreate {...quick} onClose={() => setQuick(null)} />}
    </div>
  );
}

/**
 * One-line reminder of the gestures nothing on screen reveals (double-click,
 * dragging from a box side, right-click). Never intercepts the canvas; the
 * close button hides it for good in this browser.
 */
function CanvasHint({ flow }: { flow: boolean }) {
  const t = useT();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('zark-hint') === 'off';
    } catch {
      return false;
    }
  });
  const selecting = useStore((s) => s.selection.nodes.length + s.selection.edges.length > 0);
  const empty = useStore((s) => !s.model!.entities.length);
  if (hidden || selecting || empty) return null;
  const tips = flow ? [t('hint.flowStep'), t('hint.flowKeys')] : [t('hint.create'), t('hint.connect'), t('hint.menu'), t('hint.shortcuts')];
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-[5] flex justify-center px-3" data-edit>
      <div role="note" className="flex min-w-0 max-w-full items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)]/95 py-1 pl-3.5 pr-1 text-[12px] text-[var(--muted)] shadow-sm">
        <span className="min-w-0 truncate">
          {tips.map((tip, i) => (
            <span key={tip}>
              {i > 0 && <span className="px-1.5 text-[var(--subtle)]">·</span>}
              {tip}
            </span>
          ))}
        </span>
        <button
          type="button"
          aria-label={t('hint.dismiss')}
          title={t('hint.dismiss')}
          className="pointer-events-auto grid size-6 shrink-0 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
          onClick={() => {
            try {
              localStorage.setItem('zark-hint', 'off');
            } catch {
              /* still hidden for this tab */
            }
            setHidden(true);
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

type Grow = { l: number; t: number; r: number; b: number };
const PAD = 32;

/**
 * Panel-less frame the renderer screenshots. The model gives boxes, groups,
 * notes and bend points, but not label widths, so after layout the frame is
 * measured in the DOM and grown once to fit everything drawn.
 */
function RenderFrame({ drawing, index, nodes, edges, setNodes }: {
  drawing: NonNullable<ReturnType<typeof currentDrawing>>;
  index: NonNullable<ReturnType<typeof useStore.getState>['index']>;
  nodes: Node[];
  edges: ReturnType<typeof buildGraph>['edges'];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
}) {
  const b = drawingBounds(index, drawing);
  const [grow, setGrow] = useState<Grow | null>(null);
  const g = grow ?? { l: 0, t: 0, r: 0, b: 0 };
  return (
    <div id="render-root" style={{ width: Math.ceil(b.w + PAD * 2 + g.l + g.r), height: Math.ceil(b.h + PAD * 2 + g.t + g.b) }} className="bg-[var(--canvas)]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={(changes) => setNodes((cur) => applyNodeChanges(changes, cur))}
        viewport={{ x: -b.x + PAD + g.l, y: -b.y + PAD + g.t, zoom: 1 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        connectionMode={ConnectionMode.Loose}
      />
      <RenderReady nodes={nodes.length} edges={edges.length} measured={grow !== null} onMeasure={setGrow} />
    </div>
  );
}

/** Space each side still needs so every drawn element sits at least PAD inside the frame. */
function measureOverflow(): Grow {
  const root = document.getElementById('render-root')!.getBoundingClientRect();
  const items = document.querySelectorAll('#render-root .react-flow__node, #render-root .react-flow__edge-path, #render-root .react-flow__edgelabel-renderer > div');
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  items.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    minX = Math.min(minX, r.left);
    minY = Math.min(minY, r.top);
    maxX = Math.max(maxX, r.right);
    maxY = Math.max(maxY, r.bottom);
  });
  if (minX === Infinity) return { l: 0, t: 0, r: 0, b: 0 };
  const need = (v: number) => Math.max(0, Math.ceil(v));
  return {
    l: need(root.left + PAD - minX),
    t: need(root.top + PAD - minY),
    r: need(maxX - (root.right - PAD)),
    b: need(maxY - (root.bottom - PAD)),
  };
}

/**
 * Marks the page ready for the renderer once every node and connector is in
 * the DOM and fonts are loaded, plus two frames for layout to settle, after
 * one measuring pass that fits the frame to what was drawn.
 */
function RenderReady({ nodes, edges, measured, onMeasure }: { nodes: number; edges: number; measured: boolean; onMeasure: (g: Grow) => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    const check = () => {
      const n = document.querySelectorAll('#render-root .react-flow__node').length;
      const e = document.querySelectorAll('#render-root .react-flow__edge').length;
      if (n >= nodes && e >= edges) {
        void document.fonts.ready.then(() =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              if (cancelled) return;
              // First pass measures and grows the frame; the second (after re-render) marks ready.
              if (!measured) onMeasure(measureOverflow());
              else setReady(true);
            }),
          ),
        );
        return;
      }
      raf = requestAnimationFrame(check);
    };
    raf = requestAnimationFrame(check);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [nodes, edges, measured, onMeasure]);
  return <div data-ready={ready ? 'true' : 'false'} hidden />;
}
