// Orthogonal connector routing around boxes (pure; shared by UI and render).
//
// A* over a sparse orthogonal visibility graph: candidate x/y lines come from
// the endpoints' exit points and from every nearby obstacle edge pushed out by
// a margin. Cost = length + a penalty per bend, so routes stay short and calm.

export type Pt = [number, number];
export type Side = 'top' | 'right' | 'bottom' | 'left';
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RouteOptions {
  /** Clearance kept from every obstacle, px. */
  margin?: number;
  /** Straight stub leaving/entering a box before the first bend, px. */
  stub?: number;
  /** Cost of one bend, in px of length. */
  bendPenalty?: number;
  /** Obstacles farther than this from the endpoints' box are ignored on the first try, px. */
  window?: number;
}

const DIR: Record<Side, Pt> = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };

/** Point strictly inside `r` grown by `g`. */
function inside(p: Pt, r: Rect, g: number) {
  return p[0] > r.x - g && p[0] < r.x + r.w + g && p[1] > r.y - g && p[1] < r.y + r.h + g;
}

/** Axis-aligned segment a-b crosses the interior of `r` grown by `g`. */
function crosses(a: Pt, b: Pt, r: Rect, g: number) {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  return x0 < r.x + r.w + g && x1 > r.x - g && y0 < r.y + r.h + g && y1 > r.y - g;
}

/** Minimal binary heap on [priority, tiebreak, value]. */
class Heap {
  private items: [number, number, number][] = [];
  get size() {
    return this.items.length;
  }
  push(item: [number, number, number]) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(a[p], a[i])) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number, number] {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}
const less = (a: [number, number, number], b: [number, number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

function search(s1: Pt, t1: Pt, obstacles: Rect[], margin: number, bend: number): Pt[] | null {
  const g = margin - 1;
  const uniq = (v: number[]) => [...new Set(v.map((n) => Math.round(n)))].sort((p, q) => p - q);
  const xs = uniq([s1[0], t1[0], ...obstacles.flatMap((r) => [r.x - margin, r.x + r.w + margin])]);
  const ys = uniq([s1[1], t1[1], ...obstacles.flatMap((r) => [r.y - margin, r.y + r.h + margin])]);
  const W = xs.length;
  const id = (i: number, j: number) => j * W + i;
  const free = (p: Pt) => !obstacles.some((r) => inside(p, r, g));
  const si = xs.indexOf(Math.round(s1[0])), sj = ys.indexOf(Math.round(s1[1]));
  const ti = xs.indexOf(Math.round(t1[0])), tj = ys.indexOf(Math.round(t1[1]));
  if (!free(s1) || !free(t1)) return null;

  // state = node * 3 + axis (0 none, 1 horizontal, 2 vertical)
  const best = new Map<number, number>();
  const prev = new Map<number, number>();
  const heap = new Heap();
  let seq = 0;
  const h = (i: number, j: number) => Math.abs(xs[i] - xs[ti]) + Math.abs(ys[j] - ys[tj]);
  const start = id(si, sj) * 3;
  best.set(start, 0);
  heap.push([h(si, sj), seq++, start]);
  const goal = id(ti, tj);
  while (heap.size) {
    const [f, , state] = heap.pop();
    const node = Math.floor(state / 3), axis = state % 3;
    const cost = best.get(state)!;
    if (f - h(node % W, Math.floor(node / W)) > cost + 1e-9) continue;
    if (node === goal) {
      const out: Pt[] = [];
      for (let s: number | undefined = state; s !== undefined; s = prev.get(s)) {
        const n = Math.floor(s / 3);
        out.push([xs[n % W], ys[Math.floor(n / W)]]);
      }
      return out.reverse();
    }
    const i = node % W, j = Math.floor(node / W);
    const here: Pt = [xs[i], ys[j]];
    for (const [di, dj, ax] of [[1, 0, 1], [-1, 0, 1], [0, 1, 2], [0, -1, 2]] as const) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= ys.length) continue;
      const next: Pt = [xs[ni], ys[nj]];
      if (obstacles.some((r) => crosses(here, next, r, g))) continue;
      const c = cost + Math.abs(next[0] - here[0]) + Math.abs(next[1] - here[1]) + (axis && axis !== ax ? bend : 0);
      const ns = id(ni, nj) * 3 + ax;
      if (c < (best.get(ns) ?? Infinity)) {
        best.set(ns, c);
        prev.set(ns, state);
        heap.push([c + h(ni, nj), seq++, ns]);
      }
    }
  }
  return null;
}

/** Drops points that lie on a straight line between their neighbours. */
function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (out.length && out[out.length - 1][0] === p[0] && out[out.length - 1][1] === p[1]) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2], b = out[out.length - 1];
      if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) out.pop();
    }
    out.push(p);
  }
  return out;
}

/**
 * Orthogonal route from `source` (on the `sourceSide` of its box) to `target`,
 * avoiding `obstacles`. Returns the full polyline including both endpoints, or
 * null when no route exists (the caller falls back to a simple step route).
 */
export function routeOrthogonal(source: Pt, sourceSide: Side, target: Pt, targetSide: Side, obstacles: Rect[], opts: RouteOptions = {}): Pt[] | null {
  const margin = opts.margin ?? 16;
  const stub = Math.max(opts.stub ?? 24, margin);
  const bend = opts.bendPenalty ?? 40;
  const win = opts.window ?? 320;
  const [sdx, sdy] = DIR[sourceSide];
  const [tdx, tdy] = DIR[targetSide];
  const s1: Pt = [Math.round(source[0] + sdx * stub), Math.round(source[1] + sdy * stub)];
  const t1: Pt = [Math.round(target[0] + tdx * stub), Math.round(target[1] + tdy * stub)];
  const box: Rect = {
    x: Math.min(s1[0], t1[0]) - win,
    y: Math.min(s1[1], t1[1]) - win,
    w: Math.abs(s1[0] - t1[0]) + 2 * win,
    h: Math.abs(s1[1] - t1[1]) + 2 * win,
  };
  const near = obstacles.filter((r) => r.x < box.x + box.w && r.x + r.w > box.x && r.y < box.y + box.h && r.y + r.h > box.y);
  const mid = search(s1, t1, near, margin, bend) ?? (near.length < obstacles.length ? search(s1, t1, obstacles, margin, bend) : null);
  if (!mid) return null;
  return simplify([source, ...mid, target]);
}
