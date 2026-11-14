import { useEffect, useMemo, useState } from 'react';
import { applyNodeChanges, ConnectionMode, MarkerType, ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, type Edge, type Node } from '@xyflow/react';
import type { Index } from '../model';
import { useStore } from '../store';
import { autoSide, type EdgeData, type EntityData } from '../canvas/build';
import { nodeTypes } from '../canvas/nodes';
import { edgeTypes } from '../canvas/ZarkEdge';
import { inputClass } from '../panels/ui';
import type { LayoutRequest, LayoutResponse } from './layout.worker';

/** Entities and connections within `levels` hops of `center`, both directions. */
export function dependencySubgraph(index: Index, center: string, levels: number) {
  const seen = new Map<string, number>([[center, 0]]);
  const refs = new Set<string>();
  let frontier = [center];
  for (let depth = 1; depth <= levels && frontier.length; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const c of index.conns.values()) {
        const other = c.from === id ? c.to : c.to === id ? c.from : undefined;
        if (!other || !index.entities.has(other)) continue;
        refs.add(c.ref);
        if (!seen.has(other)) {
          seen.set(other, depth);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  // Keep only connections whose both ends made it into the subgraph.
  const edges = [...refs].map((r) => index.conns.get(r)!).filter((c) => seen.has(c.from) && seen.has(c.to));
  return { entities: [...seen.keys()], depth: seen, edges };
}

let worker: Worker | undefined;
let requestId = 0;
function layout(req: Omit<LayoutRequest, 'id'>): Promise<LayoutResponse['positions']> {
  worker ??= new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<LayoutResponse>) => {
      if (e.data.id !== id) return;
      worker!.removeEventListener('message', onMessage);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.positions);
    };
    worker!.addEventListener('message', onMessage);
    worker!.postMessage({ ...req, id });
  });
}

