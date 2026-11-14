import { describe, expect, it } from 'vitest';
import {
  anchor,
  applyOps,
  buildProject,
  drawingGeometry,
  drawingLabelOverlaps,
  geometryInput,
  labelSize,
  pointAt,
  stepRoute,
  validate,
  type Pt,
  type Project,
} from '../src/index.js';

// Self-contained model, independent of the shipped example.
//   a (0,0) ---> b (768,0), straight, middle at x=512; c sits on that middle.
const base: Record<string, string> = {
  'zark.yaml': 'schema: 1\nname: Labels\ngrid: 8\n',
  'catalog.yaml': 'technologies: []\n',
  'entities/a.yaml': 'id: a\nname: A\nkind: system\nconnections:\n  - id: calls\n    to: b\n    label: Calls\n',
  'entities/b.yaml': 'id: b\nname: B\nkind: system\nconnections:\n  - id: answers\n    to: a\n    label: Answers back\n',
  'entities/c.yaml': 'id: c\nname: C\nkind: system\n',
  'drawings/d.yaml': [
    'id: d',
    'name: D',
    'nodes:',
    '  a: { x: 0, y: 0 }',
    '  b: { x: 768, y: 0 }',
    '  c: { x: 448, y: -160 }',
    'edges:',
    '  a.calls: { shape: straight }',
    '  b.answers: { shape: straight }',
    '',
  ].join('\n'),
};

function project(edit: (t: Record<string, string>) => void = () => {}): Project {
  const t = { ...base };
  edit(t);
  return buildProject('/virtual', new Map(Object.entries(t)));
}
const w013 = (p: Project) => validate(p).filter((x) => x.code === 'W013');
const setEdges = (t: Record<string, string>, calls: string, answers: string) => {
  t['drawings/d.yaml'] = t['drawings/d.yaml'].replace('  a.calls: { shape: straight }', `  a.calls: ${calls}`).replace('  b.answers: { shape: straight }', `  b.answers: ${answers}`);
};
const moveC = (t: Record<string, string>, x: number, y: number) => {
  t['drawings/d.yaml'] = t['drawings/d.yaml'].replace('  c: { x: 448, y: -160 }', `  c: { x: ${x}, y: ${y} }`);
};

describe('edge geometry', () => {
  it('anchors at mid side, 3.5 px outside the border (measured in React Flow)', () => {
    expect(anchor({ x: 360, y: 472, w: 256, h: 128 }, 'top')).toEqual([488, 468.5]);
    expect(anchor({ x: 360, y: 232, w: 256, h: 128 }, 'bottom')).toEqual([488, 363.5]);
    expect(anchor({ x: 0, y: 0, w: 256, h: 128 }, 'right')).toEqual([259.5, 64]);
  });

  it('keeps the canvas routes it replaced (step route and point at fraction)', () => {
    // Reference implementation copied from the former ZarkEdge.tsx.
    const OFFSET = 24;
    const dir = (s: string): Pt => (s === 'left' ? [-1, 0] : s === 'right' ? [1, 0] : s === 'top' ? [0, -1] : [0, 1]);
    const horiz = (s: string) => s === 'left' || s === 'right';
    const oldStep = (s: Pt, sp: string, t: Pt, tp: string, points: Pt[]): Pt[] => {
      const [sdx, sdy] = dir(sp), [tdx, tdy] = dir(tp);
      const s1: Pt = [s[0] + sdx * OFFSET, s[1] + sdy * OFFSET];
      const t1: Pt = [t[0] + tdx * OFFSET, t[1] + tdy * OFFSET];
      if (points.length) {
        const route: Pt[] = [s, s1];
        let prev = s1, h = horiz(sp);
        for (const p of [...points, t1]) {
          if (prev[0] !== p[0] && prev[1] !== p[1]) route.push(h ? [p[0], prev[1]] : [prev[0], p[1]]);
          route.push(p);
          h = !h;
          prev = p;
        }
        route.push(t);
        return route;
      }
      if (horiz(sp) && horiz(tp)) { const mx = (s1[0] + t1[0]) / 2; return [s, s1, [mx, s1[1]], [mx, t1[1]], t1, t]; }
      if (!horiz(sp) && !horiz(tp)) { const my = (s1[1] + t1[1]) / 2; return [s, s1, [s1[0], my], [t1[0], my], t1, t]; }
      return horiz(sp) ? [s, s1, [t1[0], s1[1]], t1, t] : [s, s1, [s1[0], t1[1]], t1, t];
    };
    const cases: [Pt, 'top' | 'right' | 'bottom' | 'left', Pt, 'top' | 'right' | 'bottom' | 'left', Pt[]][] = [
      [[0, 0], 'right', [400, 200], 'left', []],
      [[0, 0], 'bottom', [400, 200], 'top', []],
      [[0, 0], 'right', [400, 200], 'top', []],
      [[0, 0], 'bottom', [400, 200], 'left', []],
      [[10, 10], 'right', [500, -80], 'left', [[200, 300], [480, 300]]],
    ];
    for (const [s, sp, t, tp, pts] of cases) expect(stepRoute(s, sp, t, tp, pts)).toEqual(oldStep(s, sp, t, tp, pts));
    expect(pointAt([[0, 0], [100, 0], [100, 100]], 0.75)).toEqual([100, 50]);
  });

  it('estimates label pills from Inter 11px widths (measured pills: 113.8, 63.9 px)', () => {
    expect(labelSize('Navega e compra').w).toBeCloseTo(113.8, 0);
    expect(labelSize('Pedidos').w).toBeCloseTo(63.9, 0);
    expect(labelSize('x'.repeat(200)).w).toBe(220);
    expect(labelSize('Calls').h).toBe(26);
  });
});

