import type { Readable, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { findRunning, startServer, type McpHttpHandler, type ZarkService } from '@zark/server';
import { createMcpServer } from './tools.js';

export { createMcpServer, GUIDE } from './tools.js';

/** Stateless MCP over HTTP: a fresh server + transport per request. */
export function mcpHttpHandler(service: ZarkService): McpHttpHandler {
  return async (req: IncomingMessage, res: ServerResponse, body: unknown) => {
    const server = createMcpServer(service);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };
}

/**
 * MCP over stdio. With a `zark dev` running for the same folder, messages are
 * bridged to its /mcp endpoint so the UI shows the agent's writes live.
 * Otherwise an in-process service works on the files directly.
 */
export async function runStdio(dir: string, opts: { uiDir?: string; stdin?: Readable; stdout?: Writable } = {}): Promise<void> {
  const running = await findRunning(dir);
  const stdio = new StdioServerTransport(opts.stdin, opts.stdout);

  if (running) {
    const http = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${running.port}${running.base}/mcp`), {
      requestInit: { headers: { 'x-zark-token': running.token } },
    });
    stdio.onmessage = (msg) => void http.send(msg).catch((err) => process.stderr.write(`zark mcp: ${err.message}\n`));
    http.onmessage = (msg) => void stdio.send(msg);
    http.onerror = (err) => process.stderr.write(`zark mcp: ${err.message}\n`);
    const done = new Promise<void>((resolve) => {
      stdio.onclose = () => {
        void http.close();
        resolve();
      };
    });
    await http.start();
    await stdio.start();
    process.stderr.write(`zark mcp: delegando ao zark dev em 127.0.0.1:${running.port}\n`);
    return done;
  }

  const local = await startServer({ dir, port: 0, uiDir: opts.uiDir, watch: true });
  const server = createMcpServer(local.service);
  const done = new Promise<void>((resolve) => {
    stdio.onclose = () => void local.stop().finally(resolve);
  });
  await server.connect(stdio);
  return done;
}
