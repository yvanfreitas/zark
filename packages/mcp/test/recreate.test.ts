// Fase 3 acceptance: an agent recreates the appendix model from scratch using
// only MCP tools, with no validation errors, while the UI (SSE) follows live.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDoc, diffProjects, loadProject, toText, writeAtomic } from '@zark/core';
import { startServer, type Running } from '@zark/server';
import { createMcpServer } from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../examples/ai-chat/architecture', import.meta.url));

let running: Running | undefined;
let root: string | undefined;
let cleanup: (() => Promise<void>) | undefined;
afterAll(async () => {
  await cleanup?.();
  await running?.stop();
  if (root) await rm(root, { recursive: true, force: true });
});

/** Collects SSE events from /api/events, like the UI does. */
async function listen(url: string, token: string) {
  const events: { event: string; data: any }[] = [];
  const controller = new AbortController();
  const res = await fetch(`${url}/api/events?token=${token}`, { signal: controller.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const event = /^event: (.*)$/m.exec(chunk)?.[1];
          const data = /^data: (.*)$/m.exec(chunk)?.[1];
          if (event && data) events.push({ event, data: JSON.parse(data) });
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return { events, stop: () => controller.abort() };
}

describe('phase 3: an agent recreates the example using only tools', () => {
  it('rebuilds the AI chat example model with no errors, semantically equal, UI following live', async () => {
    root = await mkdtemp(join(tmpdir(), 'zark-recreate-'));
    const dir = join(root, 'architecture');
    const example = await loadProject(EXAMPLE);

    // Empty project, as `zark init` would leave it (config copied from the example).
    const config = await import('node:fs/promises').then((fs) => fs.readFile(join(EXAMPLE, 'zark.yaml'), 'utf8'));
    await writeAtomic(join(dir, 'zark.yaml'), config);
    await writeAtomic(join(dir, 'catalog.yaml'), toText(createDoc('catalog', { technologies: [], tags: [], teams: [] })));

    running = await startServer({ dir, port: 0, watch: true });
    const sse = await listen(running.url, running.token);
    const server = createMcpServer(running.service);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'agent', version: '1' });
    await Promise.all([server.connect(a), client.connect(b)]);
    cleanup = async () => {
      sse.stop();
      await client.close();
    };

    const calls: string[] = [];
    const call = async (name: string, args: Record<string, unknown>) => {
      const r: any = await client.callTool({ name, arguments: args });
      const out = JSON.parse(r.content[0].text);
      calls.push(name);
      expect(out.ok, `${name}: ${out.error ?? JSON.stringify(out.problems)}`).toBe(true);
      return out;
    };

    // Catalog through apply_changes.
    await call('apply_changes', {
      ops: (['technologies', 'tags', 'teams'] as const).flatMap((list) => (example.catalog[list] ?? []).map((item) => ({ op: 'catalog.set', list, item }))),
    });

    // Entities, parents first, one create_entity each (no connections yet).
    const depth = (id: string): number => {
      const parent = example.entities.get(id)!.entity.parent;
      return parent ? 1 + depth(parent) : 0;
    };
    for (const id of [...example.entities.keys()].sort((x, y) => depth(x) - depth(y))) {
      const { connections: _drop, source: _source, ...entity } = example.entities.get(id)!.entity;
      await call('create_entity', entity);
    }

    // Connections: half by create_connection, the rest in one apply_changes.
    const conns = [...example.connections.values()];
    const half = Math.ceil(conns.length / 2);
    for (const c of conns.slice(0, half)) await call('create_connection', { from: c.from, connection: c.conn });
    await call('apply_changes', { ops: conns.slice(half).map((c) => ({ op: 'connection.create', from: c.from, connection: c.conn })) });

    // Drawings: create, place with exact geometry, draw edges, then groups/notes.
    for (const { drawing } of example.drawings.values()) {
      await call('create_drawing', { id: drawing.id, name: drawing.name, description: drawing.description, scope: drawing.scope ?? null });
      await call('place_entities', { drawing: drawing.id, nodes: Object.entries(drawing.nodes ?? {}).map(([id, n]) => ({ id, ...n })) });
      await call('draw_connections', { drawing: drawing.id, edges: Object.entries(drawing.edges ?? {}).map(([ref, e]) => ({ ref, ...e })) });
      const visual = [
        ...(drawing.groups ?? []).map((group) => ({ op: 'drawing.set-group', drawing: drawing.id, group })),
        ...(drawing.notes ?? []).map((note) => ({ op: 'drawing.set-note', drawing: drawing.id, note })),
      ];
      if (visual.length) await call('apply_changes', { ops: visual });
    }

    // Flows with their steps (parallel and alternatives included).
    for (const { flow } of example.flows.values()) await call('create_flow', flow);

    const validation = JSON.parse(((await client.callTool({ name: 'validate', arguments: {} })) as any).content[0].text);
    expect(validation.errors).toEqual([]);
    expect(validation.warnings).toEqual([]);

    // Semantic equality with the hand-written appendix.
    const recreated = await loadProject(dir);
    // No tool writes a component's code `source` (it is set in the YAML), so that is the one difference expected.
    expect(diffProjects(example, recreated).map((c) => c.text).filter((t) => !t.endsWith(': source changed'))).toEqual([]);
    expect(recreated.catalog).toEqual(example.catalog);

    // The UI followed along: every write reached SSE as origin "mcp".
    await new Promise((r) => setTimeout(r, 300));
    const mcpEvents = sse.events.filter((e) => e.event === 'model.changed' && e.data.origin === 'mcp');
    expect(mcpEvents.length).toBe(calls.length);
  }, 60_000);
});
