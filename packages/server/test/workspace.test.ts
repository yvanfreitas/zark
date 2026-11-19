import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverWorkspace } from '../src/index.js';

let root: string;

afterEach(() => rm(root, { recursive: true, force: true }));

async function file(path: string) {
  await mkdir(join(root, path, '..'), { recursive: true });
  await writeFile(join(root, path), '');
}

describe('discoverWorkspace', () => {
  it('finds direct children only, sorted', async () => {
    root = await mkdtemp(join(tmpdir(), 'zark-ws-'));
    for (const p of ['b/architecture/zark.yaml', 'a/architecture/zark.yaml', 'my repo/architecture/zark.yaml', 'no-arch/README.md', 'deep/x/architecture/zark.yaml']) await file(p);
    const repos = await discoverWorkspace(root);
    expect(repos.map((r) => r.key)).toEqual(['a', 'b', 'my repo']);
    expect(repos[2].prefix).toBe('/r/my%20repo');
    expect(repos[0].dir).toBe(join(root, 'a', 'architecture'));
  });

  it('errors when there are no repos', async () => {
    root = await mkdtemp(join(tmpdir(), 'zark-ws-'));
    await expect(discoverWorkspace(root)).rejects.toThrow(/No repos with architecture\/zark.yaml under/);
  });
});
