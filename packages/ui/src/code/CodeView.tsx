import { memo, useEffect, useMemo, useState } from 'react';
import { applyNodeChanges, Background, BackgroundVariant, ConnectionMode, Controls, MarkerType, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { drawingGeometry } from '@core/edge-geometry';
import { currentDrawing, useStore } from '../store';
import { useT } from '../i18n';
import type { EdgeData } from '../canvas/build';
import { Handles, nodeTypes } from '../canvas/nodes';
import { edgeTypes } from '../canvas/ZarkEdge';
import { hoverCss, hoverTargets, type Hover } from '../canvas/hover';
import { layout } from '../deps/DepsView';
import { Icon, Svg } from '../panels/ui';
import type { CodeGraph } from '../types';
import { moduleLevel, parseNodeId, pieceLevel, type CodeLevel } from './codeGraph';

const SIZE = { w: 220, h: 64 };
const INHERITANCE = new Set(['extends', 'implements']);

interface CodeNodeData extends Record<string, unknown> {
  label: string;
  sub: string;
  title: string;
  foreign: boolean;
}

const CodeNode = memo(function CodeNode({ data, selected }: NodeProps & { data: CodeNodeData }) {
  const ring = selected ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--canvas)]' : '';
  return (
    <div
      title={data.title}
      className={`relative flex h-full w-full flex-col justify-center rounded-xl border px-3.5 py-2 ${data.foreign ? 'border-dashed border-[var(--ext-border)] bg-[var(--ext-bg)] opacity-60' : 'border-[var(--box-border)] bg-[var(--box-bg)]'} shadow-[0_1px_2px_rgba(15,23,42,0.06)] ${ring}`}
    >
      <Handles interactive={false} />
      <div className="truncate font-mono text-[13.5px] font-semibold text-[var(--fg)]">{data.label}</div>
      <div className="truncate text-[11px] text-[var(--muted)]">{data.sub}</div>
    </div>
  );
});

const codeNodeTypes = { ...nodeTypes, code: CodeNode };

/** The level on screen: the component's modules, or the pieces of `code.module`. */
export function useCodeLevel(): { graph?: CodeGraph; level?: CodeLevel } {
  const code = useStore((s) => s.code);
  const all = useStore((s) => s.model?.codeGraphs);
  const graph = useStore((s) => (s.code ? s.index?.codeGraphs.get(s.code.component) : undefined));
  const level = useMemo(() => (graph ? (code?.module ? pieceLevel(graph, code.module, all ?? []) : moduleLevel(graph, all ?? [])) : undefined), [graph, code?.module, all]);
  return { graph, level };
}

/** Second line of a box: what it is, and where it lives when it is outside the viewed module. */
export function useNodeSub() {
  const index = useStore((s) => s.index)!;
  const code = useStore((s) => s.code)!;
  const t = useT();
  return (id: string) => {
    const at = parseNodeId(id, code.component);
    const where = at.component !== code.component ? ` · ${t('code.inComponent', { name: index.name(at.component) })}` : '';
    if (!at.piece) return (at.path === code.module ? t('code.topLevel') : t('code.module')) + where;
    const kind = index.codeGraphs.get(at.component)?.modules.find((m) => m.path === at.path)?.pieces.find((p) => p.name === at.piece)?.kind;
    const file = at.path === code.module ? '' : ` · ${at.path.slice(at.path.lastIndexOf('/') + 1)}`;
    return (kind ? t(`code.kind.${kind}`) : '') + file + where;
  };
}

