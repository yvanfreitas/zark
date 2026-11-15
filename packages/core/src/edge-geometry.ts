// Connector geometry shared by the canvas, the PNG render route and the
// validator (pure, no Node imports): anchors, routes, label points, label
// boxes and automatic label placement. Keeping one implementation is what
// makes "the validator says these labels overlap" match the picture.
import { routeOrthogonal, type Pt, type Rect, type Side } from './route.js';
import type { DrawingEdge } from './schema.js';

export type { Pt, Rect, Side };

/** React Flow puts the connector end 3.5 px outside the box border, mid side (measured). */
export const HANDLE_OUT = 3.5;
/** Stub before the first bend of a step route, px. */
const STEP_OFFSET = 24;

// ---------- label box ----------

/**
 * Advance widths of Inter (embedded UI font) at 11px, measured in Chromium
 * with canvas measureText. A label pill is text + 22 px (padding and border),
 * 26 px tall, capped at 220 px wide (the CSS truncates beyond that).
 * Ceiling: kerning is ignored (measured error <= 0.5 px on real labels);
 * characters outside the table count as 6.6 px, or 11 px (one em) above
 * U+2E7F (CJK, emoji), so those labels are estimated, not measured.
 */
const CHAR_WIDTH: Record<string, number> = {
  ' ': 3.09, '!': 3.16, '"': 5.12, '#': 6.97, $: 7.06, '%': 10.8, '&': 7.08, "'": 3.3, '(': 4.01, ')': 4.01, '*': 5.51, '+': 7.28, ',': 3.17, '-': 5.06, '.': 3.17, '/': 3.96,
  0: 6.94, 1: 4.47, 2: 6.71, 3: 6.79, 4: 7.11, 5: 6.53, 6: 6.82, 7: 6.23, 8: 6.81, 9: 6.82, ':': 3.17, ';': 3.32, '<': 7.28, '=': 7.28, '>': 7.28, '?': 5.62, '@': 10.62,
  A: 7.59, B: 7.2, C: 8.04, D: 7.94, E: 6.61, F: 6.49, G: 8.21, H: 8.17, I: 2.95, J: 6.28, K: 7.39, L: 6.22, M: 9.94, N: 8.29, O: 8.41, P: 7.03, Q: 8.41, R: 7.08, S: 7.06, T: 7.1, U: 8.19, V: 7.59, W: 10.84, X: 7.5, Y: 7.47, Z: 6.92,
  '[': 4.01, '\\': 3.96, ']': 4.01, '^': 5.18, _: 5.02, '`': 3.55,
  a: 6.18, b: 6.74, c: 6.28, d: 6.74, e: 6.41, f: 4.07, g: 6.75, h: 6.5, i: 2.66, j: 2.66, k: 6.04, l: 2.66, m: 9.64, n: 6.5, o: 6.6, p: 6.74, q: 6.74, r: 4.14, s: 5.81, t: 3.6, u: 6.5, v: 6.18, w: 9, x: 6, y: 6.18, z: 6.07,
  '{': 4.69, '|': 3.66, '}': 4.69, '~': 7.28, '–': 5.5, '—': 11, '…': 9.51, '·': 3.17, '•': 6.19, '→': 9.49, '←': 9.49,
};
const ACCENT_BASE: Record<string, string> = { à: 'a', á: 'a', â: 'a', ã: 'a', ä: 'a', ç: 'c', è: 'e', é: 'e', ê: 'e', ë: 'e', ì: 'i', í: 'i', î: 'i', ï: 'i', ñ: 'n', ò: 'o', ó: 'o', ô: 'o', õ: 'o', ö: 'o', ù: 'u', ú: 'u', û: 'u', ü: 'u' };
export const LABEL_PAD = 22;
export const LABEL_H = 26;
export const LABEL_MAX_W = 220;

function charWidth(c: string): number {
  const direct = CHAR_WIDTH[c];
  if (direct !== undefined) return direct;
  const lower = c.toLowerCase();
  const base = ACCENT_BASE[lower];
  if (base) return lower === c ? CHAR_WIDTH[base] : CHAR_WIDTH[base.toUpperCase()];
  return c.codePointAt(0)! > 0x2e7f ? 11 : 6.6;
}

