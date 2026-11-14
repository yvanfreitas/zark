import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  applyOps,
  buildProject,
  errorsOf,
  fileKind,
  formatText,
  readTexts,
  validate,
  type Project,
} from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../examples/ai-chat/architecture', import.meta.url));
const base = await readTexts(EXAMPLE);

function project(edit?: (t: Map<string, string>) => void): Project {
  const texts = new Map(base);
  edit?.(texts);
  return buildProject(EXAMPLE, texts);
}
const replace = (t: Map<string, string>, path: string, from: string | RegExp, to: string) => {
  const text = t.get(path)!;
  const next = text.replace(from, to);
  if (next === text) throw new Error(`replace had no effect in ${path}: ${from}`);
  t.set(path, next);
};
const codes = (p: Project) => validate(p).map((x) => x.code);
const lineDiff = (a: string, b: string) => {
  const la = a.split('\n'), lb = b.split('\n');
  return la.length === lb.length ? la.filter((l, i) => l !== lb[i]).length : Infinity;
};

describe('phase 1 acceptance: appendix model', () => {
  it('loads 16 entities, 19 connections, 2 drawings, 2 flows with no problems', () => {
    const p = project();
    expect([p.entities.size, p.connections.size, p.drawings.size, p.flows.size]).toEqual([16, 19, 2, 2]);
    expect(validate(p)).toEqual([]);
  });

  it('is already canonical: fmt produces no diff', () => {
    for (const [path, text] of base) expect(formatText(fileKind(path)!, text), path).toBe(text);
  });
});

describe('validation codes', () => {
  const cases: [string, (t: Map<string, string>) => void][] = [
    ['E001', (t) => replace(t, 'entities/auth.yaml', 'kind: system', 'kind: banana')],
    ['E001', (t) => t.set('entities/broken.yaml', 'id: [unclosed')],
    ['E002', (t) => t.set('entities/x.yaml', 'id: y\nname: Y\nkind: system\n')],
    ['E003', (t) => replace(t, 'entities/websocket-api.yaml', 'id: forward', 'id: authorize')],
    ['E010', (t) => replace(t, 'entities/websocket-api.yaml', 'parent: platform', 'parent: nada')],
    ['E011', (t) => replace(t, 'entities/websocket-api.yaml', 'parent: platform', 'parent: user')],
    ['E012', (t) => {
      t.set('entities/a.yaml', 'id: a\nname: A\nkind: app\nparent: b\n');
      t.set('entities/b.yaml', 'id: b\nname: B\nkind: app\nparent: a\n');
    }],
    ['E020', (t) => replace(t, 'entities/user.yaml', 'to: papo-app', 'to: nada')],
    ['E021', (t) => replace(t, 'entities/user.yaml', 'to: papo-app', 'to: user')],
    ['E022', (t) => replace(t, 'entities/bot-orchestrator.yaml', 'owner: ai-team', 'owner: time-x')],
    ['E030', (t) => replace(t, 'drawings/platform.yaml', 'nodes:\n', 'nodes:\n  fantasma: { x: 800, y: 800 }\n')],
    ['E031', (t) => replace(t, 'drawings/platform.yaml', 'edges:\n', 'edges:\n  user.nada: { shape: straight }\n')],
    ['E032', (t) => replace(t, 'drawings/platform.yaml', 'edges:\n', 'edges:\n  user.uses: { shape: straight }\n')],
    ['E033', (t) => replace(t, 'drawings/platform.yaml', 'scope: platform', 'scope: nada')],
    ['E034', (t) => replace(t, 'drawings/platform.yaml', 'dead-letter-queue ]', 'user ]')],
    ['E040', (t) => replace(t, 'flows/user-chats-with-the-bot.yaml', 'via: websocket-api.forward', 'via: websocket-api.nada')],
    ['E041', (t) => replace(t, 'flows/user-chats-with-the-bot.yaml', '    text: Triggers the bot', '    text: Triggers the bot\n    reverse: true')],
    ['E042', (t) => replace(t, 'flows/user-chats-with-the-bot.yaml', '    text: Triggers the bot', '    text: Triggers the bot\n    reply: true\n    reverse: true')],
    ['E043', (t) => replace(t, 'flows/user-chats-with-the-bot.yaml', 'drawing: platform', 'drawing: nada')],
    ['E044', (t) => replace(t, 'flows/user-chats-with-the-bot.yaml', 'via: websocket-api.forward', 'via: user.uses')],
    ['E045', (t) => {
      t.set('flows/a.yaml', 'id: a\nname: A\ndrawing: platform\nsteps:\n  - subflow: b\n');
      t.set('flows/b.yaml', 'id: b\nname: B\ndrawing: platform\nsteps:\n  - subflow: a\n');
    }],
    ['W001', (t) => t.set('entities/trin.yaml', 'id: trin\nname: trin\nkind: system\n')],
    ['W002', (t) => t.set('entities/novo.yaml', 'id: novo\nname: Novo\nkind: system\nconnections:\n  - id: x\n    to: papo-app\n    label: Chama\n')],
    ['W003', (t) => replace(t, 'drawings/context.yaml', /  user\.uses: .*\n/, '')],
    ['W004', (t) => replace(t, 'entities/user.yaml', 'label: Chats in the app', 'label: Sends data to')],
    ['W005', (t) => replace(t, 'entities/dead-letter-queue.yaml', 'label: Redrives failures', 'label: Bot failures')],
    ['W006', (t) => replace(t, 'entities/llm-provider.yaml', 'external: true', 'external: true\nstatus: removed')],
    ['W010', (t) => replace(t, 'drawings/context.yaml', 'auth: { x: 832, y: -320 }', 'auth: { x: 872, y: -40 }')],
    ['W011', (t) => replace(t, 'drawings/context.yaml', 'auth: { x: 832, y: -320 }', 'auth: { x: 833, y: -320 }')],
    ['W012', (t) => {
      replace(t, 'drawings/platform.yaml', 'nodes:\n', 'nodes:\n  platform: { x: -128, y: -64, w: 256, h: 128, expanded: true }\n');
    }],
    ['W020', (t) => t.set('flows/curto.yaml', 'id: curto\nname: Curto\ndrawing: context\nsteps:\n  - id: a\n    via: user.uses\n    text: oi\n')],
    ['W021', (t) => replace(t, 'flows/user-chats-with-the-bot.yaml', '  - id: shows-the-answer', '  - parallel:\n      - []\n      - - id: x\n          via: papo-app.websocket\n          text: x\n  - id: shows-the-answer')],
  ];
  it.each(cases)('%s', (code, edit) => {
    expect(codes(project(edit))).toContain(code);
  });

  it('reports file and line', () => {
    const problems = validate(project((t) => replace(t, 'entities/user.yaml', 'to: papo-app', 'to: nada')));
    const p = problems.find((x) => x.code === 'E020')!;
    expect(p.file).toBe('entities/user.yaml');
    expect(base.get('entities/user.yaml')!.split('\n')[p.line! - 1]).toContain('to: papo-app');
  });

  it('honours rules overrides from zark.yaml', () => {
    const p = project((t) => {
      replace(t, 'drawings/context.yaml', /  user\.uses: .*\n/, '');
      replace(t, 'zark.yaml', 'grid: 8', 'grid: 8\nrules: { W003: error }');
    });
    expect(errorsOf(validate(p)).map((x) => x.code)).toContain('W003');
  });

  it('tolerates an invalid file and still loads the rest', () => {
    const p = project((t) => t.set('entities/auth.yaml', ': : :'));
    expect(p.entities.size).toBe(15);
    expect(codes(p)).toContain('E001');
  });
});

