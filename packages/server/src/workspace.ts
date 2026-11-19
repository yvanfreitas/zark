import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Hono } from 'hono';
import { writeAtomic } from '@zark/core';
import { createApp, guard, listen, newToken, serveUi, type McpHttpHandler, type Started } from './http.js';
import { findRunning, serverFile } from './index.js';
import { SharedBrowser } from './render.js';
import { ZarkService } from './service.js';
import { ProjectStore } from './store.js';

export interface WorkspaceRepo {
  key: string;
  prefix: string;
  /** The repo folder. */
  root: string;
  /** `<root>/architecture`. */
  dir: string;
}

const MAX_DEPTH = 8;

/**
 * Finds every folder under `root` (not `root` itself) that contains `architecture/zark.yaml`, at depth
 * <= 8, keyed by its `/`-joined relative path and sorted by key. Keeps walking inside a repo, but skips
 * dot folders, `node_modules`, `architecture/`, symlinks and unreadable folders.
 */
export async function discoverWorkspace(root: string): Promise<WorkspaceRepo[]> {
  const repos: WorkspaceRepo[] = [];
  const walk = async (dir: string, segments: string[]): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable folder
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'architecture') continue;
      const path = join(dir, e.name);
      const parts = [...segments, e.name];
      if (existsSync(join(path, 'architecture', 'zark.yaml'))) {
        const key = parts.join('/');
        repos.push({ key, prefix: `/r/${encodeURIComponent(key)}`, root: path, dir: join(path, 'architecture') });
      }
      if (parts.length < MAX_DEPTH) await walk(path, parts);
    }
  };
  await walk(root, []);
  if (repos.length === 0) throw new Error(`No repos with architecture/zark.yaml under ${root}`);
  return repos.sort((a, b) => a.key.localeCompare(b.key));
}

export interface WorkspaceOptions {
  root: string;
  /** Default 4317, falling back to a free port when it is taken. An explicit port does not fall back. */
  port?: number;
  host?: string;
  uiDir?: string;
  mcp?: (service: ZarkService) => McpHttpHandler;
  watch?: boolean;
  /** Write each loaded repo's .zark/server.json with its `base`. */
  advertise?: boolean;
}

export interface WorkspaceEntry {
  key: string;
  prefix: string;
  name: string;
  dir: string;
  drawings: number;
  errors: number;
  warnings: number;
  /** Drawings with no scope (the first level of the repo's tree), in model order. */
  roots: { id: string; name: string }[];
  /** Set when the repo already has its own live server; the workspace does not load it. */
  running?: { url: string };
}

export interface RunningWorkspace extends Started {
  token: string;
  repos: WorkspaceEntry[];
  services: Map<string, ZarkService>;
  stop(): Promise<void>;
}

const DEFAULT_PORT = 4317;

/**
 * Hono matches routes against the request path after `decodeURI` (keeping
 * `%25`), so mount each prefix in that same form: `/r/my%20repo` is served
 * as `/r/my repo`, while reserved escapes such as `%23` stay encoded.
 */
const mountPath = (prefix: string) => decodeURI(prefix.replace(/%25/g, '%2525'));

/** Serves every repo under `root` at `/r/<repo>` on one port with one token. */
export async function startWorkspace(opts: WorkspaceOptions): Promise<RunningWorkspace> {
  const token = newToken();
  let port = 0;
  const browser = new SharedBrowser();
  const services = new Map<string, ZarkService>();
  const listed: { repo: WorkspaceRepo; running?: { url: string } }[] = [];
  const app = new Hono();
  guard(app, () => port, token);

  for (const repo of await discoverWorkspace(opts.root)) {
    const live = await findRunning(repo.dir);
    if (live) {
      listed.push({ repo, running: { url: `http://127.0.0.1:${live.port}${live.base}/?token=${live.token}` } });
      continue;
    }
    let store: ProjectStore;
    try {
      store = await new ProjectStore(repo.dir).load();
    } catch (err) {
      console.warn(`Skipping ${repo.root}: ${(err as Error).message}`);
      continue;
    }
    if (opts.watch) store.watch();
    const service = new ZarkService(store, () => `http://127.0.0.1:${port}${repo.prefix}`, token, { browser });
    if (opts.watch) service.enableAutoRender();
    service.enableRenderStatus();
    services.set(repo.key, service);
    app.route(mountPath(repo.prefix), createApp({ service, mcp: opts.mcp?.(service), port: () => port, serveUi: false }));
    listed.push({ repo });
  }

  const entries = (): WorkspaceEntry[] =>
    listed.map(({ repo, running }) => {
      const service = services.get(repo.key);
      const base = { key: repo.key, prefix: repo.prefix, dir: repo.dir };
      // A repo served elsewhere is not loaded here, so it has no counts.
      if (!service) return { ...base, name: repo.key, drawings: 0, errors: 0, warnings: 0, roots: [], running };
      const problems = service.store.problems;
      return {
        ...base,
        name: service.project.config.name,
        drawings: service.project.drawings.size,
        errors: problems.filter((p) => p.severity === 'error').length,
        warnings: problems.filter((p) => p.severity === 'warning').length,
        roots: [...service.project.drawings.values()].filter(({ drawing }) => !drawing.scope).map(({ drawing }) => ({ id: drawing.id, name: drawing.name })),
      };
    });
  app.get('/api/workspace', (c) => c.json({ name: basename(opts.root), repos: entries() }));
  // A repo that is not mounted here (stale bookmark, or served by its own `zark dev`) must not fall to the SPA.
  app.all('/r/:repo/api/*', (c) => c.json({ error: `Unknown repo: ${c.req.param('repo')}` }, 404));
  serveUi(app, opts.uiDir);

  /** Closes every service even if one fails, then the shared browser; logs rejected closes. */
  const closeAll = async () => {
    const results = await Promise.allSettled([...services.values()].map((s) => s.close()));
    for (const r of results) if (r.status === 'rejected') console.warn(`Closing a repo failed: ${String(r.reason)}`);
    await browser.close();
  };
  let started: Started;
  try {
    started = await listen(app, opts.port ?? DEFAULT_PORT, opts.host).catch((err: NodeJS.ErrnoException) => {
      if (opts.port === undefined && err.code === 'EADDRINUSE') return listen(app, 0, opts.host);
      throw err;
    });
  } catch (err) {
    await closeAll().catch(() => undefined);
    throw err;
  }
  port = started.port;

  const advertised: string[] = [];
  if (opts.advertise) {
    for (const { repo } of listed) {
      if (!services.has(repo.key)) continue;
      const file = serverFile(repo.dir);
      try {
        await writeAtomic(file, JSON.stringify({ port, token, pid: process.pid, base: repo.prefix }) + '\n');
        advertised.push(file);
      } catch (err) {
        console.warn(`Not advertising ${repo.root}: ${(err as Error).message}`);
      }
    }
  }

  return {
    ...started,
    token,
    get repos() {
      return entries();
    },
    services,
    stop: async () => {
      for (const file of advertised) await rm(file, { force: true });
      try {
        await closeAll();
      } finally {
        await started.close();
      }
    },
  };
}