/** Estimated label pill size in px (see CHAR_WIDTH for the model and its ceiling). */
export function labelSize(text: string): { w: number; h: number } {
  if (!text) return { w: 0, h: 0 };
  let w = LABEL_PAD;
  for (const c of text) w += charWidth(c);
  return { w: Math.min(LABEL_MAX_W, Math.round(w * 10) / 10), h: LABEL_H };
}

// ---------- routes ----------

const DIR: Record<Side, Pt> = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
const horizontal = (s: Side) => s === 'left' || s === 'right';

/** Same rule the canvas uses when an edge has no explicit `from`/`to`. */
export function autoSide(a: Rect, b: Rect): [Side, Side] {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  if (Math.abs(dx) * 0.75 >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
}

/** Connector end on a box side (mid side, HANDLE_OUT outside the border). */
export function anchor(r: Rect, side: Side): Pt {
  const [dx, dy] = DIR[side];
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  return [cx + dx * (r.w / 2 + HANDLE_OUT), cy + dy * (r.h / 2 + HANDLE_OUT)];
}

/** Orthogonal route from s to t leaving/entering along the anchor sides. */
export function stepRoute(s: Pt, sp: Side, t: Pt, tp: Side, points: Pt[], mid = 0): Pt[] {
  const [sdx, sdy] = DIR[sp];
  const [tdx, tdy] = DIR[tp];
  const s1: Pt = [s[0] + sdx * STEP_OFFSET, s[1] + sdy * STEP_OFFSET];
  const t1: Pt = [t[0] + tdx * STEP_OFFSET, t[1] + tdy * STEP_OFFSET];
  if (points.length) {
    const route: Pt[] = [s, s1];
    let prev = s1;
    let h = horizontal(sp);
    for (const p of [...points, t1]) {
      if (prev[0] !== p[0] && prev[1] !== p[1]) route.push(h ? [p[0], prev[1]] : [prev[0], p[1]]);
      route.push(p);
      h = !h;
      prev = p;
    }
    route.push(t);
    return route;
  }
  if (horizontal(sp) && horizontal(tp)) {
    const mx = (s1[0] + t1[0]) / 2 + mid;
    return [s, s1, [mx, s1[1]], [mx, t1[1]], t1, t];
  }
  if (!horizontal(sp) && !horizontal(tp)) {
    const my = (s1[1] + t1[1]) / 2 + mid;
    return [s, s1, [s1[0], my], [t1[0], my], t1, t];
  }
  return horizontal(sp) ? [s, s1, [t1[0], s1[1]], t1, t] : [s, s1, [s1[0], t1[1]], t1, t];
}

/** React Flow's default bezier (curvature 0.25), sampled as a polyline. */
export function bezierRoute(s: Pt, sp: Side, t: Pt, tp: Side, samples = 32): Pt[] {
  const offset = (d: number) => (d >= 0 ? 0.5 * d : 0.25 * 25 * Math.sqrt(-d));
  const control = (p: Pt, side: Side, q: Pt): Pt => {
    if (side === 'left') return [p[0] - offset(p[0] - q[0]), p[1]];
    if (side === 'right') return [p[0] + offset(q[0] - p[0]), p[1]];
    if (side === 'top') return [p[0], p[1] - offset(p[1] - q[1])];
    return [p[0], p[1] + offset(q[1] - p[1])];
  };
  const c1 = control(s, sp, t);
  const c2 = control(t, tp, s);
  const out: Pt[] = [];
  for (let i = 0; i <= samples; i++) {
    const u = i / samples, v = 1 - u;
    out.push([
      v * v * v * s[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * t[0],
      v * v * v * s[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * t[1],
    ]);
  }
  return out;
}

const routeCache = new WeakMap<object, Map<string, Pt[]>>();

/**
 * Sideways offsets of one connector: `s`/`t` slide each end along its box
 * side (px) so no two ends share a point on a side, `mid` moves the middle
 * segment of a step route so parallel corridors between the same two boxes
 * don't cross.
 */
export interface EdgeOffsets {
  s: number;
  t: number;
  mid: number;
  /** `auto` only: interior vertical / horizontal corridors move by these (px). */
  ix?: number;
  iy?: number;
  /** `auto` only: route from the target end and reverse, so a group shares one corridor shape. */
  flip?: boolean;
}
export const NO_OFFSETS: EdgeOffsets = { s: 0, t: 0, mid: 0 };

/** Moves interior segments of an orthogonal route (not the end stubs): vertical ones by ix, horizontal ones by iy. */
function shiftCorridors(route: Pt[], ix: number, iy: number): Pt[] {
  if ((!ix && !iy) || route.length < 4) return route;
  const out = route.map((p) => [p[0], p[1]] as Pt);
  for (let i = 1; i < route.length - 2; i++) {
    const [a, b] = [route[i], route[i + 1]];
    if (a[0] === b[0]) (out[i][0] = a[0] + ix), (out[i + 1][0] = b[0] + ix);
    else if (a[1] === b[1]) (out[i][1] = a[1] + iy), (out[i + 1][1] = b[1] + iy);
  }
  return out;
}

/** An end slid along its side: y on left/right sides, x on top/bottom. */
export function slide(p: Pt, side: Side, by: number): Pt {
  return horizontal(side) ? [p[0], p[1] + by] : [p[0] + by, p[1]];
}

/** `auto` route around `obstacles` between already slid ends; memoized per obstacle list. */
export function autoRoute(s: Pt, sp: Side, t: Pt, tp: Side, obstacles: Rect[]): Pt[] {
  let cache = routeCache.get(obstacles);
  if (!cache) routeCache.set(obstacles, (cache = new Map()));
  const key = `${s[0]},${s[1]},${sp},${t[0]},${t[1]},${tp}`;
  let route = cache.get(key);
  if (!route) {
    route = routeOrthogonal(s, sp, t, tp, obstacles, { margin: 16, stub: 24 }) ?? stepRoute(s, sp, t, tp, []);
    cache.set(key, route);
  }
  return route;
}

/** The connector's two ends after the parallel offsets (what every shape starts from). */
export function edgeEnds(s: Pt, sp: Side, t: Pt, tp: Side, offsets: EdgeOffsets = NO_OFFSETS): [Pt, Pt] {
  return [slide(s, sp, offsets.s), slide(t, tp, offsets.t)];
}

/**
 * Route for an edge spec between two anchors (what the canvas draws, as a
 * polyline). Parallel offsets apply to every shape; explicit `points` keep
 * their manual bends and only the ends slide.
 */
export function edgeRoute(spec: DrawingEdge, s0: Pt, sp: Side, t0: Pt, tp: Side, obstacles: Rect[], offsets: EdgeOffsets = NO_OFFSETS): Pt[] {
  const shape = spec.shape ?? 'straight';
  const points = (spec.points ?? []) as Pt[];
  const [s, t] = edgeEnds(s0, sp, t0, tp, offsets);
  if (shape === 'curved' && !points.length) return bezierRoute(s, sp, t, tp);
  if (shape === 'auto') {
    const r = offsets.flip ? [...autoRoute(t, tp, s, sp, obstacles)].reverse() : autoRoute(s, sp, t, tp, obstacles);
    return shiftCorridors(r, offsets.ix ?? 0, offsets.iy ?? 0);
  }
  if (shape === 'step') return stepRoute(s, sp, t, tp, points, points.length ? 0 : offsets.mid);
  return [s, ...points, t];
}

/** Spacing between parallel connectors, px (shrinks to fit short box sides). */
export const PARALLEL_SPACING = 18;
/** Ends stay this far inside the box side, px. */
const SIDE_MARGIN = 10;

const sideLength = (r: Rect, side: Side) => (horizontal(side) ? r.h : r.w);
const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/**
 * Offsets for connector `k` of `n` between boxes `a` (first) and `b`, with
 * sides `sa`/`sb` seen from `a`. Same-axis sides slide both ends by the same
 * amount (parallel lines); mixed sides nest like L shapes, so the far end
 * slides the opposite way when needed to keep lines from crossing. Step
 * routes move their middle segment so the inner corridor turns first.
 */
export function parallelOffsets(k: number, n: number, a: Rect, sa: Side, b: Rect, sb: Side): { a: number; b: number; mid: number; ix: number; iy: number } {
  if (n < 2) return { a: 0, b: 0, mid: 0, ix: 0, iy: 0 };
  const room = Math.max(0, Math.min(sideLength(a, sa), sideLength(b, sb)) - 2 * SIDE_MARGIN);
  const spacing = Math.min(PARALLEL_SPACING, room / (n - 1));
  const o = (k - (n - 1) / 2) * spacing;
  const pa = anchor(a, sa), pb = anchor(b, sb);
  const dx = pb[0] - pa[0], dy = pb[1] - pa[1];
  // Interior corridors of orthogonal routes: the line offset towards the turn turns first.
  const ix = -o * sign(dy) * sign(dx || 1);
  const iy = -o * sign(dx) * sign(dy || 1);
  if (horizontal(sa) === horizontal(sb)) return { a: o, b: o, mid: horizontal(sa) ? ix : iy, ix, iy };
  return { a: o, b: -o * sign(dx || 1) * sign(dy || 1), mid: 0, ix, iy };
}

/** Point at fraction `f` (0..1) of the polyline length. */
export function pointAt(route: Pt[], f: number): Pt {
  const lens = route.slice(1).map((p, i) => Math.hypot(p[0] - route[i][0], p[1] - route[i][1]));
  let left = lens.reduce((a, b) => a + b, 0) * f;
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i] || i === lens.length - 1) {
      const k = lens[i] ? left / lens[i] : 0;
      return [route[i][0] + (route[i + 1][0] - route[i][0]) * k, route[i][1] + (route[i + 1][1] - route[i][1]) * k];
    }
    left -= lens[i];
  }
  return route[0];
}

