import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ProjectStore, ZarkService } from '@zark/server';
import { createMcpServer } from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../examples/ai-chat/architecture', import.meta.url));

let root: string;
let dir: string;
let client: Client;
let service: ZarkService;

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r: any = await client.callTool({ name, arguments: args });
  const text = r.content[0].text as string;
  return name === 'get_flow' && args.format === 'mermaid' ? text : JSON.parse(text);
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'zark-mcp-'));
  dir = join(root, 'architecture');
  await cp(EXAMPLE, dir, { recursive: true });
  await mkdir(join(dir, 'code'), { recursive: true });
  await writeFile(join(dir, 'code', 'alpha.yaml'), 'component: alpha\nmodules: []\nedges: []\nunresolved:\n  calls: 0\n  external: 0\n  unowned: 0\n');
  const store = await new ProjectStore(dir).load();
  service = new ZarkService(store, () => 'http://127.0.0.1:0', 'test');
  const server = createMcpServer(service);
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
});

afterAll(async () => {
  await client?.close();
  await service?.close();
  await rm(root, { recursive: true, force: true });
});

describe('zark MCP server', () => {
  it('exposes every tool from the spec', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    const expected = [
      'get_overview', 'list_entities', 'get_entity', 'list_connections', 'list_drawings', 'get_drawing', 'list_flows', 'get_flow', 'search', 'validate', 'diff', 'render',
      'create_entity', 'update_entity', 'delete_entity', 'move_entity', 'create_connection', 'update_connection', 'delete_connection', 'reverse_connection',
      'create_drawing', 'update_drawing', 'delete_drawing', 'place_entities', 'move_nodes', 'remove_nodes', 'draw_connections', 'update_edge', 'remove_edges', 'auto_layout', 'fix_label_overlaps',
      'create_flow', 'update_flow', 'delete_flow', 'add_steps', 'update_step', 'move_step', 'remove_steps', 'apply_changes', 'rename_id', 'open_pr',
    ];
    for (const n of expected) expect(names).toContain(n);
  });

  it('reads overview and flow as mermaid', async () => {
    const overview = await call('get_overview');
    expect(overview.counts).toEqual({ entities: 18, connections: 20, drawings: 3, flows: 2 });
    const text = await call('get_flow', { id: 'user-chats-with-the-bot', format: 'mermaid' });
    expect(text).toContain('sequenceDiagram');
    expect(text).toContain('alt Content approved');
  });

  it('get_code_graph returns the graph', async () => {
    const g = await call('get_code_graph', { component: 'alpha' });
    expect(g).toMatchObject({ component: 'alpha', modules: [], edges: [] });
  });

  it('get_code_graph errors for unknown component', async () => {
    const r = await call('get_code_graph', { component: 'nope' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('nope');
    expect(r.error).toContain('alpha');
  });

  it('apply_changes creates, connects, places and draws in one call', async () => {
    const r = await call('apply_changes', {
      ops: [
        { op: 'entity.create', entity: { id: 'spam-filter', name: 'Spam filter', kind: 'system', external: true } },
        { op: 'connection.create', from: 'spam-filter', connection: { id: 'score', to: 'papo-app', label: 'Returns a spam score' } },
        { op: 'drawing.place', drawing: 'context', nodes: [{ id: 'spam-filter' }] },
        { op: 'drawing.draw-edges', drawing: 'context', edges: [{ ref: 'spam-filter.score', shape: 'straight' }] },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.changedFiles).toContain('entities/spam-filter.yaml');
    expect(r.changes).toContain('Entity added: Spam filter (system, external)');
    expect(existsSync(join(dir, 'entities/spam-filter.yaml'))).toBe(true);
  });

  it('warns with a hint when a new connection is not drawn', async () => {
    const r = await call('create_connection', { from: 'spam-filter', connection: { id: 'alert', to: 'auth', label: 'Sends an alert' } });
    expect(r.ok).toBe(true);
    expect(r.problems.warnings.some((w: string) => w.startsWith('W003 spam-filter.alert'))).toBe(true);
    expect(r.hint).toContain('draw_connections');
  });

  it('refuses an op that introduces an error, without writing', async () => {
    const r = await call('create_connection', { from: 'user', connection: { id: 'x', to: 'nada', label: 'X' } });
    expect(r.ok).toBe(false);
    expect(r.problems.errors[0]).toMatch(/^E020/);
    expect(service.project.connections.has('user.x')).toBe(false);
  });

  it('dryRun validates without writing', async () => {
    const r = await call('update_entity', { id: 'auth', set: { caption: 'Identity' }, dryRun: true });
    expect(r.ok).toBe(true);
    expect(service.project.entities.get('auth')!.entity.caption).toBe('Accounts and tokens');
  });

  it('delete_entity without cascade returns impact', async () => {
    const r = await call('delete_entity', { id: 'llm-provider' });
    expect(r.ok).toBe(false);
    expect(r.impact.join('\n')).toMatch(/bot-orchestrator\.complete/);
    expect(r.hint).toContain('cascade: true');
    expect(existsSync(join(dir, 'entities/llm-provider.yaml'))).toBe(true);
  });

  it('open_pr without confirm only returns the preview', async () => {
    const r = await call('open_pr', {});
    expect(r.preview).toBe(true);
    expect(Array.isArray(r.blockers)).toBe(true);
    expect(r.title).toBeTruthy();
  });

  it('serves schema and guide resources', async () => {
    const guide: any = await client.readResource({ uri: 'zark://guide' });
    expect(guide.contents[0].text).toContain('apply_changes');
    const schema: any = await client.readResource({ uri: 'zark://schema/entity' });
    expect(JSON.parse(schema.contents[0].text).properties.kind).toBeTruthy();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(expect.arrayContaining(['documentar-repositorio', 'revisar-modelo']));
  });
});
