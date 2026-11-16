import { existsSync } from 'node:fs';
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from '../../cli/src/commands.js';

const FIXTURE = fileURLToPath(new URL('../../core/test/fixtures/code', import.meta.url));

describe('zark scan', () => {
  let root: string;
  let dir: string;
  let out: string[];
  const scan = (args: string[] = [], check = false) => commands.scan({ dir, args, check });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'zark-scan-'));
    await cp(FIXTURE, root, { recursive: true });
    dir = join(root, 'architecture');
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it('writes graphs and --check passes', async () => {
    expect(await scan()).toBe(0);
    expect(existsSync(join(dir, 'code/bot.yaml'))).toBe(true);
    expect(out.some((l) => /^written code\/bot\.yaml {2}modules \d+, pieces \d+, edges \d+, unresolved \d+ calls \/ \d+ external \/ \d+ unowned/.test(l))).toBe(true);
    out = [];
    expect(await scan([], true)).toBe(0);
    expect(out).toContain('Code graphs are up to date');
  });

  it('--check fails after a source edit', async () => {
    await scan();
    await appendFile(join(root, 'services/bot/src/helpers.ts'), '\nexport function addedLater() { return 1; }\n');
    out = [];
    expect(await scan([], true)).toBe(1);
    expect(out.some((l) => l.startsWith('stale code/bot.yaml'))).toBe(true);
    expect(out).toContain('1 code graph(s) out of date. Run "zark scan"');
    expect(await readFile(join(dir, 'code/bot.yaml'), 'utf8')).not.toContain('addedLater');
  });

  it('unknown component id errors listing components with source', async () => {
    await expect(scan(['nope'])).rejects.toThrow(/Component "nope".*bot, moderation/);
  });

  it('exits 1 on a claim error (E014, source matches nothing)', async () => {
    const f = join(dir, 'entities/bot.yaml');
    await writeFile(f, (await readFile(f, 'utf8')).replace('source: services/bot', 'source: services/missing'));
    expect(await scan()).toBe(1);
    expect(out.some((l) => l.includes('E014'))).toBe(true);
  });
});
