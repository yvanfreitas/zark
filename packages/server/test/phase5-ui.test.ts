// Fase 5 acceptance, automated: the "Compra com estoque da loja" flow is built
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

const EXAMPLE = fileURLToPath(new URL('../../../examples/ecommerce/architecture', import.meta.url));
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
  // A reply step's name ends with "(resposta)", so match the text as a prefix.
  const stepButton = (text: string) => page.getByRole('button', { name: new RegExp('^' + escape(text)) });
  const stepRow = (text: string) => page.locator('div.group', { has: stepButton(text) });

  async function addStep(connectionLabel: string, text: string, sense?: 'reply' | 'reverse') {
    await label(connectionLabel).click();
    await page.getByLabel('Texto do passo').fill(text);
    if (sense) await page.getByLabel('Sentido do passo').selectOption(sense);
    await page.getByRole('button', { name: 'Adicionar passo', exact: true }).click();
  }

  it('builds, saves and plays the flow; refuses a step against the connection', async () => {
    await page.goto(`${running.url}/?token=${running.token}`);
    await page.locator('.react-flow__node').first().waitFor();

    await page.getByRole('tab', { name: 'Fluxos' }).click();
    await page.getByRole('button', { name: 'Novo fluxo' }).click();
    await page.keyboard.type('Compra montada pela UI');
    await page.keyboard.press('Enter');
    await page.getByText('Clique numa conexão do canvas para adicionar um passo sobre ela.').waitFor();

    const steps: [string, string, ('reply' | undefined)?][] = [
      ['Navega e compra', 'Dados da compra'],
      ['Redireciona para o checkout', 'Redireciona o cliente'],
      ['Realiza o pagamento', 'Realiza o pagamento'],
      ['Pedidos', 'Cria o pedido'],
      ['Cria o pedido de transporte', 'Cria o pedido de transporte'],
      ['Baixa de estoque', 'Atualiza o inventário'],
      ['Solicita coleta', 'Solicita coleta'],
      ['Cria o pedido de transporte', 'Devolve erro de cotação', 'reply'],
      ['Atualização de inventário', 'Atualiza o estoque'],
    ];
    for (const [conn, text, sense] of steps) {
      await addStep(conn, text, sense);
      // The save landed when the step shows up in the list.
      await stepButton(text).last().waitFor();
    }

    await stepRow('Cria o pedido de transporte').first().getByRole('button', { name: '∥ próximo' }).click();
    await page.getByText('Em paralelo', { exact: true }).waitFor();
    await stepRow('Solicita coleta').getByRole('button', { name: 'ou próximo' }).click();
    await page.getByText('Alternativas', { exact: true }).waitFor();

    const pathName = page.getByLabel('Nome do caminho');
    await pathName.nth(0).fill('Coleta agendada');
    await pathName.nth(0).press('Enter');
    await page.getByRole('tab', { name: 'Coleta agendada' }).waitFor();
    await pathName.nth(1).fill('Sem transportadora disponível');
    await pathName.nth(1).press('Enter');
    await page.getByRole('tab', { name: 'Sem transportadora disponível' }).waitFor();

    // Same structure as the appendix flow (ids are generated from the text).
    const project = buildProject(dir, await readTexts(dir));
    const built = project.flows.get('compra-montada-pela-ui')!.flow;
    const original = project.flows.get('compra-com-estoque-da-loja')!.flow;
    expect(built.drawing).toBe(original.drawing);
    expect(shape(built.steps)).toEqual(shape(original.steps));
    expect(errorsOf(validate(project))).toEqual([]);

    // A step against Linx -> Síntese is refused with the suggested fix.
    await addStep('Inventário', 'Pede inventário na contramão', 'reverse');
    const toast = page.getByText(/E041/);
    await toast.waitFor();
    expect(await toast.textContent()).toContain('Inverta a conexão');
    expect(errorsOf(running.service.store.problems)).toEqual([]);
    const after = buildProject(dir, await readTexts(dir)).flows.get('compra-montada-pela-ui')!.flow;
    expect(shape(after.steps)).toEqual(shape(original.steps));

    // Playback: the 5th frame shows both parallel steps at once.
    await page.getByRole('button', { name: 'Ir para o início' }).click();
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Próximo (→)' }).click();
    const numbers = page.locator('.react-flow__edgelabel-renderer span.font-mono');
    await expect.poll(async () => (await numbers.allTextContents()).sort()).toEqual(['5a', '5b']);
  }, 120_000);
});