function CodeGraphView({ level }: { level: CodeLevel }) {
  const code = useStore((s) => s.code)!;
  const selection = useStore((s) => s.selection.nodes);
  const sub = useNodeSub();
  const t = useT();
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>();
  const [error, setError] = useState<string>();
  const ids = (e: { from: string; to: string }) => `${e.from}->${e.to}`;

  useEffect(() => {
    let alive = true;
    setPositions(undefined);
    layout({
      nodes: level.nodes.map((n) => ({ id: n.id, ...SIZE })),
      edges: level.edges.map((e) => ({ id: ids(e), source: e.from, target: e.to })),
    }).then(
      (p) => alive && setPositions(p),
      (e) => alive && setError(String(e)),
    );
    return () => {
      alive = false;
    };
  }, [level]);

  const graph = useMemo(() => {
    if (!positions) return { nodes: [] as Node[], edges: [] as Edge[] };
    const rect = (id: string) => ({ ...(positions[id] ?? { x: 0, y: 0 }), ...SIZE });
    const nodes: Node[] = level.nodes.map((n) => ({
      id: n.id,
      type: 'code',
      position: positions[n.id] ?? { x: 0, y: 0 },
      style: { width: SIZE.w, height: SIZE.h },
      draggable: false,
      connectable: false,
      data: { label: n.label, sub: sub(n.id), title: n.id, foreign: n.foreign } satisfies CodeNodeData,
    }));
    const obstacles = level.nodes.map((n) => rect(n.id));
    const label = (count: number) => (count > 1 ? `×${count}` : '');
    const geometry = drawingGeometry(
      level.nodes.map((n) => ({ id: n.id, ...rect(n.id) })),
      level.edges.map((e) => ({ ref: ids(e), source: e.from, target: e.to, spec: { shape: 'auto' as const }, label: label(e.count) })),
    );
    const edges: Edge[] = level.edges.flatMap((e) => {
      const id = ids(e);
      const g = geometry.get(id);
      if (!g) return [];
      const conn = { ref: id, from: e.from, to: e.to, conn: { id: 'code', to: e.to, label: label(e.count) }, file: '' };
      return [{
        id,
        type: 'zark',
        source: e.from,
        target: e.to,
        sourceHandle: g.sourceSide,
        targetHandle: g.targetSide,
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: 'var(--edge)' },
        selectable: false,
        // Dashed: inheritance only (extends/implements), never mixed with calls.
        data: { ref: id, conn, spec: { shape: 'auto' }, inherited: e.kinds.every((k) => INHERITANCE.has(k)), label: label(e.count), bidirectional: false, dim: false, pulse: false, animate: true, obstacles, offsets: g.offsets, labelAt: g.labelAt } satisfies EdgeData,
      }];
    });
    return { nodes, edges };
    // `sub` reads the store's index and code state; `level` changes whenever they do.
  }, [positions, level, t]);

  // Local copy so React Flow can store node measurements; without them it draws no connectors.
  const [nodes, setNodes] = useState<Node[]>([]);
  useEffect(() => setNodes(graph.nodes), [graph.nodes]);
  // Selection changes keep the measured nodes, so connectors don't flicker.
  useEffect(() => setNodes((cur) => cur.map((n) => ({ ...n, selected: selection.includes(n.id) }))), [selection, graph.nodes]);

  const [hover, setHover] = useState<Hover | null>(null);
  // A hover left over from the level before a drill-down points at a box that is gone (as on the canvas).
  const hovering = hover && ('edge' in hover ? graph.edges.some((e) => e.id === hover.edge) : graph.nodes.some((n) => n.id === hover.node)) ? hover : null;
  const hoverStyle = useMemo(() => (hovering ? hoverCss(hoverTargets(hovering, graph.edges)) : ''), [hovering, graph.edges]);

  if (error) return <div className="grid h-full place-items-center text-[13px] text-[var(--danger)]">{t('code.layoutFailed', { error })}</div>;
  if (!positions) return <div className="grid h-full place-items-center text-[13px] text-[var(--muted)]">{t('code.layingOut')}</div>;
  return (
    <div className={`h-full w-full${hovering ? ' zark-hovering' : ''}`}>
      {hoverStyle && <style>{hoverStyle}</style>}
      <ReactFlow
        key={`${code.component}-${code.module ?? ''}`}
        nodes={nodes}
        edges={graph.edges}
        onNodesChange={(changes) => setNodes((cur) => applyNodeChanges(changes, cur))}
        nodeTypes={codeNodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
        minZoom={0.1}
        // Double-click drills into a module; d3-zoom would swallow it to zoom (as on the canvas).
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => useStore.getState().select([node.id])}
        onPaneClick={() => useStore.getState().select([])}
        onNodeDoubleClick={(_, node) => {
          // Drill into the node's module (in whichever component has it), unless it is the one on screen.
          const s = useStore.getState();
          const at = parseNodeId(node.id, code.component);
          if (at.path === code.module && at.component === code.component) return;
          if (s.index?.codeGraphs.has(at.component)) s.openCode(at.component, at.path);
        }}
        onNodeMouseEnter={(_, node) => setHover({ node: node.id })}
        onNodeMouseLeave={() => setHover(null)}
        onEdgeMouseEnter={(_, edge) => setHover({ edge: edge.id, source: edge.source, target: edge.target })}
        onEdgeMouseLeave={() => setHover(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="var(--dots)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

const crumb = 'rounded-md px-1.5 py-0.5 hover:bg-[var(--hover)] hover:text-[var(--fg)]';

export function CodeView() {
  const code = useStore((s) => s.code);
  const index = useStore((s) => s.index)!;
  const drawing = useStore(currentDrawing);
  const { graph, level } = useCodeLevel();
  const t = useT();
  if (!code) return null;
  const s = useStore.getState;
  const back = () => (code.module ? s().openCode(code.component) : s().closeCode());
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2.5">
        <button type="button" onClick={back} className={`flex items-center gap-1 text-[12.5px] font-medium text-[var(--fg-soft)] ${crumb}`}>
          <Svg icon={Icon.prev} size={12} /> {t('code.back')}
        </button>
        <nav aria-label={t('code.breadcrumb')} className="flex min-w-0 items-center gap-1 text-[13px] text-[var(--muted)]">
          {drawing && (
            <>
              <button type="button" onClick={() => s().closeCode()} className={crumb}>
                {drawing.name}
              </button>
              <span aria-hidden="true">›</span>
            </>
          )}
          {code.module ? (
            <button type="button" onClick={() => s().openCode(code.component)} className={crumb}>
              {index.name(code.component)}
            </button>
          ) : (
            <span aria-current="page" className="px-1.5 font-semibold text-[var(--fg)]">
              {index.name(code.component)}
            </span>
          )}
          {code.module && (
            <>
              <span aria-hidden="true">›</span>
              <span aria-current="page" className="truncate px-1.5 font-mono font-semibold text-[var(--fg)]">
                {code.module}
              </span>
            </>
          )}
        </nav>
        {level && (
          <span className="text-[12px] text-[var(--muted)]">
            {t('code.summary', { nodes: level.nodes.length, edges: level.edges.length })}
            {!code.module && ` · ${t('code.hint')}`}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {graph && level ? (
          <ReactFlowProvider>
            <CodeGraphView level={level} />
          </ReactFlowProvider>
        ) : (
          <div className="grid h-full place-items-center text-[13px] text-[var(--muted)]">{t('code.empty')}</div>
        )}
      </div>
    </div>
  );
}