function DepsGraph({ center, levels }: { center: string; levels: number }) {
  const index = useStore((s) => s.index)!;
  const catalog = useStore((s) => s.model!.catalog);
  const sub = useMemo(() => dependencySubgraph(index, center, levels), [index, center, levels]);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let alive = true;
    setPositions(undefined);
    layout({
      nodes: sub.entities.map((id) => ({ id, ...index.size(id) })),
      edges: sub.edges.map((c) => ({ id: c.ref, source: c.from, target: c.to })),
    }).then(
      (p) => alive && setPositions(p),
      (e) => alive && setError(String(e)),
    );
    return () => {
      alive = false;
    };
  }, [sub, index]);

  const graph = useMemo(() => {
    if (!positions) return { nodes: [] as Node[], edges: [] as Edge[] };
    const techs = new Map((catalog.technologies ?? []).map((t) => [t.id, t]));
    const rect = (id: string) => ({ ...positions[id], ...index.size(id) });
    const nodes: Node[] = sub.entities.map((id) => {
      const e = index.entities.get(id)!;
      const tech = e.technologies?.map((t) => techs.get(t)).find(Boolean);
      return {
        id,
        type: 'entity',
        position: positions[id] ?? { x: 0, y: 0 },
        style: { width: index.size(id).w, height: index.size(id).h },
        selected: id === center,
        draggable: false,
        connectable: false,
        data: {
          entity: e,
          hasInner: !!index.drawingsByScope.get(id)?.length,
          expanded: false,
          dim: false,
          techName: tech?.name,
          techIcon: tech?.icon,
          inActiveFlow: false,
          interactive: false,
          resizable: false,
        } satisfies EntityData,
      };
    });
    // Connectors route around the boxes; parallel ones between the same pair fan out.
    const obstacles = sub.entities.map(rect);
    const pairCount = new Map<string, number>();
    const edges: Edge[] = sub.edges.map((c) => {
      const pair = [c.from, c.to].sort().join('|');
      const k = pairCount.get(pair) ?? 0;
      pairCount.set(pair, k + 1);
      const [from, to] = autoSide(rect(c.from), rect(c.to));
      const marker = { type: MarkerType.ArrowClosed, width: 18, height: 18, color: 'var(--edge)' };
      return {
        id: c.ref,
        type: 'zark',
        source: c.from,
        target: c.to,
        sourceHandle: from,
        targetHandle: to,
        markerEnd: marker,
        markerStart: c.conn.direction === 'bidirectional' ? marker : undefined,
        selectable: false,
        data: { ref: c.ref, conn: c, spec: { shape: 'auto' }, inherited: false, label: c.conn.label, bidirectional: c.conn.direction === 'bidirectional', dim: false, pulse: false, animate: false, obstacles, shift: k * 32 } satisfies EdgeData,
      };
    });
    return { nodes, edges };
  }, [positions, sub, index, catalog, center]);

  // Local copy so React Flow can store node measurements; without them it draws no connectors.
  const [nodes, setNodes] = useState<Node[]>([]);
  useEffect(() => setNodes(graph.nodes), [graph.nodes]);

  if (error) return <div className="grid h-full place-items-center text-[13px] text-[var(--danger)]">Falha no layout: {error}</div>;
  if (!positions) return <div className="grid h-full place-items-center text-[13px] text-[var(--muted)]">Organizando…</div>;
  return (
    <ReactFlow
      key={`${center}-${levels}`}
      nodes={nodes}
      edges={graph.edges}
      onNodesChange={(changes) => setNodes((cur) => applyNodeChanges(changes, cur))}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      // Handles are all `source`; Loose lets them act as targets too (as on the main canvas).
      connectionMode={ConnectionMode.Loose}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, node) => {
        // Open the entity where it is drawn; otherwise keep the user here.
        const s = useStore.getState();
        const where = s.index?.entityDrawings.get(node.id)?.[0];
        if (!where) return s.toast(`${s.index?.name(node.id)} não aparece em nenhum desenho`);
        s.openDrawing(where);
        s.select([node.id]);
        s.requestFocus();
      }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="var(--dots)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function DepsView() {
  const index = useStore((s) => s.index)!;
  const depsOf = useStore((s) => s.depsOf);
  const levels = useStore((s) => s.depsLevels);
  const set = useStore((s) => s.set);
  const entities = [...index.entities.values()].sort((a, b) => a.name.localeCompare(b.name));
  const center = depsOf && index.entities.has(depsOf) ? depsOf : undefined;
  const sub = center ? dependencySubgraph(index, center, levels) : undefined;
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2.5">
        <h2 className="text-[14px] font-semibold text-[var(--fg)]">Dependências</h2>
        <select aria-label="Entidade central" className={`${inputClass} !w-[240px]`} value={center ?? ''} onChange={(e) => set({ depsOf: e.target.value || undefined })}>
          <option value="">Escolha uma entidade</option>
          {entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <div role="radiogroup" aria-label="Níveis" className="flex items-center gap-1 text-[12.5px] text-[var(--muted)]">
          Níveis
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={levels === n}
              onClick={() => set({ depsLevels: n })}
              className={`grid size-7 place-items-center rounded-md font-medium ${levels === n ? 'bg-[var(--accent)] text-white' : 'hover:bg-[var(--hover)]'}`}
            >
              {n}
            </button>
          ))}
        </div>
        {sub && (
          <span className="text-[12px] text-[var(--muted)]">
            {sub.entities.length - 1} entidades e {sub.edges.length} conexões ligadas a {index.name(center!)}. Clique numa caixa para abri-la no desenho.
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {center ? (
          <ReactFlowProvider>
            <DepsGraph center={center} levels={levels} />
          </ReactFlowProvider>
        ) : (
          <div className="grid h-full place-items-center text-[13px] text-[var(--muted)]">Escolha uma entidade para ver o que chega nela e o que sai dela.</div>
        )}
      </div>
    </div>
  );
}
