import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { Index } from '../model';
import type { Conn, Drawing, DrawingEdge, Entity, Problem } from '../types';
import type { FilterState } from '../store';
import type { Rect } from '@core/route';

export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface EntityData extends Record<string, unknown> {
  entity: Entity;
  hasInner: boolean;
  severity?: 'error' | 'warning';
  expanded: boolean;
  dim: boolean;
  techName?: string;
  techIcon?: string;
  inActiveFlow: boolean;
  interactive: boolean;
  resizable: boolean;
}

export interface EdgeData extends Record<string, unknown> {
  ref: string;
  conn: Conn;
  spec: DrawingEdge;
  inherited: boolean;
  label: string;
  bidirectional: boolean;
  dim: boolean;
  /** Flow mode: this connection carries the active step. */
  active?: { backwards: boolean; text: string; number: string; reply: boolean }[];
  pulse: boolean;
  /** Boxes an `auto` connector routes around (shared across edges; absolute coords). */
  obstacles: Rect[];
  /** Sideways shift of an `auto` connector so parallel ones between the same boxes don't overlap, px. */
  shift: number;
  /** Default label position for fanned-out connectors, so their labels don't stack. */
  labelAt?: number;
  severity?: 'error' | 'warning';
  animate: boolean;
}

export interface BuildOptions {
  problems: Problem[];
  filters: Record<string, FilterState>;
  selection: string[];
  /** ref -> active steps in the current flow frame. */
  activeSteps?: Map<string, NonNullable<EdgeData['active']>>;
  /** Connections and entities that take part in the open flow. */
  flowRefs?: Set<string>;
  interactive: boolean;
  animate: boolean;
}

const GROUP_PAD = 24;
const GROUP_LABEL = 28;

/** Which filter chips match an entity: `tag:x`, `tech:x`, `status:x`, `team:x`. */
function chipsOf(e: Entity): string[] {
  return [
    ...(e.tags ?? []).map((t) => `tag:${t}`),
    ...(e.technologies ?? []).map((t) => `tech:${t}`),
    `status:${e.status ?? 'live'}`,
    ...(e.owner ? [`team:${e.owner}`] : []),
  ];
}

