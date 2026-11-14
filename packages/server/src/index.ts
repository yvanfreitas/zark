import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAtomic } from '@zark/core';
import { createApp, listen, newToken, type McpHttpHandler, type Started } from './http.js';
import { ZarkService } from './service.js';
import { ProjectStore } from './store.js';

export * from './git.js';
export * from './providers.js';
export * from './http.js';
export * from './render-hash.js';
export * from './render.js';
export * from './service.js';
export * from './store.js';

export interface StartOptions {
  dir: string;
  port?: number;
  host?: string;
  uiDir?: string;
  /** Builds the MCP HTTP handler once the service exists. */
  mcp?: (service: ZarkService) => McpHttpHandler;
  watch?: boolean;
  readOnly?: boolean;
  /** Write .zark/server.json so `zark mcp` can delegate to this process. */
  advertise?: boolean;
}

export interface Running extends Started {
  service: ZarkService;
  token: string;
  stop: () => Promise<void>;
}

const serverFile = (dir: string) => join(dir, '..', '.zark', 'server.json');

export async function startServer(opts: StartOptions): Promise<Running> {
  const store = await new ProjectStore(opts.dir).load();
  if (opts.watch) store.watch();
  const token = newToken();
  let port = 0;
  const service = new ZarkService(store, () => `http://127.0.0.1:${port}`, token);
  if (opts.watch) service.enableAutoRender();
  const app = createApp({ service, uiDir: opts.uiDir, mcp: opts.mcp?.(service), port: () => port, readOnly: opts.readOnly });
  const started = await listen(app, opts.port ?? 4317, opts.host);
  port = started.port;
  if (opts.advertise) await writeAtomic(serverFile(opts.dir), JSON.stringify({ port, token, pid: process.pid }) + '\n');
  return {
    ...started,
    service,
    token,
    stop: async () => {
      if (opts.advertise) await rm(serverFile(opts.dir), { force: true });
      await service.close();
      await started.close();
    },
  };
}

/** Finds a running `zark dev` for this folder, if any. */
export async function findRunning(dir: string): Promise<{ port: number; token: string } | undefined> {
  const info = await readFile(serverFile(dir), 'utf8').then(JSON.parse).catch(() => undefined);
  if (!info) return undefined;
  const ok = await fetch(`http://127.0.0.1:${info.port}/api/health`, { headers: { 'x-zark-token': info.token } })
    .then((r) => r.ok)
    .catch(() => false);
  return ok ? info : undefined;
}