/** Fractions of the route length at each segment's midpoint. */
function segmentMidFractions(route: Pt[]): number[] {
  const lens = route.slice(1).map((p, i) => Math.hypot(p[0] - route[i][0], p[1] - route[i][1]));
  const total = lens.reduce((a, b) => a + b, 0);
  if (!total) return [];
  const out: number[] = [];
  let acc = 0;
  for (const l of lens) {
    if (l > 1) out.push((acc + l / 2) / total);
    acc += l;
  }
  return out;
}

/** Evenly spaced offsets for `n` ends on a side of length `len`, centred on zero. */
function sideSlots(n: number, len: number): number[] {
  if (n < 2) return [0];
  const spacing = Math.min(PARALLEL_SPACING, Math.max(0, len - 2 * SIDE_MARGIN) / (n - 1));
  return Array.from({ length: n }, (_, k) => (k - (n - 1) / 2) * spacing);
}

/**
 * Every end landing on the same box side gets its own point along it. Ends
 * are ordered by where the other end sits along the side's axis, so lines
 * fan out without crossing; ends whose other end is the same anchor (same
 * pair) keep the relative order of their parallel offsets, which already
 * nest and run side by side. Replaces `s`/`t` in `fan`, keeps `mid`/`ix`/`iy`/`flip`.
 */
