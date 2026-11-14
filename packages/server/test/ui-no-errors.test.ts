// Phase 4 acceptance: "no UI action leaves the model with errors".
// The UI writes only through the HTTP API, so every write endpoint it uses is
// exercised here: a valid call must leave zero errors, and a call crafted to
// introduce an error must be refused with the files on disk untouched.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTexts } from '@zark/core';
import { startServer, type Running } from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../examples/ai-chat/architecture', import.meta.url));
const FLOW = 'user-chats-with-the-bot';

let root: string;
let dir: string;
let srv: Running;

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`http://127.0.0.1:${srv.port}${path}`, {
    method,
    headers: { 'x-zark-token': srv.token, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
};
const errors = async () => ((await call('GET', '/api/validate')).body.problems as { severity: string; code: string; message: string }[]).filter((p) => p.severity === 'error');
const disk = async () => JSON.stringify([...(await readTexts(dir))]);

/** A valid UI write: accepted, and the model has no errors afterwards. */
async function valid(method: string, path: string, body?: unknown) {
  const r = await call(method, path, body);
  expect(r.status, `${method} ${path}: ${JSON.stringify(r.body)}`).toBe(200);
  expect(r.body.ok, `${method} ${path}: ${JSON.stringify(r.body)}`).toBe(true);
  expect(await errors()).toEqual([]);
  return r;
}

/** A write that would break the model: refused, nothing written, still no errors. */
async function refused(method: string, path: string, body?: unknown, code?: string) {
  const before = await disk();
  const r = await call(method, path, body);
  expect(r.body.ok, `${method} ${path} should be refused: ${JSON.stringify(r.body)}`).toBe(false);
  expect([400, 403, 409, 422, 200]).toContain(r.status);
  if (code) expect(JSON.stringify(r.body)).toContain(code);
  expect(await disk()).toBe(before);
  expect(await errors()).toEqual([]);
  return r;
}

const ops = (drawing: string, list: unknown[]) => ['POST', `/api/drawings/${drawing}/ops`, { ops: list }] as const;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'zark-ui-'));
  dir = join(root, 'architecture');
  await cp(EXAMPLE, dir, { recursive: true });
  srv = await startServer({ dir, port: 0 });
  expect(await errors()).toEqual([]);
});

afterAll(async () => {
  await srv?.stop();
  await rm(root, { recursive: true, force: true });
});

