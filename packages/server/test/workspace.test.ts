import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverWorkspace, Renderer, SharedBrowser } from '../src/index.js';

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

describe('SharedBrowser', () => {
  it('shared browser launches once and survives a renderer close', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const launch = vi.fn(async () => ({ close }) as any);
    const shared = new SharedBrowser(launch);
    const a = new Renderer(() => 'http://x', 't', shared);
    const b = new Renderer(() => 'http://x', 't', shared);

    const [one, two] = await Promise.all([shared.get(), shared.get()]);
    expect(one).toBe(two);
    expect(launch).toHaveBeenCalledTimes(1);

    await a.close();
    expect(close).not.toHaveBeenCalled();
    await b.close();
    expect(close).not.toHaveBeenCalled();

    await shared.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