function spreadEnds(usable: GeometryEdge[], byId: Map<string, GeometryBox>, sides: Map<string, [Side, Side]>, fan: Map<string, { offsets: EdgeOffsets; at?: number }>) {
  interface End { ref: string; role: 's' | 't'; key: number; pair: number }
  const perSide = new Map<string, End[]>();
  for (const e of usable) {
    const [ss, ts] = sides.get(e.ref)!;
    const pa = anchor(byId.get(e.source)!, ss), pb = anchor(byId.get(e.target)!, ts);
    const offsets = fan.get(e.ref)!.offsets;
    const add = (box: string, side: Side, end: End) => {
      const k = `${box}:${side}`;
      perSide.set(k, [...(perSide.get(k) ?? []), end]);
    };
    add(e.source, ss, { ref: e.ref, role: 's', key: horizontal(ss) ? pb[1] : pb[0], pair: offsets.s });
    add(e.target, ts, { ref: e.ref, role: 't', key: horizontal(ts) ? pa[1] : pa[0], pair: offsets.t });
  }
  for (const [k, ends] of perSide) {
    const sep = k.lastIndexOf(':');
    const side = k.slice(sep + 1) as Side;
    ends.sort((x, y) => x.key - y.key || x.pair - y.pair || x.ref.localeCompare(y.ref) || x.role.localeCompare(y.role));
    const slots = sideSlots(ends.length, sideLength(byId.get(k.slice(0, sep))!, side));
    ends.forEach((end, i) => (fan.get(end.ref)!.offsets[end.role] = slots[i]));
  }
}

