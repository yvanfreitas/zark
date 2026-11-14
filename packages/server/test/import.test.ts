import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type Running } from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../examples/ai-chat/architecture', import.meta.url));
const BANK = fileURLToPath(new URL('../../core/test/fixtures/structurizr-bank.json', import.meta.url));

describe('POST /api/import', () => {
  let root: string;
  let dir: string;
  let running: Running;
  const call = (body: unknown, token = running.token) =>
    fetch(`${running.url}/api/import`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-zark-token': token }, body: JSON.stringify(body) });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'zark-import-'));
    dir = join(root, 'architecture');
    await cp(EXAMPLE, dir, { recursive: true });
    running = await startServer({ dir, port: 0 });
  });
  afterAll(async () => {
    await running?.stop();
    await rm(root, { recursive: true, force: true });
  });

  it('requires the session token', async () => {
    expect((await call({ content: '{}' }, 'wrong')).status).toBe(401);
  });

  it('imports a Structurizr workspace into the existing project', async () => {
    const res = await call({ format: 'auto', content: await readFile(BANK, 'utf8') });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, format: 'structurizr' });
    expect(json.warnings.join('\n')).toMatch(/dynamicViews/);
    expect(existsSync(join(dir, 'entities/internet-banking-system.yaml'))).toBe(true);
    expect(json.problems.filter((p: { severity: string }) => p.severity === 'error')).toEqual([]);
  });

  it('answers 400 with a readable message for an unknown file', async () => {
    const res = await call({ content: '{"hello": 1}' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Formato não reconhecido/);
  });
});
