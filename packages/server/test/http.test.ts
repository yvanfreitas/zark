import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, type Running } from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../examples/ecommerce/architecture', import.meta.url));

let root: string;
let dir: string;
let srv: Running;
let base: string;

const lineDiff = (a: string, b: string) => {
  const la = a.split('\n'), lb = b.split('\n');
  return la.length === lb.length ? la.filter((l, i) => l !== lb[i]).length : Infinity;
};

const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'x-zark-token': srv.token, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
};

function rawRequest(headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: srv.port, path: '/api/model', method: 'GET', headers }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    });
    req.on('error', reject);
    req.end();
  });
}

/** Reads SSE events until `match` returns true or the timeout fires. */
async function waitForEvent(trigger: () => Promise<unknown>, match: (event: string, data: any) => boolean, timeout = 5000) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/events?token=${srv.token}`, { signal: ctrl.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let triggered = false;
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended');
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = /^event: (.*)$/m.exec(chunk)?.[1] ?? '';
        const data = JSON.parse(/^data: (.*)$/m.exec(chunk)?.[1] ?? '{}');
        if (event === 'hello' && !triggered) {
          triggered = true;
          await trigger();
        } else if (match(event, data)) return data;
      }
    }
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'zark-http-'));
  dir = join(root, 'architecture');
  await cp(EXAMPLE, dir, { recursive: true });
  srv = await startServer({ dir, port: 0, watch: true });
  base = `http://127.0.0.1:${srv.port}`;
});

afterAll(async () => {
  await srv?.stop();
  await rm(root, { recursive: true, force: true });
});

describe('security', () => {
  it('rejects missing token', async () => {
    const res = await fetch(`${base}/api/model`);
    expect(res.status).toBe(401);
  });
  it('rejects a foreign Host header', async () => {
    expect(await rawRequest({ host: 'evil.example:80', 'x-zark-token': srv.token })).toBe(403);
  });
  it('rejects a foreign Origin', async () => {
    expect(await rawRequest({ host: `127.0.0.1:${srv.port}`, origin: 'http://evil.example', 'x-zark-token': srv.token })).toBe(403);
  });
  it('accepts the token in the query string', async () => {
    const res = await fetch(`${base}/api/model?token=${srv.token}`);
    expect(res.status).toBe(200);
  });
});

describe('model and writes', () => {
  it('returns the model with hashes and no problems', async () => {
    const { status, body } = await call('GET', '/api/model');
    expect(status).toBe(200);
    expect(body.entities).toHaveLength(13);
    expect(body.files['entities/deco.yaml'].hash).toMatch(/^[0-9a-f]{16}$/);
    expect(body.problems).toEqual([]);
  });

  it('PATCH changes exactly one line and is reflected in GET', async () => {
    const before = await readFile(join(dir, 'entities/deco.yaml'), 'utf8');
    const r = await call('PATCH', '/api/entities/deco', { set: { caption: 'Frontend' } });
    expect(r.status).toBe(200);
    expect(r.body.changes).toEqual(['deco: caption alterado']);
    const after = await readFile(join(dir, 'entities/deco.yaml'), 'utf8');
    expect(lineDiff(before, after)).toBe(1);
    const { body } = await call('GET', '/api/model');
    expect(body.entities.find((e: any) => e.id === 'deco').caption).toBe('Frontend');
  });

  it('stale If-Match returns 409 with the current model', async () => {
    const r = await call('PATCH', '/api/entities/deco', { set: { caption: 'x' } }, { 'if-match': 'entities/deco.yaml=stale' });
    expect(r.status).toBe(409);
    expect(r.body.model.entities).toHaveLength(13);
  });

  it('a connection to a missing entity returns 422 with E020', async () => {
    const r = await call('POST', '/api/entities/cliente/connections', { connection: { id: 'x', to: 'nada', label: 'X' } });
    expect(r.status).toBe(422);
    expect(r.body.problems.map((p: any) => p.code)).toContain('E020');
  });

  it('delete without cascade returns impact; with cascade removes cleanly', async () => {
    const r = await call('DELETE', '/api/entities/linx');
    expect(r.body.ok).toBe(false);
    expect(r.body.impact.length).toBeGreaterThan(0);
    await expect(readFile(join(dir, 'entities/linx.yaml'), 'utf8')).resolves.toContain('id: linx');
    const ok = await call('DELETE', '/api/entities/linx?cascade=true');
    expect(ok.status).toBe(200);
    await expect(readFile(join(dir, 'entities/linx.yaml'), 'utf8')).rejects.toThrow();
    const v = await call('GET', '/api/validate');
    expect(v.body.problems.filter((p: any) => p.severity === 'error')).toEqual([]);
  });
});

describe('canvas ops and history', () => {
  it('move-nodes changes one line; undo restores exactly; redo re-applies', async () => {
    const path = join(dir, 'drawings/contexto.yaml');
    const original = await readFile(path, 'utf8');
    const r = await call('POST', '/api/drawings/contexto/ops', { ops: [{ op: 'move-nodes', nodes: [{ id: 'stone', x: 360, y: -296 }] }] });
    expect(r.status).toBe(200);
    const moved = await readFile(path, 'utf8');
    expect(lineDiff(original, moved)).toBe(1);
    expect((await call('POST', '/api/undo')).body.ok).toBe(true);
    expect(await readFile(path, 'utf8')).toBe(original);
    expect((await call('POST', '/api/redo')).body.ok).toBe(true);
    expect(await readFile(path, 'utf8')).toBe(moved);
  });
});

describe('events', () => {
  it('emits model.changed with origin external on disk edits', async () => {
    const path = join(dir, 'entities/trinio.yaml');
    const text = await readFile(path, 'utf8');
    const data = await waitForEvent(
      () => writeFile(path, text.replace('caption: Checkout', 'caption: Checkout externo')),
      (e, d) => e === 'model.changed' && d.origin === 'external',
    );
    expect(data.files).toContain('entities/trinio.yaml');
  });

  it('emits model.changed with origin ui on API writes', async () => {
    const data = await waitForEvent(
      () => call('PATCH', '/api/entities/stone', { set: { caption: 'Adquirente' } }),
      (e, d) => e === 'model.changed' && d.origin === 'ui',
    );
    expect(data.files).toContain('entities/stone.yaml');
  });
});
