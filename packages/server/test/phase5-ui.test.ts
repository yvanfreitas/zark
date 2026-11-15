// Fase 5 acceptance, automated: the example's main chat flow is built
// through the UI only and played back; a step against the connection is refused
// with the suggested fix. Real server + built UI + headless Chromium.
import { existsSync } from 'node:fs';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProject, errorsOf, readTexts, validate, type FlowItem } from '@zark/core';
import { startServer, type Running } from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../examples/ai-chat/architecture', import.meta.url));
const UI = fileURLToPath(new URL('../../ui/dist', import.meta.url));

/** Flow structure without ids: what the acceptance compares. */
function shape(items: FlowItem[] | undefined): unknown[] {
  return (items ?? []).map((item) => {
    if ('via' in item) return { via: item.via, text: item.text, reply: !!item.reply, reverse: !!item.reverse };
    if ('parallel' in item) return { parallel: item.parallel.map(shape) };
    if ('alternatives' in item) return { alternatives: item.alternatives.map((a) => ({ name: a.name, steps: shape(a.steps) })) };
    return item;
  });
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe.skipIf(!existsSync(join(UI, 'index.html')))('fase 5: fluxo montado pela UI', () => {
  let root: string;
  let dir: string;
  let running: Running;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'zark-phase5-'));
    dir = join(root, 'architecture');
    await cp(EXAMPLE, dir, { recursive: true });
    running = await startServer({ dir, port: 0, uiDir: UI, watch: true });
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  });
  afterAll(async () => {
    await browser?.close();
    await running?.stop();
    await rm(root, { recursive: true, force: true });
  });

  const label = (text: string) => page.locator('.react-flow__edgelabel-renderer span', { hasText: new RegExp(`^${escape(text)}$`) }).first();
  // A reply step's name ends with "(reply)", so match the text as a prefix.
  const stepButton = (text: string) => page.getByRole('button', { name: new RegExp('^' + escape(text)) });
  const stepRow = (text: string) => page.locator('div.group', { has: stepButton(text) });

  async function addStep(connectionLabel: string, text: string, sense?: 'reply' | 'reverse') {
    await label(connectionLabel).click();
    await page.getByLabel('Step text').fill(text);
    if (sense) await page.getByLabel('Step direction').selectOption(sense);
    await page.getByRole('button', { name: 'Add step', exact: true }).click();
  }

  it('builds, saves and plays the flow; refuses a step against the connection', async () => {
    await page.goto(`${running.url}/?token=${running.token}`);
    await page.locator('.react-flow__node').first().waitFor();

    // The example flow runs on the platform drawing; a new flow is created on the open drawing.
    await page.getByRole('button', { name: /^Papo platform/ }).first().click();
    await page.locator('.react-flow__node[data-id="bot-queue"]').waitFor();
    await page.getByRole('button', { name: 'New flow' }).click();
    await page.keyboard.type('Chat built in the UI');
    await page.keyboard.press('Enter');
    await page.getByText('Click a connection on the canvas to add a step over it.').waitFor();

    const steps: [string, string, ('reply' | 'reverse' | undefined)?][] = [
      ['Real-time messages', 'Sends the message'],
      ['Checks the token', 'Checks the token'],
      ['Forwards the message', 'Forwards the message'],
      ['Publishes the message', 'Publishes to the topic'],
      ['History subscription', 'Delivers to history'],
      ['Bot subscription', 'Delivers to the bot'],
      ['Triggers the bot', 'Triggers the bot'],
      ['Reads the context', 'Reads the context'],
      ['Classifies the content', 'Classifies the content'],
      ['Generates the answer', 'Generates the answer'],
      ['Classifies the content', 'Returns the block', 'reply'],
      ['Sends the answer', 'Sends the answer'],
      ['Real-time messages', 'Shows the answer', 'reverse'],
    ];
    for (const [conn, text, sense] of steps) {
      await addStep(conn, text, sense);
      // The save landed when the step shows up in the list.
      await stepButton(text).last().waitFor();
    }

    // Grouping lives in each step's menu ("⋯" or right-click on the step).
    const stepAction = async (text: string, action: string) => {
      await stepRow(text).first().getByRole('button', { name: 'Step actions' }).click();
      await page.getByRole('menuitem', { name: action }).click();
    };
    await stepAction('Delivers to history', 'Run in parallel with the next step');
    await page.getByText('In parallel', { exact: true }).waitFor();
    await stepAction('Generates the answer', 'Make an alternative to the next step');
    await page.getByText('Alternatives', { exact: true }).waitFor();

    const pathName = page.getByLabel('Path name');
    await pathName.nth(0).fill('Content approved');
    await pathName.nth(0).press('Enter');
    await page.getByRole('tab', { name: 'Content approved' }).waitFor();
    await pathName.nth(1).fill('Content blocked');
    await pathName.nth(1).press('Enter');
    await page.getByRole('tab', { name: 'Content blocked' }).waitFor();

    // Same structure as the appendix flow (ids are generated from the text).
    const project = buildProject(dir, await readTexts(dir));
    const built = project.flows.get('chat-built-in-the-ui')!.flow;
    const original = project.flows.get('user-chats-with-the-bot')!.flow;
    expect(built.drawing).toBe(original.drawing);
    expect(shape(built.steps)).toEqual(shape(original.steps));
    expect(errorsOf(validate(project))).toEqual([]);

    // A step against Papo app -> Auth (outgoing) is refused with the suggested fix.
    await addStep('Signs in', 'Auth calls the app', 'reverse');
    // The reason shows inside the add-step form, not in a passing toast.
    const reason = page.getByRole('alert').filter({ hasText: 'Step not added' }).getByText(/E041/);
    await reason.waitFor();
    expect(await reason.textContent()).toContain('Reverse the connection');
    expect(errorsOf(running.service.store.problems)).toEqual([]);
    const after = buildProject(dir, await readTexts(dir)).flows.get('chat-built-in-the-ui')!.flow;
    expect(shape(after.steps)).toEqual(shape(original.steps));

    // Playback: the 5th frame shows both parallel steps at once.
    await page.getByRole('button', { name: 'Go to start' }).click();
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Next (→)' }).click();
    const numbers = page.locator('.react-flow__edgelabel-renderer span.font-mono');
    await expect.poll(async () => (await numbers.allTextContents()).sort()).toEqual(['5a', '5b']);
  }, 120_000);
});