export function autoSide(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): [Side, Side] {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  if (Math.abs(dx) * 0.75 >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
}

export function buildGraph(index: Index, drawing: Drawing, catalog: { technologies?: { id: string; name: string; icon?: string }[] }, opts: BuildOptions) {
  const placed = drawing.nodes ?? {};
  const ids = Object.keys(placed).filter((id) => index.entities.has(id));
  const rect = (id: string) => ({ x: placed[id].x, y: placed[id].y, ...index.size(id, placed[id]) });

  // Severity per ref for problem markers.
  const severity = new Map<string, 'error' | 'warning'>();
  for (const p of opts.problems) if (p.ref && severity.get(p.ref) !== 'error') severity.set(p.ref, p.severity);

  // Filters: "hide" removes, "highlight" dims everything that doesn't match.
  const hidden = Object.entries(opts.filters).filter(([, s]) => s === 'hide').map(([k]) => k);
  const highlighted = Object.entries(opts.filters).filter(([, s]) => s === 'highlight').map(([k]) => k);
  const visible = ids.filter((id) => !chipsOf(index.entities.get(id)!).some((c) => hidden.includes(c)));
  const visibleSet = new Set(visible);
  const matchesHighlight = (id: string) => !highlighted.length || chipsOf(index.entities.get(id)!).some((c) => highlighted.includes(c));

  // Selection pulse: outgoing connections of the selected entity.
  const selected = new Set(opts.selection);
  const flowEntities = new Set<string>();
  if (opts.flowRefs) for (const ref of opts.flowRefs) {
    const c = index.conns.get(ref);
    if (c) [index.resolve(drawing, c.from), index.resolve(drawing, c.to)].forEach((e) => e && flowEntities.add(e));
  }
  const pulseFrom = new Set([...selected].filter((s) => index.entities.has(s)));

  const containerOf = (id: string) => index.ancestors(id).slice(1).find((a) => visibleSet.has(a) && placed[a]?.expanded);
  const depth = (id: string) => index.ancestors(id).filter((a) => visibleSet.has(a)).length;
  const techs = new Map((catalog.technologies ?? []).map((t) => [t.id, t]));

  const nodes: Node[] = [];

  for (const g of drawing.groups ?? []) {
    const members = g.members.filter((m) => visibleSet.has(m));
    if (!members.length) continue;
    const rs = members.map(rect);
    const x = Math.min(...rs.map((r) => r.x)) - GROUP_PAD;
    const y = Math.min(...rs.map((r) => r.y)) - GROUP_PAD - GROUP_LABEL;
    const w = Math.max(...rs.map((r) => r.x + r.w)) + GROUP_PAD - x;
    const h = Math.max(...rs.map((r) => r.y + r.h)) + GROUP_PAD - y;
    nodes.push({
      id: `group:${g.id}`,
      type: 'frame',
      position: { x, y },
      data: { label: g.label, style: g.style ?? 'dashed' },
      style: { width: w, height: h },
      draggable: false,
      selectable: opts.animate,
      zIndex: -20,
    });
  }

  for (const id of [...visible].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))) {
    const e = index.entities.get(id)!;
    const r = rect(id);
    const parent = containerOf(id);
    const tech = e.technologies?.map((t) => techs.get(t)).find(Boolean);
    const dimByFlow = opts.flowRefs ? !flowEntities.has(id) : false;
    nodes.push({
      id,
      type: 'entity',
      position: parent ? { x: r.x - placed[parent].x, y: r.y - placed[parent].y } : { x: r.x, y: r.y },
      parentId: parent,
      data: {
        entity: e,
        hasInner: !!index.drawingsByScope.get(id)?.length,
        severity: severity.get(id),
        expanded: !!placed[id].expanded,
        dim: dimByFlow || !matchesHighlight(id),
        techName: tech?.name,
        techIcon: tech?.icon,
        inActiveFlow: !!opts.flowRefs && flowEntities.has(id),
        interactive: opts.interactive,
        resizable: opts.interactive && !opts.flowRefs,
      } satisfies EntityData,
      style: { width: r.w, height: r.h },
      zIndex: placed[id].expanded ? -10 + depth(id) : depth(id),
      draggable: opts.interactive && !opts.flowRefs,
      selectable: opts.animate,
    });
  }

  for (const n of drawing.notes ?? []) {
    nodes.push({
      id: `note:${n.id}`,
      type: 'note',
      position: { x: n.x, y: n.y },
      data: { text: n.text },
      style: { width: n.w ?? 200 },
      draggable: opts.interactive && !opts.flowRefs,
      selectable: opts.animate,
      zIndex: 5,
    });
  }

  const edges: Edge[] = [];
  // Expanded containers are frames, not walls: connectors may cross them.
  const obstacles: Rect[] = visible.filter((id) => !placed[id].expanded).map(rect);
  for (const [ref, spec] of Object.entries(drawing.edges ?? {})) {
    const conn = index.conns.get(ref);
    if (!conn) continue;
    const a = index.resolve(drawing, conn.from);
    const b = index.resolve(drawing, conn.to);
    if (!a || !b || a === b || !visibleSet.has(a) || !visibleSet.has(b)) continue;
    const [autoFrom, autoTo] = autoSide(rect(a), rect(b));
    const color = 'var(--edge)';
    const active = opts.activeSteps?.get(ref);
    const bidirectional = conn.conn.direction === 'bidirectional';
    const marker = { type: MarkerType.ArrowClosed, width: 18, height: 18, color: active ? 'var(--accent)' : color };
    edges.push({
      id: ref,
      type: 'zark',
      source: a,
      target: b,
      sourceHandle: spec.from ?? autoFrom,
      targetHandle: spec.to ?? autoTo,
      markerEnd: marker,
      markerStart: bidirectional ? marker : undefined,
      selectable: opts.animate,
      zIndex: active ? 20 : 10,
      data: {
        ref,
        conn,
        spec,
        inherited: a !== conn.from || b !== conn.to,
        label: conn.conn.label,
        bidirectional,
        dim: (opts.flowRefs ? !opts.flowRefs.has(ref) : false) || (!!highlighted.length && !(matchesHighlight(a) || matchesHighlight(b))) || (pulseFrom.size > 0 && !pulseFrom.has(a) && !opts.flowRefs),
        active,
        pulse: pulseFrom.has(a) && !opts.flowRefs,
        severity: severity.get(ref),
        animate: opts.animate,
        obstacles,
        shift: 0,
      } satisfies EdgeData,
    });
  }
  // Parallel `auto` connectors between the same two boxes fan out side by side.
  const pairs = new Map<string, Edge[]>();
  for (const e of edges) {
    if ((e.data as EdgeData).spec.shape !== 'auto') continue;
    const key = [e.source, e.target].sort().join('|');
    pairs.set(key, [...(pairs.get(key) ?? []), e]);
  }
  for (const group of pairs.values()) {
    group.sort((x, y) => x.id.localeCompare(y.id));
    group.forEach((e, k) => {
      const data = e.data as EdgeData;
      data.shift = (k - (group.length - 1) / 2) * 32;
      if (group.length > 1) {
        // Fractions run from the alphabetically first box, whatever each connector's direction.
        const frac = 0.3 + (0.4 * k) / (group.length - 1);
        data.labelAt = e.source < e.target ? frac : 1 - frac;
      }
    });
  }
  return { nodes, edges };
}

/** Bounding box of everything drawn, for render captures and "fit". */
export function drawingBounds(index: Index, drawing: Drawing) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [id, n] of Object.entries(drawing.nodes ?? {})) {
    if (!index.entities.has(id)) continue;
    const s = index.size(id, n);
    xs.push(n.x, n.x + s.w);
    ys.push(n.y, n.y + s.h);
  }
  for (const g of drawing.groups ?? []) {
    const rs = g.members.filter((m) => drawing.nodes?.[m] && index.entities.has(m)).map((m) => ({ ...drawing.nodes![m], ...index.size(m, drawing.nodes![m]) }));
    if (!rs.length) continue;
    xs.push(Math.min(...rs.map((r) => r.x)) - GROUP_PAD, Math.max(...rs.map((r) => r.x + r.w)) + GROUP_PAD);
    ys.push(Math.min(...rs.map((r) => r.y)) - GROUP_PAD - GROUP_LABEL, Math.max(...rs.map((r) => r.y + r.h)) + GROUP_PAD);
  }
  for (const n of drawing.notes ?? []) {
    xs.push(n.x, n.x + (n.w ?? 200));
    ys.push(n.y, n.y + 80);
  }
  for (const e of Object.values(drawing.edges ?? {})) for (const [x, y] of e.points ?? []) {
    xs.push(x);
    ys.push(y);
  }
  if (!xs.length) return { x: 0, y: 0, w: 400, h: 300 };
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
