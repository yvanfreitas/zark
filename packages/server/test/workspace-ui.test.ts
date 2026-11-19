// Workspace mode in the browser: repo list at /, sidebar repo tree, and
// rendering stays inside the repo the page is on. Skipped when the UI is not built.
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
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

  it('lists the repos, opens one, switches repos via the sidebar and renders only into the current one', async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`${ws.url}/?token=${ws.token}`);
    await page.getByRole('link', { name: /^a\b/ }).waitFor();
    await page.getByRole('link', { name: /^b\b/ }).click();
    await page.getByRole('button', { name: 'New drawing' }).waitFor();
    expect(new URL(page.url()).pathname).toBe('/r/b/');

    // The sidebar tree replaces the switcher: the top bar shows the workspace folder name.
    const aside = page.getByRole('complementary', { name: 'Left panel' });
    await page.getByRole('combobox', { name: 'Switch repo' }).waitFor({ state: 'detached' });
    await page.getByText(basename(root), { exact: true }).first().waitFor();
    await aside.getByRole('button', { name: 'Expand a', exact: true }).click();
    await aside.getByRole('link', { name: 'Context', exact: true }).waitFor();
    await aside.getByRole('link', { name: 'Context', exact: true }).click();
    await page.getByRole('button', { name: 'New drawing' }).waitFor();
    const url = new URL(page.url());
    expect(url.pathname).toBe('/r/a/');
    expect(url.hash).toContain('#drawing=');
    await page.locator('.react-flow__node').first().waitFor();
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