describe('every UI write endpoint keeps the model free of errors', { timeout: 30_000 }, () => {
  it('entities: create (+place), update, move, delete', async () => {
    await valid('POST', '/api/entities', { entity: { id: 'billing', name: 'Billing', kind: 'system', external: true }, place: { drawing: 'context', x: 0, y: -560 } });
    await refused('POST', '/api/entities', { entity: { id: 'solto', name: 'Solto', kind: 'app' } }, 'E011');
    await refused('POST', '/api/entities', { entity: { id: 'Bad Id', name: 'X', kind: 'system' } }, 'E001');

    await valid('PATCH', '/api/entities/auth', { set: { caption: 'Identity', tags: ['messaging'] } });
    await valid('PATCH', '/api/entities/auth', { unset: ['tags'] });
    await refused('PATCH', '/api/entities/auth', { set: { kind: 'app' } }, 'E011');
    await refused('PATCH', '/api/entities/auth', { set: { owner: 'ghost-team' } }, 'E022');
    await refused('PATCH', '/api/entities/websocket-api', { parent: 'nada' }, 'E010');
    await refused('PATCH', '/api/entities/websocket-api', { parent: 'user' }, 'E011');
    await refused('PATCH', '/api/entities/platform', { unset: ['name'] }, 'E001');

    const impact = await refused('DELETE', '/api/entities/llm-provider');
    expect(impact.body.impact.length).toBeGreaterThan(0);
    await valid('DELETE', '/api/entities/billing?cascade=true');
  });

  it('connections: create, update, reverse, delete', async () => {
    await valid('POST', '/api/entities/user/connections', { connection: { id: 'support', to: 'auth', label: 'Asks for help' } });
    await refused('POST', '/api/entities/user/connections', { connection: { id: 'x', to: 'nada', label: 'X' } }, 'E020');
    await refused('POST', '/api/entities/user/connections', { connection: { id: 'y', to: 'user', label: 'Y' } }, 'E021');

    await valid('PATCH', '/api/connections/user.support', { set: { label: 'Opens a ticket', direction: 'bidirectional' } });
    await valid('PATCH', '/api/connections/user.support', { reverse: true });
    // Reversing a connection a flow step walks along would put that step against it.
    await refused('PATCH', '/api/connections/message-handler.publish', { reverse: true }, 'E041');
    await refused('PATCH', '/api/connections/message-handler.publish', { unset: ['label'] }, 'E001');
    await refused('PATCH', '/api/connections/message-handler.publish', { set: { via: 'nada' } }, 'E020');

    const impact = await refused('DELETE', '/api/connections/bot-queue.trigger');
    expect(impact.body.impact.length).toBeGreaterThan(0);
    await valid('DELETE', '/api/connections/auth.support');
  });

  it('drawings: create, update, delete', async () => {
    await valid('POST', '/api/drawings', { drawing: { id: 'draft', name: 'Draft', scope: null } });
    await valid('PATCH', '/api/drawings/draft', { set: { name: 'Draft 2', scope: 'platform' } });
    await refused('PATCH', '/api/drawings/draft', { set: { scope: 'nada' } }, 'E033');
    // Flows run on the platform drawing, so it cannot go.
    await refused('DELETE', '/api/drawings/platform');
    await valid('DELETE', '/api/drawings/draft');
  });

  it('canvas ops: place, move, remove, draw, update edge, groups, notes, layout', async () => {
    await valid(...ops('platform', [{ op: 'move-nodes', nodes: [{ id: 'moderation', x: 1472, y: -352 }] }]));
    await refused(...ops('platform', [{ op: 'place', nodes: [{ id: 'nada', x: 0, y: 0 }] }]));
    await valid(...ops('platform', [{ op: 'place', nodes: [{ id: 'user', x: -448, y: 640 }] }]));
    await valid(...ops('platform', [{ op: 'draw-edges', edges: [{ ref: 'user.uses', shape: 'step' }] }]));
    await refused(...ops('platform', [{ op: 'draw-edges', edges: [{ ref: 'user.nada' }] }]));
    await valid(...ops('platform', [{ op: 'update-edge', ref: 'user.uses', set: { shape: 'curved', from: 'top', labelAt: 0.3 }, unset: [] }]));
    await refused(...ops('platform', [{ op: 'update-edge', ref: 'user.uses', set: { from: 'diagonal' } }]), 'E001');
    await valid(...ops('platform', [{ op: 'remove-edges', refs: ['user.uses'] }]));
    await valid(...ops('platform', [{ op: 'remove-nodes', ids: ['user'] }]));

    // Flows run on the platform drawing: removing what their steps highlight is refused.
    await refused(...ops('platform', [{ op: 'remove-edges', refs: ['websocket-api.forward'] }]), 'E044');
    await refused(...ops('platform', [{ op: 'remove-nodes', ids: ['message-handler'] }]), 'E044');
    // A group member removed from the drawing leaves the group with it (no E034).
    await valid(...ops('context', [{ op: 'remove-nodes', ids: ['moderation'] }]));
    expect((await call('GET', '/api/model')).body.drawings.find((x: { id: string }) => x.id === 'context').groups[0].members).toEqual(['llm-provider']);
    await valid(...ops('context', [{ op: 'place', nodes: [{ id: 'moderation', x: 1344, y: 160 }] }]));

    await valid(...ops('context', [{ op: 'set-group', group: { id: 'core', label: 'Core', members: ['papo-app', 'platform'], style: 'solid' } }]));
    await refused(...ops('context', [{ op: 'set-group', group: { id: 'ghost', label: 'X', members: ['nada'] } }]), 'E034');
    await valid(...ops('context', [{ op: 'remove-group', id: 'core' }]));
    await valid(...ops('context', [{ op: 'set-note', note: { id: 'note-2', text: 'Review', x: 120, y: 400, w: 200 } }]));
    await valid(...ops('context', [{ op: 'remove-note', id: 'note-2' }]));
    await valid('POST', '/api/drawings/platform/layout', {});
  });

  it('flows: create, update, steps, delete', async () => {
    const steps = [
      { id: 'a', via: 'user.uses', text: 'Opens the app' },
      { id: 'b', via: 'papo-app.login', text: 'Signs in' },
    ];
    await valid('POST', '/api/flows', { flow: { id: 'curto', name: 'Curto', drawing: 'context', steps } });
    await refused('POST', '/api/flows', { flow: { id: 'orfao', name: 'Órfão', drawing: 'nada', steps } }, 'E043');
    await refused('PATCH', '/api/flows/curto', { set: { drawing: 'platform' } }, 'E044');
    await valid('PATCH', '/api/flows/curto', { set: { name: 'Curtíssimo' } });

    await valid('POST', '/api/ops', { ops: [{ op: 'flow.add-steps', flow: 'curto', steps: [{ id: 'c', via: 'papo-app.websocket', text: 'Connects' }] }] });
    await refused('POST', '/api/ops', { ops: [{ op: 'flow.add-steps', flow: 'curto', steps: [{ id: 'd', via: 'x.nada', text: 'X' }] }] }, 'E040');
    await refused('POST', '/api/ops', { ops: [{ op: 'flow.add-steps', flow: 'curto', steps: [{ id: 'a', via: 'user.uses', text: 'Dup' }] }] }, 'E003');
    await refused('POST', '/api/ops', { ops: [{ op: 'flow.update-step', flow: 'curto', step: 'b', set: { reverse: true } }] }, 'E041');
    await refused('POST', '/api/ops', { ops: [{ op: 'flow.update-step', flow: 'curto', step: 'b', set: { reply: true, reverse: true } }] }, 'E042');
    // On a bidirectional connection the destination may start: valid.
    await valid('POST', '/api/ops', { ops: [{ op: 'flow.update-step', flow: FLOW, step: 'sends-the-message', set: { reverse: true } }] });
    await valid('POST', '/api/ops', { ops: [{ op: 'flow.update-step', flow: FLOW, step: 'sends-the-message', unset: ['reverse'] }] });
    await valid('POST', '/api/ops', { ops: [{ op: 'flow.update-step', flow: 'curto', step: 'b', set: { text: 'Signs in again' }, unset: [] }] });
    await valid('POST', '/api/ops', { ops: [{ op: 'flow.move-step', flow: 'curto', step: 'c', index: 0 }] });
    await valid('POST', '/api/ops', { ops: [{ op: 'flow.update', id: 'curto', set: { steps: [{ parallel: [[steps[0]], [steps[1]]] }] } }] });
    await refused('POST', '/api/ops', { ops: [{ op: 'flow.update', id: 'curto', set: { steps: [{ subflow: 'curto' }] } }] }, 'E045');
    await valid('POST', '/api/ops', { ops: [{ op: 'flow.remove-steps', flow: 'curto', steps: ['a'] }] });
    await valid('DELETE', '/api/flows/curto');
  });

  it('catalog, undo and redo', async () => {
    await valid('POST', '/api/ops', { ops: [{ op: 'catalog.set', list: 'tags', item: { id: 'payments', name: 'Payments' } }] });
    await refused('POST', '/api/ops', { ops: [{ op: 'catalog.remove', list: 'tags', id: 'messaging' }] }, 'E022');
    await valid('PATCH', '/api/entities/llm-provider', { set: { tags: ['payments'] } });
    expect((await call('POST', '/api/undo')).body.ok).toBe(true);
    expect(await errors()).toEqual([]);
    expect((await call('POST', '/api/redo')).body.ok).toBe(true);
    expect(await errors()).toEqual([]);
  });
});

