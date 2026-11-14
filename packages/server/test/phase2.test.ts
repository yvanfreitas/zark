// Fase 2 acceptance: editing an `x` in the YAML moves the box on screen in
// under 1 s, and the same PNG rendered twice is byte-identical. Runs a real
// server, the built UI and headless Chromium; skipped when the UI is not built.
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type Running } from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../examples/ai-chat/architecture', import.meta.url));
const UI = fileURLToPath(new URL('../../ui/dist', import.meta.url));

describe.skipIf(!existsSync(join(UI, 'index.html')))('fase 2: visualizador e render', () => {
  let root: string;
  let dir: string;
  let running: Running;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'zark-phase2-'));
    dir = join(root, 'architecture');
    await cp(EXAMPLE, dir, { recursive: true });
    running = await startServer({ dir, port: 0, uiDir: UI, watch: true });
  });
  afterAll(async () => {
    await running?.stop();
    await rm(root, { recursive: true, force: true });
  });

  it('editing x in the YAML moves the box on screen in under 1 s', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await page.goto(`${running.url}/?token=${running.token}`);
      const box = page.locator('.react-flow__node[data-id="auth"]');
      await box.waitFor();
      // Let the live-update stream connect before editing.
      await page.waitForFunction(() => document.body.innerText.includes('Saved') || document.body.innerText.includes('Valid'));
      await page.waitForTimeout(300);
      const before = await box.evaluate((el) => (el as HTMLElement).style.transform);

      const file = join(dir, 'drawings/context.yaml');
      const text = await readFile(file, 'utf8');
      const edited = text.replace('auth: { x: 832, y: -320 }', 'auth: { x: 600, y: -320 }');
      expect(edited).not.toBe(text);
      const started = Date.now();
      await writeFile(file, edited);
      await page.waitForFunction(
        ([sel, prev]) => (document.querySelector(sel) as HTMLElement | null)?.style.transform !== prev,
        ['.react-flow__node[data-id="auth"]', before] as const,
        { timeout: 5000, polling: 'raf' },
      );
      const elapsed = Date.now() - started;
      console.log(`x in YAML -> box on screen: ${elapsed} ms`);
      expect(await box.evaluate((el) => (el as HTMLElement).style.transform)).toContain('600px');
      expect(elapsed).toBeLessThan(1000);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it('renders the same PNG twice byte for byte', async () => {
    const a = await running.service.renderer.png(running.service.project, { drawing: 'context' });
    const b = await running.service.renderer.png(running.service.project, { drawing: 'context' });
    expect(a.png.length).toBeGreaterThan(10_000);
    expect(Buffer.compare(a.png, b.png)).toBe(0);
    const flowA = await running.service.renderer.png(running.service.project, { flow: 'user-chats-with-the-bot', step: 'triggers-the-bot' });
    const flowB = await running.service.renderer.png(running.service.project, { flow: 'user-chats-with-the-bot', step: 'triggers-the-bot' });
    expect(Buffer.compare(flowA.png, flowB.png)).toBe(0);
  }, 120_000);
});