describe('W013 label overlaps', () => {
  it('flags a fixed label covering another box', () => {
    const p = project((t) => setEdges(t, '{ shape: straight, labelAt: 0.5 }', '{ shape: straight, labelAt: 0.1 }'));
    const problems = w013(project((t) => {
      moveC(t, 384, 16);
      setEdges(t, '{ shape: straight, labelAt: 0.5 }', '{ shape: straight, labelAt: 0.1 }');
    }));
    expect(w013(p)).toEqual([]);
    expect(problems.map((x) => x.message)).toEqual(['label of a.calls overlaps the box c']);
    expect(problems[0].file).toBe('drawings/d.yaml');
  });

  it('flags two fixed labels on the same spot', () => {
    const problems = w013(project((t) => setEdges(t, '{ shape: straight, labelAt: 0.5 }', '{ shape: straight, labelAt: 0.5 }')));
    expect(problems.map((x) => x.message)).toEqual(['label of a.calls overlaps the label of b.answers']);
  });

  it("ignores the edge's own boxes unless the label centre lands inside one", () => {
    // Near the source end the pill overlaps box a's border, centre still outside.
    expect(w013(project((t) => setEdges(t, '{ shape: straight, labelAt: 0.02 }', '{ shape: straight, labelAt: 0.5 }')))).toEqual([]);
    // A bend point inside a drags the label centre into its own box.
    const inside = w013(project((t) => setEdges(t, '{ shape: straight, points: [ [ 128, 64 ] ], labelAt: 0.1 }', '{ shape: straight, labelAt: 0.5 }')));
    expect(inside.map((x) => x.message)).toEqual(['label of a.calls overlaps the box a']);
  });

  it('honours rules overrides', () => {
    const edit = (t: Record<string, string>, rule: string) => {
      setEdges(t, '{ shape: straight, labelAt: 0.5 }', '{ shape: straight, labelAt: 0.5 }');
      t['zark.yaml'] += `rules: { W013: ${rule} }\n`;
    };
    expect(w013(project((t) => edit(t, 'off')))).toEqual([]);
    expect(w013(project((t) => edit(t, 'error')))[0].severity).toBe('error');
  });
});

describe('automatic label placement', () => {
  it('moves automatic labels off boxes and off each other', () => {
    const p = project((t) => moveC(t, 384, 16));
    expect(w013(p)).toEqual([]);
    const d = p.drawings.get('d')!.drawing;
    const { boxes, edges } = geometryInput(p, d);
    const g = drawingGeometry(boxes, edges);
    expect(g.get('a.calls')!.labelAt).not.toBe(0.5);
    // Fractions run from each connector's own source, so compare the boxes.
    const [x, y] = [g.get('a.calls')!.labelBox!, g.get('b.answers')!.labelBox!];
    expect(x.x + x.w <= y.x || y.x + y.w <= x.x || x.y + x.h <= y.y || y.y + y.h <= x.y).toBe(true);
  });

  it('respects an explicit labelAt even when it collides (only W013 warns)', () => {
    const p = project((t) => {
      moveC(t, 384, 16);
      setEdges(t, '{ shape: straight, labelAt: 0.5 }', '{ shape: straight }');
    });
    const d = p.drawings.get('d')!.drawing;
    const { boxes, edges } = geometryInput(p, d);
    expect(drawingGeometry(boxes, edges).get('a.calls')!.labelAt).toBe(0.5);
    expect(w013(p).map((x) => x.ref)).toEqual(['a.calls']);
  });

  it('is deterministic and independent of input order', () => {
    const p = project((t) => moveC(t, 384, 16));
    const { boxes, edges } = geometryInput(p, p.drawings.get('d')!.drawing);
    const once = [...drawingGeometry(boxes, edges).values()].map((g) => [g.ref, g.labelAt]);
    const shuffled = [...drawingGeometry([...boxes].reverse(), [...edges].reverse()).values()].map((g) => [g.ref, g.labelAt]);
    expect(shuffled).toEqual(once);
    expect([...drawingGeometry(boxes, edges).values()].map((g) => [g.ref, g.labelAt])).toEqual(once);
  });

  it('auto-place-labels drops the colliding fixed labelAt values, one line each', async () => {
    const p = project((t) => {
      moveC(t, 384, 16);
      setEdges(t, '{ shape: straight, labelAt: 0.5 }', '{ shape: straight, labelAt: 0.5 }');
    });
    expect(drawingLabelOverlaps(p, p.drawings.get('d')!.drawing).overlaps.length).toBeGreaterThan(0);
    const r = await applyOps(p, [{ op: 'drawing.auto-place-labels', drawing: 'd' }]);
    expect(r.ok, r.error).toBe(true);
    const before = p.files.get('drawings/d.yaml')!.text.split('\n');
    const after = r.files.get('drawings/d.yaml')!.split('\n');
    expect(after.length).toBe(before.length);
    expect(after.filter((l, i) => l !== before[i])).toEqual(['  a.calls: { shape: straight }', '  b.answers: { shape: straight }']);
    expect(w013(r.project)).toEqual([]);
  });
});
