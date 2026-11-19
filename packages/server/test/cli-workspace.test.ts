import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commands } from '../../cli/src/commands.js';

describe('zark dev --workspace', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'zark-ws-cli-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));
  const dev = (args: string[], dirGiven = false) => commands.dev({ dir: join(root, 'x'), dirGiven, workspace: true, args, 'no-open': true });

  it('rejects --dir together with --workspace', async () => {
    expect(await dev([root], true)).toBe(2);
  });

  it('fails when no repo has architecture/zark.yaml', async () => {
    await expect(dev([root])).rejects.toThrow('No repos with architecture/zark.yaml under');
  });

  it('fails when the folder does not exist', async () => {
    await expect(dev([join(root, 'missing')])).rejects.toThrow('Folder not found:');
  });
});
