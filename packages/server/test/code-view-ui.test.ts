// Code view (C4 level 4): a scanned component opens its modules, a module its pieces.
// Skipped when the UI is not built.
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanProject } from '@zark/core';
import { startServer, type Running } from '../src/index.js';

const FIXTURE = fileURLToPath(new URL('../../core/test/fixtures/code', import.meta.url));
const UI = fileURLToPath(new URL('../../ui/dist', import.meta.url));

// The fixture has entities but no drawing; one drawing puts both components on screen.
const DRAWING = `id: bot-service
name: Bot service
scope: bot-service
nodes:
  bot: { x: 0, y: 0 }
  moderation: { x: 480, y: 0 }
`;

describe.skipIf(!existsSync(join(UI, 'index.html')))('code view', () => {
  let root: string;
  let running: Running;
  let browser: Browser;

  beforeAll(async () => {
    // A temp copy: the scanner takes the repo root from the nearest `.git`, which in place would be Zark's own.
    root = await mkdtemp(join(tmpdir(), 'zark-code-ui-'));
    await cp(FIXTURE, root, { recursive: true });
    const dir = join(root, 'architecture');
    await mkdir(join(dir, 'drawings'), { recursive: true });
    await writeFile(join(dir, 'drawings', 'bot-service.yaml'), DRAWING);
    const scan = await scanProject(dir);
    expect(scan.problems).toEqual([]);
    running = await startServer({ dir, port: 0, uiDir: UI });
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    await running?.stop();
    await rm(root, { recursive: true, force: true });
  });

  it('opens modules from the component box, drills into a module and back', async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${running.url}/?token=${running.token}`);

    const node = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
    await page.getByRole('button', { name: 'Open the code of Bot' }).click();
    const main = page.getByRole('main', { name: 'Code' });
    await main.waitFor();
    await node('services/bot/src/orchestrator.ts').waitFor();
    expect(await node('services/bot/src/handler.ts').isVisible()).toBe(true);
    // Moderation's module is touched by bot's calls: shown, faded, under its component id.
    expect(await node('moderation:services/moderation/src/client.ts').isVisible()).toBe(true);
    // Arrows aggregated per module pair.
    expect(await page.locator('.react-flow__edge').count()).toBeGreaterThan(0);

    // Selecting a module shows its detail on the right.
    await node('services/bot/src/orchestrator.ts').click();
    const panel = page.getByRole('complementary');
    await panel.getByRole('heading', { name: 'orchestrator.ts' }).waitFor();
    expect(await panel.getByText('Unresolved in Bot').isVisible()).toBe(true);

    await node('services/bot/src/orchestrator.ts').dblclick();
    await node('services/bot/src/orchestrator.ts#BotOrchestrator').waitFor();
    expect(await page.getByRole('navigation', { name: 'Code path' }).getByText('services/bot/src/orchestrator.ts').isVisible()).toBe(true);
    expect(await node('services/bot/src/orchestrator.ts').count()).toBe(0);

    await page.getByRole('button', { name: 'Back' }).click();
    await node('services/bot/src/handler.ts').waitFor();
    expect(await node('services/bot/src/orchestrator.ts#BotOrchestrator').count()).toBe(0);

    // Back again leaves the code view for the drawing.
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('main', { name: 'Canvas' }).waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);
});
