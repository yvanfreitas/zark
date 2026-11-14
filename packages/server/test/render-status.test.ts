// "Regerar imagens": which committed PNGs are out of date, and regenerating them.
import { existsSync, readdirSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';
import { chromium } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildProject, readTexts, type Project } from '@zark/core';
import { embedHash, renderHash, renderStatus, startServer, type Running } from '../src/index.js';

const EXAMPLES = fileURLToPath(new URL('../../../examples', import.meta.url));
// The example folder name is not fixed; take the first one with an architecture dir.
const EXAMPLE = readdirSync(EXAMPLES)
  .map((d) => join(EXAMPLES, d, 'architecture'))
  .find((d) => existsSync(join(d, 'zark.yaml')))!;
const UI = fileURLToPath(new URL('../../ui/dist', import.meta.url));
const hasUi = existsSync(join(UI, 'index.html'));

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function tinyPng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([0, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))]);
}

const roots: string[] = [];
async function copy(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zark-rstatus-'));
  roots.push(root);
  const dir = join(root, 'architecture');
  await cp(EXAMPLE, dir, { recursive: true });
  return dir;
}
const load = async (dir: string) => buildProject(dir, await readTexts(dir));
afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

/** Writes a PNG for every drawing whose embedded hash matches the model. */
async function writeCurrent(p: Project) {
  for (const id of p.drawings.keys()) await writeFile(join(p.dir, 'rendered', `${id}.png`), embedHash(tinyPng(), renderHash(p, { drawing: id })));
}
async function setConfig(dir: string, from: RegExp, to: string) {
  const file = join(dir, 'zark.yaml');
  await writeFile(file, (await readFile(file, 'utf8')).replace(from, to));
}
function firstNode(p: Project) {
  const [drawingId, { drawing }] = [...p.drawings].find(([, d]) => Object.keys(d.drawing.nodes ?? {}).length)!;
  const [nodeId, node] = Object.entries(drawing.nodes!)[0];
  return { drawingId, nodeId, node, file: `drawings/${drawingId}.yaml` };
}

describe('render status', () => {
  it('is empty when every committed PNG matches the model', async () => {
    const dir = await copy();
    await writeCurrent(await load(dir));
    expect((await renderStatus(await load(dir))).stale).toEqual([]);
  });

  it('flags an outdated drawing after a model change', async () => {
    const dir = await copy();
    await writeCurrent(await load(dir));
    const { drawingId, nodeId, node, file } = firstNode(await load(dir));
    const text = await readFile(join(dir, file), 'utf8');
    const line = new RegExp(`(\\n  ${nodeId}: \\{ x: )${node.x}(,)`);
    expect(text).toMatch(line);
    await writeFile(join(dir, file), text.replace(line, `$1${node.x + 8}$2`));
    const status = await renderStatus(await load(dir));
    expect(status.stale).toEqual([{ target: { drawing: drawingId }, file: `${drawingId}.png`, reason: 'outdated' }]);
  });

  it('flags a missing drawing PNG only when the project keeps renders', async () => {
    const dir = await copy();
    const p = await load(dir);
    await writeCurrent(p);
    const [first, ...rest] = [...p.drawings.keys()];
    await unlink(join(dir, 'rendered', `${first}.png`));
    expect((await renderStatus(await load(dir))).stale).toEqual([{ target: { drawing: first }, file: `${first}.png`, reason: 'missing' }]);
    // No PNG at all in `pr` mode: nothing is committed yet, nothing is missing.
    for (const id of rest) await unlink(join(dir, 'rendered', `${id}.png`));
    expect((await renderStatus(await load(dir))).stale).toEqual([]);
    // `always` keeps every drawing rendered.
    await setConfig(dir, /commit: \w+/, 'commit: always');
    expect((await renderStatus(await load(dir))).stale.map((s) => s.reason)).toEqual(p.drawings.size ? [...p.drawings.keys()].map(() => 'missing') : []);
  });

  it('never mode is never stale', async () => {
    const dir = await copy();
    await setConfig(dir, /commit: \w+/, 'commit: never');
    const p = await load(dir);
    await writeFile(join(dir, 'rendered', `${[...p.drawings.keys()][0]}.png`), embedHash(tinyPng(), 'wrong'));
    expect(await renderStatus(await load(dir))).toEqual({ commitMode: 'never', stale: [] });
  });

  it('checks flow PNGs only when they already exist', async () => {
    const dir = await copy();
    const p = await load(dir);
    await writeCurrent(p);
    const flowId = [...p.flows.keys()][0];
    expect((await renderStatus(p)).stale).toEqual([]);
    await writeFile(join(dir, 'rendered', `${flowId}.png`), embedHash(tinyPng(), 'wrong'));
    expect((await renderStatus(await load(dir))).stale).toEqual([{ target: { flow: flowId }, file: `${flowId}.png`, reason: 'outdated' }]);
    await writeFile(join(dir, 'rendered', `${flowId}.png`), embedHash(tinyPng(), renderHash(p, { flow: flowId })));
    expect((await renderStatus(await load(dir))).stale).toEqual([]);
  });
});