describe('randomized UI session', () => {
  it('200 mixed valid and invalid writes never leave an error', async () => {
    // mulberry32: deterministic, so a failure reproduces.
    let seed = 20261113;
    const rnd = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
    const kinds = ['actor', 'system', 'app', 'store', 'component'];
    const sides = ['top', 'right', 'bottom', 'left', 'diagonal'];
    let n = 0;
    let accepted = 0;
    let rejected = 0;
    for (let i = 0; i < 200; i++) {
      const m = (await call('GET', '/api/model')).body;
      const ents: string[] = m.entities.map((e: { id: string }) => e.id);
      const refs: string[] = m.entities.flatMap((e: { id: string; connections?: { id: string }[] }) => (e.connections ?? []).map((c) => `${e.id}.${c.id}`));
      const drawings: string[] = m.drawings.map((d: { id: string }) => d.id);
      const flows: string[] = m.flows.map((f: { id: string }) => f.id);
      const maybe = (xs: string[]) => (rnd() < 0.15 ? 'nada' : pick(xs.length ? xs : ['nada']));
      const d = pick(drawings);
      const actions: (() => [string, string, unknown?])[] = [
        () => ['POST', '/api/entities', { entity: { id: `e${n++}`, name: `E ${n}`, kind: pick(kinds), ...(rnd() < 0.5 ? { parent: maybe(ents) } : {}) }, ...(rnd() < 0.5 ? { place: { drawing: d, x: Math.floor(rnd() * 40) * 8, y: Math.floor(rnd() * 40) * 8 } } : {}) }],
        () => ['PATCH', `/api/entities/${maybe(ents)}`, rnd() < 0.5 ? { set: { kind: pick(kinds) } } : { parent: rnd() < 0.3 ? null : maybe(ents) }],
        () => ['PATCH', `/api/entities/${maybe(ents)}`, { set: { caption: `c${i}`, status: pick(['live', 'future', 'deprecated', 'removed']) } }],
        () => ['DELETE', `/api/entities/${maybe(ents)}${rnd() < 0.5 ? '?cascade=true' : ''}`],
        () => ['POST', `/api/entities/${maybe(ents)}/connections`, { connection: { id: `c${n++}`, to: maybe(ents), label: rnd() < 0.1 ? '' : `Liga ${i}` } }],
        () => ['PATCH', `/api/connections/${maybe(refs)}`, rnd() < 0.4 ? { reverse: true } : { set: { to: maybe(ents) } }],
        () => ['DELETE', `/api/connections/${maybe(refs)}${rnd() < 0.5 ? '?cascade=true' : ''}`],
        () => ['POST', `/api/drawings/${d}/ops`, { ops: [{ op: 'place', nodes: [{ id: maybe(ents), x: Math.floor(rnd() * 60) * 8, y: Math.floor(rnd() * 60) * 8 }] }] }],
        () => ['POST', `/api/drawings/${d}/ops`, { ops: [{ op: 'remove-nodes', ids: [maybe(ents)] }] }],
        () => ['POST', `/api/drawings/${d}/ops`, { ops: [{ op: 'draw-edges', edges: [{ ref: maybe(refs) }] }] }],
        () => ['POST', `/api/drawings/${d}/ops`, { ops: [{ op: 'remove-edges', refs: [maybe(refs)] }] }],
        () => ['POST', `/api/drawings/${d}/ops`, { ops: [{ op: 'update-edge', ref: maybe(refs), set: { from: pick(sides) } }] }],
        () => ['POST', `/api/drawings/${d}/ops`, { ops: [{ op: 'set-group', group: { id: `g${n++}`, label: 'G', members: [maybe(ents), maybe(ents)] } }] }],
        () => ['PATCH', `/api/drawings/${d}`, { set: { scope: rnd() < 0.3 ? null : maybe(ents) } }],
        () => ['POST', '/api/flows', { flow: { id: `f${n++}`, name: 'F', drawing: maybe(drawings), steps: [{ id: 's', via: maybe(refs), text: 'x' }] } }],
        () => ['POST', '/api/ops', { ops: [{ op: 'flow.add-steps', flow: maybe(flows), steps: [{ id: `s${n++}`, via: maybe(refs), text: 'x', ...(rnd() < 0.3 ? { reverse: true } : {}) }] }] }],
        () => ['PATCH', `/api/flows/${maybe(flows)}`, { set: { drawing: maybe(drawings) } }],
        () => ['DELETE', `/api/flows/${maybe(flows)}`],
        () => ['DELETE', `/api/drawings/${maybe(drawings)}`],
        () => ['POST', rnd() < 0.5 ? '/api/undo' : '/api/redo'],
      ];
      const [method, path, body] = pick(actions)();
      const r = await call(method, path, body);
      if (r.body.ok) accepted++;
      else rejected++;
      const errs = await errors();
      expect(errs, `step ${i}: ${method} ${path} ${JSON.stringify(body)} -> ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`).toEqual([]);
    }
    console.log(`randomized session: ${accepted} accepted, ${rejected} refused`);
    // Both paths must really be exercised.
    expect(accepted).toBeGreaterThan(40);
    expect(rejected).toBeGreaterThan(40);
  }, 120_000);
});
