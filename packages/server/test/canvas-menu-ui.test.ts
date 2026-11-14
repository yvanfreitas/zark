// Canvas affordances added by the UX review, driven through the real UI:
// the right-click menu on boxes, connectors and the empty canvas, the same
// menu from the inspector and the keyboard, the shortcuts overlay, the step
// menu of the flow editor and the inline reason of a refused step.
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type Running } from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../examples/ai-chat/architecture', import.meta.url));
const UI = fileURLToPath(new URL('../../ui/dist', import.meta.url));

describe.skipIf(!existsSync(join(UI, 'index.html')))('canvas menus and shortcuts', { timeout: 60_000 }, () => {
  let root: string;
  let dir: string;
  let running: Running;
  let browser: Browser;
  let page: Page;

  const yaml = (path: string) => readFile(join(dir, path), 'utf8');
  const node = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
  const edgeLabel = (text: string) => page.locator('.react-flow__edgelabel-renderer span', { hasText: new RegExp(`^${text}$`) }).first();
  const menu = () => page.getByRole('menu', { name: 'Actions' });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'zark-menu-'));
    dir = join(root, 'architecture');
    await cp(EXAMPLE, dir, { recursive: true });
    running = await startServer({ dir, port: 0, uiDir: UI, watch: true });
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${running.url}/?token=${running.token}`);
    await node('papo-app').waitFor();
  });
  afterAll(async () => {
    await browser?.close();
    await running?.stop();
    await rm(root, { recursive: true, force: true });
  });

  it('right-click on a connector changes its shape', async () => {
    await edgeLabel('Chats in the app').click({ button: 'right' });
    await expect.poll(() => menu().getByRole('menuitemradio', { name: 'Straight' }).getAttribute('aria-checked')).toBe('true');
    await menu().getByRole('menuitemradio', { name: 'Curved' }).click();
    await expect.poll(() => yaml('drawings/context.yaml')).toMatch(/user\.uses: \{ shape: curved \}/);
    expect(await menu().count()).toBe(0);
  });

  it('right-click on a box removes it from the drawing and keeps it in the model', async () => {
    await node('auth').click({ button: 'right' });
    // The inspector follows the right-click, so both show the same item.
    await page.getByRole('complementary', { name: 'Right panel' }).getByText('Auth', { exact: true }).waitFor();
    await menu().getByRole('menuitem', { name: 'Remove from drawing' }).click();
    await page.getByText(/Removed from this drawing\. It is still in the model/).waitFor();
    await expect.poll(() => yaml('drawings/context.yaml')).not.toMatch(/^ {2}auth:/m);
    expect(existsSync(join(dir, 'entities/auth.yaml'))).toBe(true);
    expect(await node('auth').count()).toBe(0);
  });

  it('right-click on the empty canvas adds a note where it was clicked', async () => {
    await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 150, y: 600 } });
    await menu().getByRole('menuitem', { name: 'New note here' }).click();
    await page.locator('.react-flow__node[data-id^="note:"]', { hasText: 'New note' }).waitFor();
    expect(await yaml('drawings/context.yaml')).toMatch(/text: New note/);
  });

  it('the inspector opens the same menu, and deleting from the model asks first', async () => {
    await node('papo-app').click();
    await page.getByRole('button', { name: 'More actions' }).click();
    await menu().getByRole('menuitem', { name: 'Delete from model…' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByText('Delete Papo app from the model?').waitFor();
    // The safe choice has the focus: Enter must not delete.
    await expect.poll(() => dialog.getByRole('button', { name: 'Cancel' }).evaluate((el) => el === document.activeElement)).toBe(true);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(existsSync(join(dir, 'entities/papo-app.yaml'))).toBe(true);
  });

  it('the keyboard opens the menu for the selection and closes it with Escape', async () => {
    await node('papo-app').click();
    await page.keyboard.press('Shift+F10');
    await menu().getByRole('menuitem', { name: 'View dependencies' }).waitFor();
    // The first item has the focus and the arrows walk the list.
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toContain('View dependencies');
    await page.keyboard.press('Escape');
    await expect.poll(() => menu().count()).toBe(0);
    // Escape closed only the menu: the box is still selected.
    expect(await node('papo-app').getAttribute('class')).toContain('selected');
  });

  it('"?" lists the shortcuts', async () => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await dialog.getByText('Remove from this drawing (stays in the model)').waitFor();
    await page.keyboard.press('Escape');
    await expect.poll(() => dialog.count()).toBe(0);
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Close' }).click();
  });

  it('the step menu reorders a flow, and a refused step says why next to the form', async () => {
    await page.getByRole('tab', { name: 'Flows' }).click();
    await page.getByRole('button', { name: /^History is saved/ }).click();
    const steps = page.getByRole('complementary', { name: 'Right panel' }).locator('div.group');
    await steps.first().waitFor();
    const before = (await yaml('flows/history-is-saved.yaml')).match(/- id: (\S+)/g)!;
    await steps.first().getByRole('button', { name: 'Step actions' }).click();
    await menu().getByRole('menuitem', { name: 'Move down' }).click();
    await expect.poll(async () => (await yaml('flows/history-is-saved.yaml')).match(/- id: (\S+)/g)!.slice(0, 2)).toEqual([before[1], before[0]]);

    // An outgoing connection walked backwards: nothing is written and the reason sits in the form.
    const flowBefore = await yaml('flows/history-is-saved.yaml');
    await edgeLabel('Triggers the writer').click();
    await page.getByLabel('Step text').fill('Writer calls the queue');
    await page.getByLabel('Step direction').selectOption('reverse');
    await page.getByRole('button', { name: 'Add step', exact: true }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Step not added' });
    await alert.getByText(/E041/).waitFor();
    expect(await yaml('flows/history-is-saved.yaml')).toBe(flowBefore);
    // The suggested way out switches the direction and the same step is accepted.
    await alert.getByRole('button', { name: 'Add it as a reply instead' }).click();
    await page.getByRole('button', { name: 'Add step', exact: true }).click();
    await expect.poll(() => yaml('flows/history-is-saved.yaml')).toMatch(/text: Writer calls the queue\n\s+reply: true/);
  });
});
