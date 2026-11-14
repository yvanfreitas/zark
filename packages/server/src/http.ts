import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve, type ServerType } from '@hono/node-server';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import { planImport, type ApplyResult, type Op } from '@zark/core';
import { GitError } from './git.js';
import type { ZarkService } from './service.js';

export type McpHttpHandler = (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void>;

export interface AppOptions {
  service: ZarkService;
  /** Built UI (index.html + assets). */
  uiDir?: string;
  mcp?: McpHttpHandler;
  /** Accepted Host/Origin port; filled in once the server listens. */
  port: () => number;
  readOnly?: boolean;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
};

export const newToken = () => randomBytes(24).toString('hex');

/** Parses `If-Match: path=hash, path2=hash2` (or a bare hash for `primary`). */
function expectFrom(c: Context, primary?: string): Record<string, string> | undefined {
  const header = c.req.header('if-match');
  if (!header) return undefined;
  const out: Record<string, string> = {};
  for (const part of header.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [a, b] = part.split('=');
    if (b !== undefined) out[a] = b.replace(/"/g, '');
    else if (primary) out[primary] = a.replace(/"/g, '');
  }
  return out;
}

export function createApp(opts: AppOptions) {
  const { service } = opts;
  const store = service.store;
  const app = new Hono();

  // --- security: local origin only, session token on every API call ---
  app.use('*', async (c, next) => {
    const port = opts.port();
    const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
    const host = c.req.header('host');
    if (!host || !allowed.includes(host)) return c.text('Host não permitido', 403);
    const origin = c.req.header('origin');
    if (origin && !allowed.map((h) => `http://${h}`).includes(origin)) return c.text('Origin não permitida', 403);
    await next();
  });
  const guarded = ['/api/*', '/mcp', '/mcp/*'];
  for (const path of guarded) {
    app.use(path, async (c, next) => {
      const token = c.req.header('x-zark-token') ?? c.req.query('token') ?? c.req.header('authorization')?.replace(/^Bearer /, '');
      if (token !== service.token) return c.json({ error: 'Token de sessão ausente ou inválido' }, 401);
      await next();
    });
  }

  const reply = (c: Context, result: ApplyResult) => {
    if (result.conflict) return c.json({ ok: false, error: result.error, conflict: result.conflict, model: store.snapshot() }, 409);
    if (result.impact) return c.json({ ok: false, error: result.error, impact: result.impact }, 200);
    if (result.newErrors.length) return c.json({ ok: false, error: result.error, problems: result.newErrors, changes: result.changes.map((x) => x.text) }, 422);
    if (!result.ok) return c.json({ ok: false, error: result.error }, 400);
    return c.json({
      ok: true,
      changedFiles: [...result.files.keys()],
      changes: result.changes.map((x) => x.text),
      hashes: Object.fromEntries([...result.files.keys()].map((p) => [p, store.project.files.get(p)?.hash ?? null])),
      problems: store.problems,
    });
  };
  const apply = async (c: Context, ops: Op[], primary?: string) => {
    if (opts.readOnly) return c.json({ ok: false, error: 'Somente leitura' }, 403);
    return reply(c, await store.apply(ops, 'ui', { expect: expectFrom(c, primary) }));
  };
  const body = async (c: Context) => (await c.req.json().catch(() => ({}))) as any;
  const entityFile = (id: string) => store.project.entities.get(id)?.file;

  app.get('/api/health', (c) => c.json({ ok: true, dir: service.dir }));
  app.get('/api/model', (c) => c.json(store.snapshot()));

  // Entities and connections
  app.post('/api/entities', async (c) => {
    const b = await body(c);
    const ops: Op[] = [{ op: 'entity.create', entity: b.entity }];
    if (b.place) ops.push({ op: 'drawing.place', drawing: b.place.drawing, nodes: [{ id: b.entity.id, x: b.place.x, y: b.place.y }] });
    return apply(c, ops);
  });
  app.patch('/api/entities/:id', async (c) => {
    const id = c.req.param('id');
    const b = await body(c);
    const ops: Op[] = [];
    if (b.set || b.unset) ops.push({ op: 'entity.update', id, set: b.set, unset: b.unset });
    if ('parent' in b) ops.push({ op: 'entity.move', id, parent: b.parent });
    return apply(c, ops, entityFile(id));
  });
  app.delete('/api/entities/:id', (c) => apply(c, [{ op: 'entity.delete', id: c.req.param('id'), cascade: c.req.query('cascade') === 'true' }], entityFile(c.req.param('id'))));
  app.post('/api/entities/:id/connections', async (c) => apply(c, [{ op: 'connection.create', from: c.req.param('id'), connection: (await body(c)).connection }], entityFile(c.req.param('id'))));
  app.patch('/api/connections/:ref', async (c) => {
    const ref = c.req.param('ref');
    const b = await body(c);
    const ops: Op[] = [];
    if (b.set || b.unset) ops.push({ op: 'connection.update', ref, set: b.set, unset: b.unset });
    if (b.reverse) ops.push({ op: 'connection.reverse', ref });
    return apply(c, ops, entityFile(ref.split('.')[0]));
  });
  app.delete('/api/connections/:ref', (c) => apply(c, [{ op: 'connection.delete', ref: c.req.param('ref'), cascade: c.req.query('cascade') === 'true' }], entityFile(c.req.param('ref').split('.')[0])));

  // Drawings
  const drawingFile = (id: string) => store.project.drawings.get(id)?.file;
  app.post('/api/drawings', async (c) => apply(c, [{ op: 'drawing.create', drawing: (await body(c)).drawing }]));
  app.patch('/api/drawings/:id', async (c) => {
    const b = await body(c);
    return apply(c, [{ op: 'drawing.update', id: c.req.param('id'), set: b.set, unset: b.unset }], drawingFile(c.req.param('id')));
  });
  app.post('/api/drawings/:id/ops', async (c) => {
    const drawing = c.req.param('id');
    const ops = ((await body(c)).ops ?? []).map((o: any) => ({ ...o, op: o.op.startsWith('drawing.') ? o.op : `drawing.${o.op}`, drawing }));
    if (ops.some((o: any) => !String(o.op).startsWith('drawing.'))) return c.json({ ok: false, error: 'Só operações de desenho' }, 400);
    return apply(c, ops, drawingFile(drawing));
  });
  app.post('/api/drawings/:id/layout', async (c) => apply(c, [{ op: 'drawing.auto-layout', drawing: c.req.param('id'), ids: (await body(c)).ids }], drawingFile(c.req.param('id'))));
  app.delete('/api/drawings/:id', (c) => apply(c, [{ op: 'drawing.delete', id: c.req.param('id') }], drawingFile(c.req.param('id'))));

  // Flows
  const flowFile = (id: string) => store.project.flows.get(id)?.file;
  app.post('/api/flows', async (c) => apply(c, [{ op: 'flow.create', flow: (await body(c)).flow }]));
  app.patch('/api/flows/:id', async (c) => {
    const b = await body(c);
    return apply(c, [{ op: 'flow.update', id: c.req.param('id'), set: b.set, unset: b.unset }], flowFile(c.req.param('id')));
  });
  app.delete('/api/flows/:id', (c) => apply(c, [{ op: 'flow.delete', id: c.req.param('id') }], flowFile(c.req.param('id'))));

  // Generic batch and history (used by the UI for multi-file edits and undo).
  app.post('/api/ops', async (c) => {
    const b = await body(c);
    if (opts.readOnly) return c.json({ ok: false, error: 'Somente leitura' }, 403);
    return reply(c, await store.apply(b.ops ?? [], 'ui', { expect: b.expect ?? expectFrom(c), dryRun: b.dryRun }));
  });
  // Import a Structurizr workspace or an IcePanel model (format "auto" detects it). Same rules as any write.
  app.post('/api/import', async (c) => {
    if (opts.readOnly) return c.json({ ok: false, error: 'Somente leitura' }, 403);
    const b = await body(c);
    if (typeof b.content !== 'string' || !b.content.trim()) return c.json({ ok: false, error: 'Envie o conteúdo do arquivo em "content"' }, 400);
    let plan: ReturnType<typeof planImport>;
    try {
      plan = planImport(b.content, b.format, store.project);
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 400);
    }
    const res = reply(c, await store.apply(plan.ops, 'ui', { dryRun: b.dryRun }));
    const json = await res.json();
    return c.json({ ...json, format: plan.format, warnings: plan.warnings }, res.status as 200);
  });
  app.post('/api/undo', async (c) => c.json(await store.undo('ui')));
  app.post('/api/redo', async (c) => c.json(await store.redo('ui')));

  // Project
  app.get('/api/validate', (c) => c.json({ problems: store.problems }));
  app.get('/api/diff', async (c) => {
    try {
      return c.json(await service.diff(c.req.query('base')));
    } catch (err) {
      return c.json({ error: (err as Error).message, changes: [] }, 400);
    }
  });
  app.post('/api/render', async (c) => {
    const b = await body(c);
    try {
      const out = await service.render({ drawing: b.drawing, flow: b.flow, step: b.step }, !!b.commit);
      return c.json({ ok: true, file: out.file, hash: out.hash, skipped: out.skipped, url: `/api/render/file?path=${encodeURIComponent(out.path)}` });
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 400);
    }
  });
  app.get('/api/render/file', async (c) => {
    const path = resolve(c.req.query('path') ?? '');
    const roots = [resolve(service.dir, 'rendered'), resolve(service.dir, '..', '.zark', 'cache')];
    if (!roots.some((r) => path.startsWith(r + (process.platform === 'win32' ? '\\' : '/'))) || !path.endsWith('.png')) return c.text('Caminho não permitido', 403);
    const data = await readFile(path).catch(() => undefined);
    return data ? c.body(new Uint8Array(data), 200, { 'content-type': 'image/png', 'cache-control': 'no-store' }) : c.notFound();
  });

  // Git and PR
  const gitError = (c: Context, err: unknown) => c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, err instanceof GitError ? 400 : 500);
  app.get('/api/git/status', async (c) => c.json(await service.gitStatus()));
  app.post('/api/git/discard', async (c) => {
    try {
      await service.discard((await body(c)).files ?? []);
      return c.json({ ok: true });
    } catch (err) {
      return gitError(c, err);
    }
  });
  app.post('/api/pr/preview', async (c) => {
    try {
      return c.json(await service.prPreview(await body(c)));
    } catch (err) {
      return gitError(c, err);
    }
  });
  app.post('/api/pr', async (c) => {
    if (opts.readOnly) return c.json({ ok: false, error: 'Somente leitura' }, 403);
    try {
      return c.json({ ok: true, ...(await service.createPr(await body(c))) });
    } catch (err) {
      return gitError(c, err);
    }
  });

  // Events (SSE)
  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const send = (event: string) => (data: unknown) => void stream.writeSSE({ event, data: JSON.stringify(data) });
      const handlers = Object.fromEntries(['model.changed', 'problems.changed', 'render.done', 'git.changed'].map((e) => [e, send(e)]));
      for (const [e, h] of Object.entries(handlers)) store.on(e, h);
      await stream.writeSSE({ event: 'hello', data: JSON.stringify({ ok: true }) });
      const ping = setInterval(() => void stream.writeSSE({ event: 'ping', data: '{}' }), 20_000);
      await new Promise<void>((done) => stream.onAbort(done));
      clearInterval(ping);
      for (const [e, h] of Object.entries(handlers)) store.off(e, h);
    }),
  );

  // MCP over HTTP (same token)
  if (opts.mcp) {
    const handle = async (c: Context) => {
      const { incoming, outgoing } = c.env as { incoming: IncomingMessage; outgoing: ServerResponse };
      const payload = c.req.method === 'POST' ? await c.req.json().catch(() => undefined) : undefined;
      await opts.mcp!(incoming, outgoing, payload);
      return RESPONSE_ALREADY_SENT;
    };
    app.all('/mcp', handle);
  }

  // UI (SPA). Static files need no token; the API does.
  app.get('*', async (c) => {
    if (!opts.uiDir || !existsSync(opts.uiDir)) return c.text('UI não encontrada. Rode "pnpm --filter @zark/ui build".', 404);
    const rel = normalize(decodeURIComponent(new URL(c.req.url).pathname)).replace(/^[\\/]+/, '');
    const file = join(opts.uiDir, rel);
    if (rel && file.startsWith(opts.uiDir) && existsSync(file) && extname(file)) {
      const cache = rel.startsWith('assets') ? 'public, max-age=31536000, immutable' : 'no-cache';
      return c.body(new Uint8Array(await readFile(file)), 200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': cache });
    }
    // The UI is built with relative asset paths (for `zark build`); deep routes
    // like /render/drawing/x need them anchored at the server root.
    const html = await readFile(join(opts.uiDir, 'index.html'), 'utf8');
    return c.html(html.replace('<head>', '<head><base href="/">'));
  });

  return app;
}

export interface Started {
  server: ServerType;
  port: number;
  url: string;
  close: () => Promise<void>;
}

/** Binds to 127.0.0.1 unless a host is passed explicitly. Port 0 picks a free one. */
export function listen(app: Hono, port: number, host = '127.0.0.1'): Promise<Started> {
  return new Promise((resolveStart, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
      resolveStart({
        server,
        port: info.port,
        url: `http://127.0.0.1:${info.port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
    server.on('error', reject);
  });
}