// ---------- whole drawing ----------

export interface GeometryBox extends Rect {
  id: string;
  /** Expanded containers are frames: connectors and labels may sit on them. */
  expanded?: boolean;
}

export interface GeometryEdge {
  ref: string;
  /** Placed box ids the connector is drawn between (already resolved to ancestors). */
  source: string;
  target: string;
  spec: DrawingEdge;
  label: string;
}

export interface EdgeGeometry {
  ref: string;
  sourceSide: Side;
  targetSide: Side;
  /** Sideways offsets: ends spread along shared box sides, corridors of parallel connectors. */
  offsets: EdgeOffsets;
  route: Pt[];
  /** Final label position: explicit `labelAt`, or the automatic placement. */
  labelAt: number;
  /** Placement default before collision avoidance (fan-out fraction or 0.5). */
  defaultLabelAt: number;
  explicit: boolean;
  /** Label box (centre-based), absent for empty labels. */
  labelBox?: Rect;
}

export interface LabelOverlap {
  ref: string;
  with: { kind: 'label'; ref: string } | { kind: 'box'; id: string };
}

const CANDIDATES = [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9];
const GAP = 2;

const boxAt = (p: Pt, size: { w: number; h: number }): Rect => ({ x: p[0] - size.w / 2, y: p[1] - size.h / 2, w: size.w, h: size.h });
const intersects = (a: Rect, b: Rect, g = 0) => a.x < b.x + b.w + g && b.x < a.x + a.w + g && a.y < b.y + b.h + g && b.y < a.y + a.h + g;
const area = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const centreInside = (r: Rect, b: Rect) => r.x + r.w / 2 > b.x && r.x + r.w / 2 < b.x + b.w && r.y + r.h / 2 > b.y && r.y + r.h / 2 < b.y + b.h;

/** Boxes a label of `e` must not cover: other non-container boxes; its own ends only when its centre lands inside. */
function blocks(label: Rect, e: GeometryEdge, boxes: GeometryBox[]): GeometryBox | undefined {
  for (const b of boxes) {
    if (b.expanded) continue;
    if (b.id === e.source || b.id === e.target) {
      if (centreInside(label, b)) return b;
      continue;
    }
    if (intersects(label, b)) return b;
  }
  return undefined;
}

/**
 * Routes every connector and places every label: explicit `labelAt` first,
 * then the rest in ref order, each at the first candidate fraction whose
 * label box clears other boxes and already placed labels (least overlap
 * when none is free). Deterministic for a given drawing.
 */
