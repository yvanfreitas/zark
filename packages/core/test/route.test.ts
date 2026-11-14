import { describe, expect, it } from 'vitest';
import { routeOrthogonal, type Pt, type Rect } from '../src/route.js';

const box = (x: number, y: number, w = 256, h = 128): Rect => ({ x, y, w, h });

/** Segment a-b passes through the interior of r (touching the border is fine). */
function hits(a: Pt, b: Pt, r: Rect) {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  return x0 < r.x + r.w && x1 > r.x && y0 < r.y + r.h && y1 > r.y;
}
const segments = (p: Pt[]) => p.slice(1).map((b, i) => [p[i], b] as const);

describe('routeOrthogonal', () => {
  // Source box A on the left, target box B on the right, wall C in between.
  const A = box(0, 0);
  const B = box(800, 0);
  const C = box(400, -100, 128, 330);
  const s: Pt = [A.x + A.w, A.y + 64];
  const t: Pt = [B.x, B.y + 64];

  it('goes around a box in the way, with orthogonal segments only', () => {
    const route = routeOrthogonal(s, 'right', t, 'left', [A, B, C])!;
    expect(route[0]).toEqual(s);
    expect(route[route.length - 1]).toEqual(t);
    for (const [a, b] of segments(route)) {
      expect(a[0] === b[0] || a[1] === b[1]).toBe(true);
      expect(hits(a, b, C)).toBe(false);
    }
    // Never re-enters its own boxes beyond the first/last stub.
    for (const [a, b] of segments(route).slice(1, -1)) {
      expect(hits(a, b, A)).toBe(false);
      expect(hits(a, b, B)).toBe(false);
    }
  });

  it('is a straight line when nothing is in the way', () => {
    expect(routeOrthogonal(s, 'right', t, 'left', [A, B])).toEqual([s, t]);
  });

  it('is deterministic', () => {
    const a = routeOrthogonal(s, 'right', t, 'left', [A, B, C]);
    const b = routeOrthogonal(s, 'right', t, 'left', [A, B, C]);
    expect(a).toEqual(b);
  });

  it('returns null when the target is boxed in, so the caller can fall back', () => {
    const cage = [box(760, -60, 20, 260), box(1076, -60, 20, 260), box(760, -60, 336, 20), box(760, 180, 336, 20)];
    expect(routeOrthogonal(s, 'right', t, 'left', [A, B, ...cage])).toBeNull();
  });

  it('routes 300 edges among 150 boxes fast (under 500 ms even with parallel test load)', () => {
    const boxes: Rect[] = [];
    for (let i = 0; i < 150; i++) boxes.push(box((i % 15) * 400, Math.floor(i / 15) * 280));
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pairs: [number, number][] = [];
    for (let k = 0; k < 300; k++) {
      const a = Math.floor(rnd() * 150);
      const near = [a + 1, a - 1, a + 15, a - 15, a + 16, a - 14].filter((n) => n >= 0 && n < 150);
      pairs.push([a, near[Math.floor(rnd() * near.length)]]);
    }
    const started = performance.now();
    let routed = 0;
    for (const [a, b] of pairs) {
      const ra = boxes[a], rb = boxes[b];
      const r = routeOrthogonal([ra.x + ra.w, ra.y + 64], 'right', [rb.x, rb.y + 64], 'left', boxes);
      if (r) routed++;
    }
    const elapsed = performance.now() - started;
    expect(routed).toBeGreaterThan(280);
    expect(elapsed).toBeLessThan(500);
  });
});
