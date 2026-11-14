// Three connections between the same two boxes (two one way, one back) are
// drawn as distinct, non-overlapping paths in the canvas. Real server, built
// UI, headless Chromium; skipped when the UI is not built.
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type Running } from '../src/index.js';

const UI = fileURLToPath(new URL('../../ui/dist', import.meta.url));

type Pt = [number, number];
/** Parses the M/L polylines the connectors draw. */
const parse = (d: string): Pt[] => [...d.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
const orient = (a: Pt, b: Pt, c: Pt) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
function clash(p1: Pt, p2: Pt, q1: Pt, q2: Pt): boolean {
  const o1 = orient(p1, p2, q1), o2 = orient(p1, p2, q2), o3 = orient(q1, q2, p1), o4 = orient(q1, q2, p2);
  if (o1 && o2 && o3 && o4) return o1 !== o2 && o3 !== o4;
  if (o1 === 0 && o2 === 0) {
    const ax = Math.abs(p2[0] - p1[0]) >= Math.abs(p2[1] - p1[1]) ? 0 : 1;
    return Math.min(Math.max(p1[ax], p2[ax]), Math.max(q1[ax], q2[ax])) - Math.max(Math.min(p1[ax], p2[ax]), Math.min(q1[ax], q2[ax])) > 1;
  }
  return false;
}
const overlap = (a: Pt[], b: Pt[]) => a.slice(1).some((p, i) => b.slice(1).some((q, j) => clash(a[i], p, b[j], q)));

const files: Record<string, string> = {
  'zark.yaml': 'schema: 1\nname: Parallel\ngrid: 8\n',
  'catalog.yaml': 'technologies: []\n',
  'entities/api.yaml': 'id: api\nname: API\nkind: system\nconnections:\n  - id: orders\n    to: db\n    label: Writes orders\n  - id: reads\n    to: db\n    label: Reads stock\n',
  'entities/db.yaml': 'id: db\nname: Database\nkind: system\nconnections:\n  - id: events\n    to: api\n    label: Streams changes\n',
  'drawings/main.yaml':
    'id: main\nname: Main\nscope: null\nnodes:\n  api: { x: 0, y: 0 }\n  db: { x: 560, y: 160 }\nedges:\n  api.orders: { shape: step }\n  api.reads: { shape: step }\n  db.events: { shape: step }\n',
};

describe.skipIf(!existsSync(join(UI, 'index.html')))('parallel connectors in the canvas', () => {
  let root: string;
  let running: Running;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'zark-parallel-'));
    const dir = join(root, 'architecture');
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(dir, path, '..'), { recursive: true });
      await writeFile(join(dir, path), text);
    }
    running = await startServer({ dir, port: 0, uiDir: UI });
  });
  afterAll(async () => {
    await running?.stop();
    await rm(root, { recursive: true, force: true });
  });

  it('draws three connections between the same boxes as distinct, non-overlapping paths', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.goto(`${running.url}/render/drawing/main?token=${running.token}`);
      await page.waitForSelector('[data-ready="true"]', { state: 'attached' });
      const ds = await page.$$eval('#render-root .react-flow__edge-path', (els) => els.map((e) => e.getAttribute('d') ?? ''));
      expect(ds).toHaveLength(3);
      expect(new Set(ds).size).toBe(3);
      const routes = ds.map(parse);
      for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) expect(overlap(routes[i], routes[j]), `${i} vs ${j}`).toBe(false);
      const labels = await page.$$eval('#render-root .react-flow__edgelabel-renderer span', (els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      );
      const hit = (p: (typeof labels)[0], q: (typeof labels)[0]) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
      for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) expect(hit(labels[i], labels[j])).toBe(false);
      if (process.env.ZARK_SHOT) await page.locator('#render-root').screenshot({ path: process.env.ZARK_SHOT });
    } finally {
      await browser.close();
    }
  }, 60_000);
});
