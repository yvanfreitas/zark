// Icons end to end: HTTP routes, the model snapshot, the inspector picker
// (suggestion from an AWS technology in a user pack), the render route, and a
// guard that icon data never lands in the main UI chunk.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type Running } from '../src/index.js';

const UI = fileURLToPath(new URL('../../ui/dist', import.meta.url));
const hasUi = existsSync(join(UI, 'index.html'));
const SQS_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#FF9900"/><script>alert(1)</script></svg>';

let root: string;
let dir: string;
let running: Running;

async function writeProject() {
  const files: Record<string, string> = {
    'zark.yaml': 'schema: 1\nname: Icons\ndefaultDrawing: contexto\nicons:\n  packs:\n    - id: aws\n      dir: icons/aws\n',
    'catalog.yaml': 'technologies:\n  - id: sqs\n    name: Amazon SQS\n  - id: py\n    name: Python\n    icon: si:python\n',
    'entities/fila.yaml': 'id: fila\nname: Fila de entrada\nkind: system\ntechnologies: [ sqs ]\n',
    'entities/worker.yaml': 'id: worker\nname: Worker\nkind: system\ntechnologies: [ py ]\nconnections:\n  - id: le\n    to: fila\n    label: Lê mensagens\n',
    'drawings/contexto.yaml': 'id: contexto\nname: Contexto\nscope: null\nnodes:\n  fila: { x: 0, y: 0 }\n  worker: { x: 400, y: 0 }\nedges:\n  worker.le: { shape: straight }\n',
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  await mkdir(join(dir, 'icons', 'aws'), { recursive: true });
  await writeFile(join(dir, 'icons', 'aws', 'SQS.svg'), SQS_SVG);
}

const get = (path: string) => fetch(`${running.url}${path}`, { headers: { 'x-zark-token': running.token } });

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'zark-icons-'));
  dir = join(root, 'architecture');
  await writeProject();
  running = await startServer({ dir, port: 0, uiDir: hasUi ? UI : undefined, watch: true });
});
afterAll(async () => {
  await running?.stop();
  await rm(root, { recursive: true, force: true });
});

describe('icon routes', () => {
  it('lists sets, searches and serves sanitized SVGs', async () => {
    const sets = (await (await get('/api/icons/sets')).json()).sets.map((s: { id: string }) => s.id);
    expect(sets).toEqual(['lucide', 'si', 'aws']);
    const hits = (await (await get('/api/icons?q=sqs')).json()).icons;
    expect(hits[0].id).toBe('aws:sqs');
    const svg = await get('/api/icons/svg/aws:sqs');
    expect(svg.headers.get('content-type')).toContain('image/svg+xml');
    const body = await svg.text();
    expect(body).toContain('#FF9900');
    expect(body).not.toContain('script');
    expect((await get('/api/icons/svg/..%2Fsecret')).status).toBe(400);
    expect((await fetch(`${running.url}/api/icons/sets`)).status).toBe(401);
  });

  it('suggests the pack icon of the technology first', async () => {
    const r = await (await get('/api/icons/suggest/fila')).json();
    expect(r.icons[0].id).toBe('aws:sqs');
    expect(r.icons[0].svg).toContain('#FF9900');
    expect(r.icons.map((i: { id: string }) => i.id)).toContain('lucide:list-ordered');
  });

  it('ships the SVGs of used icons in the model snapshot', async () => {
    const model = await (await get('/api/model')).json();
    expect(Object.keys(model.icons)).toEqual(['si:python']);
  });
});

describe.skipIf(!hasUi)('icons in the UI', () => {
  it('applies a suggested icon from the inspector and shows it in the box', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
      await page.goto(`${running.url}/?token=${running.token}`);
      const box = page.locator('.react-flow__node[data-id="fila"]');
      await box.waitFor();
      // Worker shows its technology icon (Simple Icons, Python) before any edit.
      await page.locator('.react-flow__node[data-id="worker"] .zark-icon svg').waitFor();
      await box.click();
      const suggestion = page.getByRole('listitem', { name: 'Use icon aws:sqs' });
      await suggestion.waitFor({ timeout: 10_000 });
      await suggestion.click();
      await expect.poll(async () => readFile(join(dir, 'entities/fila.yaml'), 'utf8'), { timeout: 10_000 }).toContain('icon: aws:sqs');
      await page.locator('.react-flow__node[data-id="fila"] .zark-icon svg rect[fill="#FF9900"]').waitFor({ timeout: 10_000 });
      await page.screenshot({ path: join(root, 'canvas.png') });

      // The picker searches every set.
      await page.getByRole('button', { name: 'Choose…' }).click();
      await page.getByRole('textbox', { name: 'Search icons' }).fill('kubernetes');
      await page.getByRole('option', { name: /Kubernetes \(si:kubernetes\)/ }).waitFor();
      await page.screenshot({ path: join(root, 'picker.png') });
      await page.getByRole('option', { name: /Kubernetes \(si:kubernetes\)/ }).click();
      await expect.poll(async () => readFile(join(dir, 'entities/fila.yaml'), 'utf8'), { timeout: 10_000 }).toContain('icon: si:kubernetes');
      if (process.env.ZARK_SHOTS) {
        const { copyFile } = await import('node:fs/promises');
        await copyFile(join(root, 'canvas.png'), join(process.env.ZARK_SHOTS, 'icons-canvas.png'));
        await copyFile(join(root, 'picker.png'), join(process.env.ZARK_SHOTS, 'icons-picker.png'));
      }
    } finally {
      await browser.close();
    }
  }, 60_000);

  it('the render route inlines icons (no network)', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const external: string[] = [];
      page.on('request', (r) => r.url().includes('/api/icons/') && external.push(r.url()));
      await page.goto(`${running.url}/render/drawing/contexto?token=${running.token}&theme=light&scale=1`);
      await page.waitForSelector('[data-ready="true"]', { state: 'attached' });
      const svgs = await page.locator('#render-root .react-flow__node .zark-icon svg').count();
      expect(svgs).toBeGreaterThanOrEqual(2);
      expect(external).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it('keeps icon data out of the main UI chunk', () => {
    const assets = join(UI, 'assets');
    const main = readdirSync(assets).find((f) => /^index-.*\.js$/.test(f))!;
    const size = statSync(join(assets, main)).size;
    expect(size).toBeLessThan(650 * 1024);
    const code = readdirSync(assets)
      .filter((f) => f.endsWith('.js'))
      .map((f) => statSync(join(assets, f)).size)
      .reduce((a, b) => a + b, 0);
    // Thousands of icons would add megabytes; the UI only carries the picker.
    expect(code).toBeLessThan(2.5 * 1024 * 1024);
  });
});
