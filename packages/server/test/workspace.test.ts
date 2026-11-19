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
  it('finds repos at any depth, keyed by relative path, sorted', async () => {
    root = await mkdtemp(join(tmpdir(), 'zark-ws-'));
    for (const p of ['b/architecture/zark.yaml', 'a/architecture/zark.yaml', 'my repo/architecture/zark.yaml', 'no-arch/README.md', 'deep/x/architecture/zark.yaml']) await file(p);
    const repos = await discoverWorkspace(root);
    expect(repos.map((r) => r.key)).toEqual(['a', 'b', 'deep/x', 'my repo']);
    expect(repos[2].prefix).toBe('/r/deep%2Fx');
    expect(repos[3].prefix).toBe('/r/my%20repo');
    expect(repos[2].root).toBe(join(root, 'deep', 'x'));
    expect(repos[0].dir).toBe(join(root, 'a', 'architecture'));
  });

  it('keeps walking inside a repo, skips dot and node_modules folders, never enters architecture/, ignores the root', async () => {
    root = await mkdtemp(join(tmpdir(), 'zark-ws-'));
    for (const p of [
      'architecture/zark.yaml', // the root itself is never a repo
      'mono/architecture/zark.yaml',
      'mono/packages/web/architecture/zark.yaml', // nested inside another repo
      'mono/architecture/inner/architecture/zark.yaml', // under architecture/: not descended
      '.hidden/r/architecture/zark.yaml',
      'node_modules/pkg/architecture/zark.yaml',
      'g/node_modules/pkg/architecture/zark.yaml',
    ]) await file(p);
    const repos = await discoverWorkspace(root);
    expect(repos.map((r) => r.key)).toEqual(['mono', 'mono/packages/web']);
  });

  it('stops at depth 8', async () => {
    root = await mkdtemp(join(tmpdir(), 'zark-ws-'));
    await file('1/2/3/4/5/6/7/8/architecture/zark.yaml');
    await file('1/2/3/4/5/6/7/8/9/architecture/zark.yaml');
    await file('ok/architecture/zark.yaml');
    expect((await discoverWorkspace(root)).map((r) => r.key)).toEqual(['1/2/3/4/5/6/7/8', 'ok']);
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

  it('does not cache a rejected launch', async () => {
    const browser = { close: vi.fn() } as any;
    const launch = vi.fn().mockRejectedValueOnce(new Error('no chromium')).mockResolvedValueOnce(browser);
    const shared = new SharedBrowser(launch);
    await expect(shared.get()).rejects.toThrow('no chromium');
    await expect(shared.get()).resolves.toBe(browser);
    expect(launch).toHaveBeenCalledTimes(2);
  });
});
