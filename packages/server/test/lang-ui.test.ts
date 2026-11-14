// UI language: English by default; EN | PT in the top bar switches it and the
// choice survives a reload. Skipped when the UI is not built.
import { existsSync } from 'node:fs';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type Running } from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../examples/ai-chat/architecture', import.meta.url));
const UI = fileURLToPath(new URL('../../ui/dist', import.meta.url));

describe.skipIf(!existsSync(join(UI, 'index.html')))('UI language toggle', () => {
  let root: string;
  let running: Running;
  let browser: Browser;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'zark-lang-'));
    const dir = join(root, 'architecture');
    await cp(EXAMPLE, dir, { recursive: true });
    running = await startServer({ dir, port: 0, uiDir: UI });
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    await running?.stop();
    await rm(root, { recursive: true, force: true });
  });

  it('defaults to English, switches to Portuguese and remembers it', async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`${running.url}/?token=${running.token}`);
    await page.getByRole('button', { name: 'New drawing' }).waitFor();
    expect(await page.getAttribute('html', 'lang')).toBe('en');
    expect(await page.getByRole('tab', { name: 'Flows' }).isVisible()).toBe(true);

    await page.getByRole('radio', { name: 'PT' }).click();
    await page.getByRole('button', { name: 'Novo desenho' }).waitFor();
    expect(await page.getByRole('tab', { name: 'Fluxos' }).isVisible()).toBe(true);
    expect(await page.getAttribute('html', 'lang')).toBe('pt-BR');

    // The token was moved to sessionStorage, so a plain reload keeps the session.
    await page.reload();
    await page.getByRole('button', { name: 'Novo desenho' }).waitFor();
    expect(await page.getByRole('radio', { name: 'PT' }).getAttribute('aria-checked')).toBe('true');

    await page.getByRole('radio', { name: 'EN' }).click();
    await page.getByRole('button', { name: 'New drawing' }).waitFor();
    await page.close();
  }, 60_000);
});