describe('operations', () => {
  it('moving a box changes exactly one YAML line', async () => {
    const p = project();
    const r = await applyOps(p, [{ op: 'drawing.move-nodes', drawing: 'context', nodes: [{ id: 'auth', x: 832, y: -344 }] }]);
    expect(r.ok).toBe(true);
    const after = r.files.get('drawings/context.yaml')!;
    expect(lineDiff(base.get('drawings/context.yaml')!, after)).toBe(1);
    expect(r.changes.map((c) => c.text)).toEqual(['Context: 1 box repositioned']);
  });

  it('preserves comments when editing', async () => {
    const p = project((t) => replace(t, 'entities/bot-orchestrator.yaml', 'caption: Builds the prompt and replies', 'caption: Builds the prompt and replies # internal name\n# loose comment'));
    const r = await applyOps(p, [{ op: 'entity.update', id: 'bot-orchestrator', set: { caption: 'Bot' } }]);
    expect(r.ok).toBe(true);
    const text = r.files.get('entities/bot-orchestrator.yaml')!;
    expect(text).toContain('caption: Bot # internal name');
    expect(text).toContain('# loose comment');
  });

  it('refuses an operation that introduces an error, with explanation', async () => {
    const r = await applyOps(project(), [{ op: 'connection.create', from: 'user', connection: { id: 'x', to: 'nada', label: 'X' } }]);
    expect(r.ok).toBe(false);
    expect(r.newErrors.map((e) => e.code)).toEqual(['E020']);
  });

  it('delete without cascade returns impact and changes nothing; with cascade leaves no broken refs', async () => {
    const p = project();
    const dry = await applyOps(p, [{ op: 'entity.delete', id: 'llm-provider' }]);
    expect(dry.ok).toBe(false);
    expect(dry.impact!.join('\n')).toMatch(/bot-orchestrator\.complete/);
    expect(dry.files.size).toBe(0);
    const r = await applyOps(p, [{ op: 'entity.delete', id: 'llm-provider', cascade: true }]);
    expect(r.ok).toBe(true);
    expect(r.files.get('entities/llm-provider.yaml')).toBeNull();
    expect(errorsOf(r.problems)).toEqual([]);
    expect(r.files.get('flows/user-chats-with-the-bot.yaml')).not.toContain('bot-orchestrator.complete');
  });

  it('children block entity deletion unless cascaded', async () => {
    const dry = await applyOps(project(), [{ op: 'entity.delete', id: 'platform' }]);
    expect(dry.impact!.join('\n')).toMatch(/Children block/);
    const r = await applyOps(project(), [{ op: 'entity.delete', id: 'platform', cascade: true }]);
    expect(r.ok).toBe(true);
    expect([...r.project.entities.keys()]).not.toContain('websocket-api');
    expect(errorsOf(r.problems)).toEqual([]);
  });

  it('rename-id rewrites every reference in one step', async () => {
    const r = await applyOps(project(), [{ op: 'rename-id', kind: 'entity', from: 'bot-orchestrator', to: 'bot' }]);
    expect(r.ok).toBe(true);
    expect(r.files.get('entities/bot-orchestrator.yaml')).toBeNull();
    expect(r.project.connections.has('bot.reply')).toBe(true);
    expect(r.files.get('drawings/context.yaml')).toContain('bot.moderate');
    expect(r.files.get('flows/user-chats-with-the-bot.yaml')).toContain('via: bot.context');
    expect(validate(r.project)).toEqual([]);
  });

  it('reverse moves the connection to the other file and is refused when a flow step would go against it', async () => {
    const ok = await applyOps(project(), [{ op: 'connection.reverse', ref: 'papo-app.login' }]);
    expect(ok.ok).toBe(true);
    expect(ok.project.connections.get('auth.login')?.conn.to).toBe('papo-app');
    expect(ok.changes.map((c) => c.text)).toContain('Connection reversed: now Auth -> Papo app');
    const refused = await applyOps(project(), [{ op: 'connection.reverse', ref: 'message-handler.publish' }]);
    expect(refused.ok).toBe(false);
    expect(refused.newErrors.map((e) => e.code)).toContain('E041');
  });

  it('apply batch: create, connect, place, draw and add a flow step validated as a whole', async () => {
    const r = await applyOps(project(), [
      { op: 'entity.create', entity: { id: 'spam-filter', name: 'Spam filter', kind: 'system', external: true } },
      { op: 'connection.create', from: 'spam-filter', connection: { id: 'score', to: 'websocket-api', label: 'Returns a spam score' } },
      { op: 'drawing.place', drawing: 'platform', nodes: [{ id: 'spam-filter' }] },
      { op: 'drawing.draw-edges', drawing: 'platform', edges: [{ ref: 'spam-filter.score', shape: 'straight' }] },
      { op: 'flow.add-steps', flow: 'user-chats-with-the-bot', index: 3, steps: [{ id: 'score', via: 'spam-filter.score', text: 'Checks for spam' }] },
    ]);
    expect(r.ok, r.error).toBe(true);
    expect(errorsOf(r.problems)).toEqual([]);
    expect(r.files.get('entities/spam-filter.yaml')).toMatch(/^# yaml-language-server/);
    const changes = r.changes.map((c) => c.text);
    expect(changes).toContain('Entity added: Spam filter (system, external)');
    expect(changes).toContain('New connection: Spam filter -> WebSocket API ("Returns a spam score")');
    expect(changes).toContain('User chats with the bot: 1 step added');
    // New files are canonical too.
    for (const [path, text] of r.files) if (text) expect(formatText(fileKind(path)!, text), path).toBe(text);
  });

  it('detects hash conflicts', async () => {
    const r = await applyOps(project(), [{ op: 'entity.update', id: 'auth', set: { caption: 'x' } }], { expect: { 'entities/auth.yaml': 'stale' } });
    expect(r.conflict?.file).toBe('entities/auth.yaml');
  });

  it('auto-layout snaps to the grid without overlaps', async () => {
    const r = await applyOps(project(), [{ op: 'drawing.auto-layout', drawing: 'context' }]);
    expect(r.ok).toBe(true);
    const nodes = r.project.drawings.get('context')!.drawing.nodes!;
    for (const n of Object.values(nodes)) expect(n.x % 8 + n.y % 8).toBe(0);
    expect(validate(r.project).map((p) => p.code)).not.toContain('W010');
  });
});

import { flowToMermaid, numberSteps, playbackFrames } from '../src/index.js';

describe('flow text', () => {
  const p = project();
  const flow = p.flows.get('user-chats-with-the-bot')!.flow;
  const lookup = {
    connection: (ref: string) => {
      const c = p.connections.get(ref);
      return c && { from: c.from, to: c.conn.to, direction: c.conn.direction };
    },
    name: (id: string) => p.entities.get(id)?.entity.name ?? id,
  };

  it('numbers steps 1, 2, 3a, 3b', () => {
    expect(numberSteps(flow.steps).map((s) => s.number)).toEqual(['1', '2', '3', '4', '5a', '5b', '6', '7', '8', '9a', '9b', '10', '11']);
  });

  it('plays parallel branches together and picks one alternative', () => {
    const frames = playbackFrames(flow.steps);
    expect(frames.map((f) => f.map((s) => s.id).join('+'))).toEqual([
      'sends-the-message', 'checks-the-token', 'forwards-the-message', 'publishes-to-the-topic', 'delivers-to-history+delivers-to-the-bot',
      'triggers-the-bot', 'reads-the-context', 'classifies-the-content', 'generates-the-answer', 'sends-the-answer', 'shows-the-answer',
    ]);
    expect(playbackFrames(flow.steps, { 'r.8': 1 })[8][0].id).toBe('returns-the-block');
  });

  it('exports an equivalent Mermaid sequenceDiagram', () => {
    const text = flowToMermaid(flow, lookup);
    expect(text).toContain('par\n');
    expect(text).toContain('alt Content approved');
    expect(text).toContain('moderation-->>bot_orchestrator: Returns the block');
    expect(text).toContain('websocket_api->>papo_app: Shows the answer');
    expect(text).toContain('participant bot_orchestrator as Bot orchestrator');
  });
});

import { CURRENT_SCHEMA, migrate, MigrationError } from '../src/index.js';

describe('format migration', () => {
  it('does nothing on a current project', () => {
    const r = migrate(new Map(base));
    expect(r.steps).toEqual([]);
    expect(r.files.size).toBe(0);
    expect(r.from).toBe(CURRENT_SCHEMA);
  });

  it('applies the chain of steps and bumps schema', () => {
    const texts = new Map(base);
    texts.set('zark.yaml', base.get('zark.yaml')!.replace('schema: 1', 'schema: 0'));
    const r = migrate(texts, [
      { from: 0, to: 1, describe: 'renomeia caption', apply: (t) => new Map([['entities/auth.yaml', t.get('entities/auth.yaml')!.replace('caption: Accounts and tokens', 'caption: Accounts')]]) },
    ]);
    expect(r.steps).toEqual(['0 -> 1: renomeia caption']);
    expect(r.files.get('entities/auth.yaml')).toContain('caption: Accounts\n');
    expect(r.files.get('zark.yaml')).toContain('schema: 1');
  });

  it('refuses a newer format and a missing step', () => {
    const newer = new Map(base);
    newer.set('zark.yaml', base.get('zark.yaml')!.replace('schema: 1', 'schema: 7'));
    expect(() => migrate(newer)).toThrow(MigrationError);
    const older = new Map(base);
    older.set('zark.yaml', base.get('zark.yaml')!.replace('schema: 1', 'schema: 0'));
    expect(() => migrate(older, [])).toThrow(/There is no migration from schema 0/);
  });

  it('explains an unsupported schema when loading', () => {
    const p = project((t) => t.set('zark.yaml', base.get('zark.yaml')!.replace('schema: 1', 'schema: 2')));
    expect(validate(p).find((x) => x.code === 'E001')?.message).toMatch(/newer than this Zark/);
  });
});

import { mkdtemp, open as openFile, readFile as readFileFs, rm as rmFs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { writeAtomic } from '../src/index.js';

describe('atomic write', () => {
  it('survives the target being open by another reader (Windows EPERM on rename)', async () => {
    const dir = await mkdtemp(joinPath(tmpdir(), 'zark-atomic-'));
    const file = joinPath(dir, 'a.yaml');
    await writeAtomic(file, 'v: 1\n');
    const handle = await openFile(file, 'r');
    // Release the reader shortly after the write starts, as a watcher would.
    const release = new Promise((r) => setTimeout(() => void handle.close().then(r), 60));
    await writeAtomic(file, 'v: 2\n');
    await release;
    expect(await readFileFs(file, 'utf8')).toBe('v: 2\n');
    await rmFs(dir, { recursive: true, force: true });
  });
});

describe('canonical empty maps', () => {
  it('keeps empty nodes/edges on one line, so creating and formatting agree', async () => {
    const r = await applyOps(project(), [{ op: 'drawing.create', drawing: { id: 'blank', name: 'Blank' } }]);
    const text = r.files.get('drawings/blank.yaml')!;
    expect(text).toContain('edges: {}');
    expect(formatText('drawing', text)).toBe(text);
    expect(formatText('drawing', text.replace('edges: {}', 'edges:\n  {}'))).toBe(text);
  });
});
