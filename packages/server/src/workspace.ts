import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
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

/** Finds direct child folders of `root` that contain `architecture/zark.yaml`, sorted by name. */
export async function discoverWorkspace(root: string): Promise<WorkspaceRepo[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const repos = entries
    .filter((e) => e.isDirectory() && existsSync(join(root, e.name, 'architecture', 'zark.yaml')))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      key: name,
      prefix: `/r/${encodeURIComponent(name)}`,
      root: join(root, name),
      dir: join(root, name, 'architecture'),
    }));
  if (repos.length === 0) throw new Error(`No repos with architecture/zark.yaml under ${root}`);
  return repos;
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
      listed.push({ repo, running: { url: `http://127.0.0.1:${live.port}/?token=${live.token}` } });
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
      if (!service) return { ...base, name: repo.key, drawings: 0, errors: 0, warnings: 0, running };
      const problems = service.store.problems;
      return {
        ...base,
        name: service.project.config.name,
        drawings: service.project.drawings.size,
        errors: problems.filter((p) => p.severity === 'error').length,
        warnings: problems.filter((p) => p.severity === 'warning').length,
      };
    });
  app.get('/api/workspace', (c) => c.json({ repos: entries() }));
  serveUi(app, opts.uiDir);

  const closeAll = async () => {
    for (const service of services.values()) await service.close();
    await browser.close();
  };
  let started: Started;
  try {
    started = await listen(app, opts.port ?? DEFAULT_PORT, opts.host).catch((err: NodeJS.ErrnoException) => {
      if (opts.port === undefined && err.code === 'EADDRINUSE') return listen(app, 0, opts.host);
      throw err;
    });
  } catch (err) {
    await closeAll();
    throw err;
  }
  port = started.port;

  const advertised: string[] = [];
  if (opts.advertise) {
    for (const { repo } of listed) {
      if (!services.has(repo.key)) continue;
      const file = serverFile(repo.dir);
      await writeAtomic(file, JSON.stringify({ port, token, pid: process.pid, base: repo.prefix }) + '\n');
      advertised.push(file);
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
      await closeAll();
      await started.close();
    },
  };
}