describe.skipIf(!hasUi)('regenerate images (real render)', () => {
  let running: Running | undefined;
  afterEach(async () => {
    await running?.stop();
    running = undefined;
  });

  it('POST /api/render/all re-renders stale PNGs and the status becomes empty', async () => {
    const dir = await copy();
    running = await startServer({ dir, port: 0, uiDir: UI });
    const api = (method: string, path: string) => fetch(`${running!.url}${path}`, { method, headers: { 'x-zark-token': running!.token } }).then((r) => r.json());
    const { drawingId, nodeId, node } = firstNode(running.service.project);
    const moved = await running.service.store.apply([{ op: 'drawing.move-nodes', drawing: drawingId, nodes: [{ id: nodeId, x: node.x + 8, y: node.y }] }], 'ui');
    expect(moved.ok).toBe(true);
    const before = await api('GET', '/api/render/status');
    expect(before.stale.map((s: { file: string }) => s.file)).toEqual([`${drawingId}.png`]);
    const r = await api('POST', '/api/render/all');
    expect(r.ok).toBe(true);
    expect(r.written).toEqual([`rendered/${drawingId}.png`]);
    expect(r.status.stale).toEqual([]);
    expect((await api('GET', '/api/render/status')).stale).toEqual([]);
  }, 120_000);

  it('the top bar button is enabled only while images are out of date', async () => {
    const dir = await copy();
    running = await startServer({ dir, port: 0, uiDir: UI, watch: true });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await page.goto(`${running.url}/?token=${running.token}`);
      const button = page.getByRole('button', { name: /Imagens em dia|Regerar .* imagem/ });
      await button.waitFor();
      expect(await button.isDisabled()).toBe(true);
      expect(await button.getAttribute('title')).toBe('Imagens em dia');

      // Edit the YAML on disk: the watcher reloads and the status follows live.
      const { drawingId, nodeId, node, file } = firstNode(running.service.project);
      const text = await readFile(join(dir, file), 'utf8');
      await writeFile(join(dir, file), text.replace(new RegExp(`(\\n  ${nodeId}: \\{ x: )${node.x}(,)`), `$1${node.x + 8}$2`));
      await page.waitForFunction(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.startsWith('Regerar imagens'));
        return !!b && !b.disabled && /1$/.test(b.textContent ?? '');
      }, undefined, { timeout: 10_000 });
      await page.screenshot({ path: join(tmpdir(), 'zark-regenerate-button.png'), clip: { x: 900, y: 0, width: 700, height: 48 } });

      await page.getByRole('button', { name: /Regerar 1 imagem/ }).click();
      await page.waitForFunction(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.startsWith('Regerar imagens'));
        return !!b && b.disabled && b.title === 'Imagens em dia';
      }, undefined, { timeout: 60_000 });
      expect((await renderStatus(running.service.project)).stale).toEqual([]);
      expect(drawingId).toBeTruthy();
    } finally {
      await browser.close();
    }
  }, 120_000);
});
