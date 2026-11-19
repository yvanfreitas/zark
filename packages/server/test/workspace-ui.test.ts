// Workspace mode in the browser: repo list at /, switcher in the top bar, and
// rendering stays inside the repo the page is on. Skipped when the UI is not built.
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorkspace, type RunningWorkspace } from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../examples/ai-chat/architecture', import.meta.url));
const UI = fileURLToPath(new URL('../../ui/dist', import.meta.url));

describe.skipIf(!existsSync(join(UI, 'index.html')))('UI workspace mode', () => {
  let root: string;
  let ws: RunningWorkspace;
  let browser: Browser;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'zark-wsui-'));
    for (const name of ['a', 'b']) await cp(EXAMPLE, join(root, name, 'architecture'), { recursive: true });
    ws = await startWorkspace({ root, port: 0, uiDir: UI });
    browser = await chromium.launch();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    await ws?.stop();
    await rm(root, { recursive: true, force: true });
  });

  it('lists the repos, opens one, switches repos and renders only into the current one', async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`${ws.url}/?token=${ws.token}`);
    await page.getByRole('link', { name: /^a\b/ }).waitFor();
    await page.getByRole('link', { name: /^b\b/ }).click();
    await page.getByRole('button', { name: 'New drawing' }).waitFor();
    expect(new URL(page.url()).pathname).toBe('/r/b/');

    await page.getByRole('combobox', { name: 'Switch repo' }).selectOption({ label: 'a' });
    await page.getByRole('button', { name: 'New drawing' }).waitFor();
    expect(new URL(page.url()).pathname).toBe('/r/a/');
    expect(page.url()).not.toContain('token');

    const png = (name: string) => join(root, name, 'architecture', 'rendered', 'context.png');
    // The example ships a committed PNG: remove both so only a real render can recreate one.
    await rm(png('a'));
    await rm(png('b'));
    const res = await page.evaluate(async (token) => {
      const r = await fetch('/r/a/api/render', {
        method: 'POST',
        headers: { 'x-zark-token': token, 'content-type': 'application/json' },
        body: JSON.stringify({ drawing: 'context', commit: true }),
      });
      return r.json();
    }, ws.token);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect((await readFile(png('a'))).length).toBeGreaterThan(0);
    expect(existsSync(png('b'))).toBe(false);
    await page.close();
  }, 120_000);
});
