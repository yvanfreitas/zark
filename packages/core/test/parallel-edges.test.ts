import { describe, expect, it } from 'vitest';
import { drawingGeometry, type GeometryBox, type GeometryEdge, type Pt } from '../src/edge-geometry.js';

type Shape = 'straight' | 'step' | 'curved' | 'auto';
type Seg = [Pt, Pt];

const segs = (route: Pt[]): Seg[] => route.slice(1).map((p, i) => [route[i], p]);
const orient = (a: Pt, b: Pt, c: Pt) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
/** Proper crossing or collinear overlap of length > 1px between two segments. */
function clash([p1, p2]: Seg, [q1, q2]: Seg): boolean {
  const o1 = orient(p1, p2, q1), o2 = orient(p1, p2, q2), o3 = orient(q1, q2, p1), o4 = orient(q1, q2, p2);
  if (o1 !== o2 && o3 !== o4 && o1 && o2 && o3 && o4) return true;
  if (o1 === 0 && o2 === 0) {
    // Collinear: overlap length along the dominant axis.
    const ax = Math.abs(p2[0] - p1[0]) >= Math.abs(p2[1] - p1[1]) ? 0 : 1;
    const lo = Math.max(Math.min(p1[ax], p2[ax]), Math.min(q1[ax], q2[ax]));
    const hi = Math.min(Math.max(p1[ax], p2[ax]), Math.max(q1[ax], q2[ax]));
    return hi - lo > 1;
  }
  return false;
}
const routesClash = (a: Pt[], b: Pt[]) => segs(a).some((s) => segs(b).some((t) => clash(s, t)));

const A: GeometryBox = { id: 'a', x: 0, y: 0, w: 256, h: 128 };
const B: GeometryBox = { id: 'b', x: 600, y: 240, w: 256, h: 128 };
const edge = (ref: string, source: string, target: string, shape: Shape): GeometryEdge => ({ ref, source, target, spec: { shape }, label: '' });

function geometry(shape: Shape, refs: [string, string, string][], boxes: GeometryBox[] = [A, B]) {
  return drawingGeometry(boxes, refs.map(([r, s, t]) => edge(r, s, t, shape)));
}

describe('parallel connectors between the same two boxes', () => {
  for (const shape of ['straight', 'step', 'curved', 'auto'] as Shape[]) {
    for (const n of [2, 3]) {
      it(`${shape}: ${n} connectors, both directions, do not overlap or cross`, () => {
        const refs: [string, string, string][] = [
          ['a.one', 'a', 'b'],
          ['b.two', 'b', 'a'],
          ['a.three', 'a', 'b'],
        ].slice(0, n) as [string, string, string][];
        const g = geometry(shape, refs);
        const routes = refs.map(([r]) => g.get(r)!.route);
        for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) expect(routesClash(routes[i], routes[j]), `${refs[i][0]} vs ${refs[j][0]}`).toBe(false);
      });
    }
  }

  it('keeps a constant spacing between straight parallel lines and the ends inside the box sides', () => {
    const C: GeometryBox = { id: 'c', x: 600, y: 0, w: 256, h: 128 };
    const g = geometry('straight', [['a.one', 'a', 'c'], ['a.two', 'a', 'c'], ['c.three', 'c', 'a']], [A, C]);
    const ys = ['a.one', 'a.two', 'c.three'].map((r) => g.get(r)!.route);
    // Horizontal lines: each route is flat, spacing equal.
    for (const r of ys) expect(r[0][1]).toBeCloseTo(r[r.length - 1][1], 6);
    const levels = ys.map((r) => r[0][1]).sort((x, y) => x - y);
    expect(levels[1] - levels[0]).toBeCloseTo(levels[2] - levels[1], 6);
    expect(levels[1] - levels[0]).toBeGreaterThanOrEqual(12);
    for (const y of levels) expect(y > A.y + 8 && y < A.y + A.h - 8).toBe(true);
  });

  it('shrinks the spacing to fit a short side', () => {
    const small: GeometryBox = { id: 'c', x: 600, y: 0, w: 256, h: 40 };
    const refs: [string, string, string][] = [0, 1, 2, 3, 4].map((i) => [`a.e${i}`, 'a', 'c']);
    const g = geometry('straight', refs, [A, small]);
    for (const [r] of refs) {
      const end = g.get(r)!.route.at(-1)!;
      expect(end[1]).toBeGreaterThan(small.y);
      expect(end[1]).toBeLessThan(small.y + small.h);
    }
  });

  it('is deterministic and leaves a single connector untouched', () => {
    const one = geometry('straight', [['a.one', 'a', 'b']]);
    expect(one.get('a.one')!.offsets).toEqual({ s: 0, t: 0, mid: 0 });
    const x = geometry('step', [['a.one', 'a', 'b'], ['b.two', 'b', 'a']]);
    const y = geometry('step', [['b.two', 'b', 'a'], ['a.one', 'a', 'b']]);
    expect(x.get('a.one')!.route).toEqual(y.get('a.one')!.route);
  });

  it('groups inherited connectors resolved to the same placed pair', () => {
    // Children of a and b collapse onto a and b: the GeometryEdge already carries the resolved boxes.
    const g = drawingGeometry([A, B], [
      { ref: 'child1.calls', source: 'a', target: 'b', spec: {}, label: 'Calls' },
      { ref: 'child2.calls', source: 'a', target: 'b', spec: {}, label: 'Calls too' },
    ]);
    expect(routesClash(g.get('child1.calls')!.route, g.get('child2.calls')!.route)).toBe(false);
  });

  it('staggers labels of parallel connectors so they do not collide', () => {
    const g = drawingGeometry([A, B], [
      { ref: 'a.one', source: 'a', target: 'b', spec: { shape: 'step' }, label: 'Creates the order' },
      { ref: 'a.two', source: 'a', target: 'b', spec: { shape: 'step' }, label: 'Updates the stock' },
      { ref: 'b.three', source: 'b', target: 'a', spec: { shape: 'step' }, label: 'Confirms delivery' },
    ]);
    const boxes = ['a.one', 'a.two', 'b.three'].map((r) => g.get(r)!.labelBox!);
    const hit = (p: typeof boxes[0], q: typeof boxes[0]) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
    expect(hit(boxes[0], boxes[1]) || hit(boxes[0], boxes[2]) || hit(boxes[1], boxes[2])).toBe(false);
  });

  it('keeps manual points and only slides the ends', () => {
    const g = drawingGeometry([A, B], [
      { ref: 'a.one', source: 'a', target: 'b', spec: { shape: 'step', points: [[400, 64], [400, 304]] }, label: '' },
      { ref: 'a.two', source: 'a', target: 'b', spec: { shape: 'step' }, label: '' },
    ]);
    const r = g.get('a.one')!.route;
    expect(r.some((p) => p[0] === 400 && p[1] === 64)).toBe(true);
    expect(r.some((p) => p[0] === 400 && p[1] === 304)).toBe(true);
  });
});