export function drawingGeometry(boxes: GeometryBox[], edges: GeometryEdge[], opts: { ignoreExplicit?: Set<string> } = {}): Map<string, EdgeGeometry> {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const obstacles: Rect[] = boxes.filter((b) => !b.expanded).map(({ x, y, w, h }) => ({ x, y, w, h }));
  const out = new Map<string, EdgeGeometry>();
  const usable = edges.filter((e) => byId.has(e.source) && byId.has(e.target) && e.source !== e.target).sort((a, b) => a.ref.localeCompare(b.ref));

  // Connectors between the same two boxes (any shape, either direction, inherited
  // ones included once resolved to their placed ancestors) run side by side.
  const sides = new Map<string, [Side, Side]>();
  const groups = new Map<string, GeometryEdge[]>();
  for (const e of usable) {
    const a = byId.get(e.source)!, b = byId.get(e.target)!;
    const [autoFrom, autoTo] = autoSide(a, b);
    const ss = (e.spec.from ?? autoFrom) as Side;
    const ts = (e.spec.to ?? autoTo) as Side;
    sides.set(e.ref, [ss, ts]);
    // Keyed from the alphabetically first box, so A->B and B->A share a group.
    const key = e.source < e.target ? `${e.source}:${ss}|${e.target}:${ts}` : `${e.target}:${ts}|${e.source}:${ss}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const fan = new Map<string, { offsets: EdgeOffsets; at?: number }>();
  for (const group of groups.values()) {
    group.forEach((e, k) => {
      const forward = e.source < e.target;
      const [ss, ts] = sides.get(e.ref)!;
      const [first, second] = forward ? [e.source, e.target] : [e.target, e.source];
      const [fs, ns] = forward ? [ss, ts] : [ts, ss];
      const o = parallelOffsets(k, group.length, byId.get(first)!, fs, byId.get(second)!, ns);
      // The middle offset is absolute, so it holds for both directions.
      // Corridor offsets are absolute; `auto` routes of a group all start from the first box.
      const offsets: EdgeOffsets = forward ? { s: o.a, t: o.b, mid: o.mid } : { s: o.b, t: o.a, mid: o.mid };
      if (group.length > 1) Object.assign(offsets, { ix: o.ix, iy: o.iy, ...(forward ? {} : { flip: true }) });
      // Labels stagger along the line, fractions measured from the first box.
      const frac = group.length > 1 ? 0.3 + (0.4 * k) / (group.length - 1) : undefined;
      fan.set(e.ref, { offsets, at: frac === undefined ? undefined : forward ? frac : 1 - frac });
    });
  }
  spreadEnds(usable, byId, sides, fan);

  for (const e of usable) {
    const a = byId.get(e.source)!, b = byId.get(e.target)!;
    const [sourceSide, targetSide] = sides.get(e.ref)!;
    const offsets = fan.get(e.ref)?.offsets ?? NO_OFFSETS;
    const route = edgeRoute(e.spec, anchor(a, sourceSide), sourceSide, anchor(b, targetSide), targetSide, obstacles, offsets);
    const defaultLabelAt = fan.get(e.ref)?.at ?? 0.5;
    const explicit = e.spec.labelAt !== undefined && !opts.ignoreExplicit?.has(e.ref);
    out.set(e.ref, { ref: e.ref, sourceSide, targetSide, offsets, route, defaultLabelAt, explicit, labelAt: explicit ? e.spec.labelAt! : defaultLabelAt });
  }

  const placed: Rect[] = [];
  const place = (e: GeometryEdge, g: EdgeGeometry) => {
    const size = labelSize(e.label);
    if (!size.w) return;
    if (!g.explicit) {
      const fractions = [...new Set([g.defaultLabelAt, ...CANDIDATES, ...segmentMidFractions(g.route)].map((f) => Math.round(f * 1000) / 1000))];
      let best = { f: g.defaultLabelAt, cost: Infinity };
      for (const f of fractions) {
        const box = boxAt(pointAt(g.route, f), size);
        const hitBox = blocks(box, e, boxes);
        const cost = (hitBox ? area(box, hitBox) + 1 : 0) + placed.reduce((s, p) => s + (intersects(box, p, GAP) ? area(box, p) + 1 : 0), 0);
        if (cost < best.cost) best = { f, cost };
        if (cost === 0) break;
      }
      g.labelAt = best.f;
    }
    g.labelBox = boxAt(pointAt(g.route, g.labelAt), size);
    placed.push(g.labelBox);
  };
  for (const e of usable) if (out.get(e.ref)!.explicit) place(e, out.get(e.ref)!);
  for (const e of usable) if (!out.get(e.ref)!.explicit) place(e, out.get(e.ref)!);
  return out;
}

/** Label-label and label-box overlaps in a placed drawing (each pair reported once). */
export function labelOverlaps(boxes: GeometryBox[], edges: GeometryEdge[], geometry: Map<string, EdgeGeometry>): LabelOverlap[] {
  const out: LabelOverlap[] = [];
  const list = edges.filter((e) => geometry.get(e.ref)?.labelBox).sort((a, b) => a.ref.localeCompare(b.ref));
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const box = geometry.get(e.ref)!.labelBox!;
    const hit = blocks(box, e, boxes);
    if (hit) out.push({ ref: e.ref, with: { kind: 'box', id: hit.id } });
    for (let j = i + 1; j < list.length; j++) {
      if (intersects(box, geometry.get(list[j].ref)!.labelBox!)) out.push({ ref: e.ref, with: { kind: 'label', ref: list[j].ref } });
    }
  }
  return out;
}
