import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { request } from 'node:http';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRunning, startServer, startWorkspace, type Running, type RunningWorkspace } from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../examples/ai-chat/architecture', import.meta.url));

const copyRepo = (root: string, name: string) => cp(EXAMPLE, join(root, name, 'architecture'), { recursive: true });

function rawRequest(port: number, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    });
    req.on('error', reject);
    req.end();
  });
}

/** Opens an SSE stream, waits for `hello`, runs `trigger`, then collects event names for `ms`. */
async function eventsDuring(url: string, trigger: () => Promise<unknown>, ms: number) {
  const ctrl = new AbortController();
  const res = await fetch(url, { signal: ctrl.signal });
  if (!res.ok) throw new Error(`SSE ${url} returned ${res.status}`);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: string[] = [];
  let buffer = '';
  let deadline: Promise<void> | undefined;
  try {
    while (true) {
      const next = reader.read();
      const r = deadline ? await Promise.race([next, deadline.then(() => undefined)]) : await next;
      if (!r) return events;
      if (r.done) throw new Error('stream ended');
      buffer += decoder.decode(r.value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const event = /^event: (.*)$/m.exec(buffer.slice(0, idx))?.[1] ?? '';
        buffer = buffer.slice(idx + 2);
        if (event === 'hello' && !deadline) {
          await trigger();
          deadline = new Promise((r) => setTimeout(r, ms));
        } else events.push(event);
      }
    }
  } finally {
    ctrl.abort();
  }
}

describe('startWorkspace', () => {
  let root: string;
  let ws: RunningWorkspace;
  let stopped = false;
  let base: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'zark-wshttp-'));
    for (const name of ['a', 'my repo', 'bad']) await copyRepo(root, name);
    const user = join(root, 'bad', 'architecture', 'entities', 'user.yaml');
    await writeFile(user, (await readFile(user, 'utf8')).replace('to: papo-app', 'to: nada'));
    ws = await startWorkspace({ root, port: 0, watch: true, advertise: true });
    base = `http://127.0.0.1:${ws.port}`;
  }, 60_000);

  afterAll(async () => {
    if (!stopped) await ws?.stop();
    await rm(root, { recursive: true, force: true });
  });

  const get = (path: string) => fetch(`${base}${path}`, { headers: { 'x-zark-token': ws.token } });

  it('lists the repos', async () => {
    const res = await get('/api/workspace');
    expect(res.status).toBe(200);
    const { repos } = await res.json();
    expect(repos.map((r: any) => r.key)).toEqual(['a', 'bad', 'my repo']);
    const byKey = Object.fromEntries(repos.map((r: any) => [r.key, r]));
    expect(byKey.bad.errors).toBeGreaterThan(0);
    expect(byKey.a.errors).toBe(0);
    expect(byKey['my repo'].prefix).toBe('/r/my%20repo');
    expect(byKey.a.drawings).toBeGreaterThan(0);
  });

  it('edits only the addressed repo', async () => {
    const aUser = join(root, 'a', 'architecture', 'entities', 'user.yaml');
    const otherUser = join(root, 'my repo', 'architecture', 'entities', 'user.yaml');
    const aBefore = await readFile(aUser, 'utf8');
    const otherBefore = await readFile(otherUser, 'utf8');
    let status = 0;
    const events = await eventsDuring(
      `${base}/r/my%20repo/api/events?token=${ws.token}`,
      async () => {
        const res = await fetch(`${base}/r/a/api/entities/user`, {
          method: 'PATCH',
          headers: { 'x-zark-token': ws.token, 'content-type': 'application/json' },
          body: JSON.stringify({ set: { caption: 'Only in a' } }),
        });
        status = res.status;
        await res.text();
      },
      500,
    );
    expect(status).toBe(200);
    expect(await readFile(aUser, 'utf8')).not.toBe(aBefore);
    expect(await readFile(aUser, 'utf8')).toContain('caption: Only in a');
    expect(await readFile(otherUser, 'utf8')).toBe(otherBefore);
    expect(events).not.toContain('model.changed');
  });

  it('guards prefixed routes', async () => {
    expect((await fetch(`${base}/r/a/api/model`)).status).toBe(401);
    expect(await rawRequest(ws.port, '/r/a/api/model', { host: 'evil:1', 'x-zark-token': ws.token })).toBe(403);
    expect((await get('/r/a/api/model')).status).toBe(200);
    expect((await fetch(`${base}/api/workspace`)).status).toBe(401);
  });

  it('advertises base', async () => {
    const file = join(root, 'a', '.zark', 'server.json');
    const info = JSON.parse(await readFile(file, 'utf8'));
    expect(info).toMatchObject({ port: ws.port, token: ws.token, pid: process.pid, base: '/r/a' });
    expect(await findRunning(join(root, 'a', 'architecture'))).toMatchObject({ port: ws.port, base: '/r/a' });
    await ws.stop();
    stopped = true;
    expect(existsSync(file)).toBe(false);
  });
});

describe('startWorkspace next to a live zark dev', () => {
  let root: string;
  let single: Running;
  let ws: RunningWorkspace;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'zark-wslive-'));
    await copyRepo(root, 'c');
    single = await startServer({ dir: join(root, 'c', 'architecture'), port: 0, advertise: true });
    ws = await startWorkspace({ root, port: 0 });
  }, 60_000);

  afterAll(async () => {
    await ws?.stop();
    await single?.stop();
    await rm(root, { recursive: true, force: true });
  });

  it('skips a repo with a live server', async () => {
    const c = ws.repos.find((r) => r.key === 'c')!;
    expect(c.running?.url).toContain(`:${single.port}/`);
    expect(ws.services.has('c')).toBe(false);
    // The live server's file is left alone.
    const info = JSON.parse(await readFile(join(root, 'c', '.zark', 'server.json'), 'utf8'));
    expect(info.port).toBe(single.port);
  });
});

describe('startWorkspace default port', () => {
  const listenOn = (port: number) =>
    new Promise<Server | undefined>((resolve) => {
      const s = createServer();
      s.once('error', () => resolve(undefined));
      s.listen(port, '127.0.0.1', () => resolve(s));
    });
  const closeNet = (s: Server) => new Promise<void>((r) => s.close(() => r()));

  it('falls back from a taken default port', async () => {
    // If 4317 is already held by another process, it is taken either way.
    const blocker = await listenOn(4317);
    const root = await mkdtemp(join(tmpdir(), 'zark-wsport-'));
    let ws: RunningWorkspace | undefined;
    try {
      await copyRepo(root, 'a');
      ws = await startWorkspace({ root });
      expect(ws.port).not.toBe(4317);
    } finally {
      await ws?.stop();
      if (blocker) await closeNet(blocker);
      await rm(root, { recursive: true, force: true });
    }
  });
});
