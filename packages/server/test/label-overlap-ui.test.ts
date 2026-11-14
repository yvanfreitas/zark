// Labels on the rendered canvas don't overlap each other or other boxes: the
// render route uses the same automatic placement the W013 validator checks.
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { startServer } from '../src/index.js';

const UI = fileURLToPath(new URL('../../ui/dist', import.meta.url));

// a ---> b on one line, both directions, with c sitting on the middle: the
// default spot (0.5) is taken by c, and both labels compete for the same line.
const FILES: Record<string, string> = {
  'zark.yaml': 'schema: 1\nname: Labels\ngrid: 8\n',
  'catalog.yaml': 'technologies: []\n',
  'entities/a.yaml': 'id: a\nname: A\nkind: system\nconnections:\n  - id: calls\n    to: b\n    label: Calls\n',
  'entities/b.yaml': 'id: b\nname: B\nkind: system\nconnections:\n  - id: answers\n    to: a\n    label: Answers back\n',
  'entities/c.yaml': 'id: c\nname: C\nkind: system\n',
  'drawings/d.yaml': 'id: d\nname: D\nnodes:\n  a: { x: 0, y: 0 }\n  b: { x: 768, y: 0 }\n  c: { x: 384, y: 16 }\nedges:\n  a.calls: { shape: straight }\n  b.answers: { shape: straight }\n',
};

describe.skipIf(!existsSync(join(UI, 'index.html')))('connector labels on the rendered canvas', () => {
  it('keeps labels apart from each other and from other boxes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zark-labels-'));
    const dir = join(root, 'architecture');
    for (const [path, text] of Object.entries(FILES)) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), text);
    }
    const running = await startServer({ dir, port: 0, uiDir: UI });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${running.url}/render/drawing/d?token=${running.token}`);
      await page.waitForSelector('[data-ready="true"]', { state: 'attached' });
      const rects = await page.evaluate(() => {
        const box = (el: Element) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        };
        return {
          labels: [...document.querySelectorAll('.react-flow__edgelabel-renderer span.rounded-full')].map((s) => ({ text: s.textContent, ...box(s) })),
          c: box(document.querySelector('.react-flow__node[data-id="c"]')!),
        };
      });
      const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(rects.labels.map((l) => l.text).sort()).toEqual(['Answers back', 'Calls']);
      expect(hit(rects.labels[0], rects.labels[1])).toBe(false);
      for (const l of rects.labels) expect(hit(l, rects.c), `${l.text} over C`).toBe(false);
      // And the validator agrees with the picture.
      expect(running.service.store.problems.filter((p) => p.code === 'W013')).toEqual([]);
    } finally {
      await browser.close();
      await running.stop();
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
