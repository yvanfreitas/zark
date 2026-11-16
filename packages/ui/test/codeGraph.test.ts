import { describe, expect, it } from 'vitest';
import { moduleLevel, parseNodeId, pieceLevel } from '../src/code/codeGraph';
import type { CodeGraph } from '../src/types';

const unresolved = { calls: 0, external: 0, unowned: 0 };

const bot: CodeGraph = {
  component: 'bot',
  modules: [
    { path: 'src/handler.ts', pieces: [{ name: 'handle', kind: 'function' }] },
    { path: 'src/orch.ts', pieces: [{ name: 'Orch', kind: 'class', members: ['run', 'retry'] }, { name: 'Base', kind: 'class' }] },
    { path: 'src/idle.ts', pieces: [{ name: 'idle', kind: 'const' }] },
  ],
  edges: [
    { from: 'src/handler.ts', to: 'src/handler.ts#handle', kind: 'calls', count: 1 },
    { from: 'src/handler.ts#handle', to: 'src/orch.ts#Orch', kind: 'instantiates', count: 1 },
    { from: 'src/handler.ts#handle', to: 'src/orch.ts#Orch.run', kind: 'calls', count: 2 },
    { from: 'src/orch.ts#Orch.run', to: 'src/orch.ts#Orch.retry', kind: 'calls', count: 1 },
    { from: 'src/orch.ts#Orch', to: 'src/orch.ts#Base', kind: 'extends', count: 1 },
    { from: 'src/orch.ts#Orch.retry', to: 'mod:m/client.ts#Client.classify', kind: 'calls', count: 3 },
  ],
  unresolved,
};

const mod: CodeGraph = {
  component: 'mod',
  modules: [{ path: 'm/client.ts', pieces: [{ name: 'Client', kind: 'class', members: ['classify'] }] }],
  edges: [{ from: 'm/client.ts#Client.classify', to: 'bot:src/handler.ts#handle', kind: 'calls', count: 1 }],
  unresolved,
};

const all = [bot, mod];

describe('moduleLevel', () => {
  it('module level aggregates member edges with counts', () => {
    const { nodes, edges } = moduleLevel(bot, all);
    expect(nodes.filter((n) => !n.foreign).map((n) => [n.id, n.label])).toEqual([
      ['src/handler.ts', 'handler.ts'],
      ['src/idle.ts', 'idle.ts'],
      ['src/orch.ts', 'orch.ts'],
    ]);
    expect(edges.find((e) => e.from === 'src/handler.ts' && e.to === 'src/orch.ts')).toEqual({
      from: 'src/handler.ts',
      to: 'src/orch.ts',
      count: 3,
      kinds: ['calls', 'instantiates'],
    });
  });

  it('foreign modules from other components are marked', () => {
    const { nodes, edges } = moduleLevel(bot, all);
    expect(nodes.filter((n) => n.foreign)).toEqual([{ id: 'mod:m/client.ts', label: 'client.ts', foreign: true }]);
    // Both directions: bot calls into mod, and mod's own graph calls back into bot.
    expect(edges).toContainEqual({ from: 'src/orch.ts', to: 'mod:m/client.ts', count: 3, kinds: ['calls'] });
    expect(edges).toContainEqual({ from: 'mod:m/client.ts', to: 'src/handler.ts', count: 1, kinds: ['calls'] });
  });

  it('self edges never appear', () => {
    expect(moduleLevel(bot, all).edges.filter((e) => e.from === e.to)).toEqual([]);
    expect(pieceLevel(bot, 'src/orch.ts', all).edges.filter((e) => e.from === e.to)).toEqual([]);
  });

  it('works when the other graphs list is empty or omits this graph', () => {
    expect(moduleLevel(bot, []).edges).toEqual(moduleLevel(bot, [bot]).edges.filter((e) => !e.from.startsWith('mod:')));
  });
});

describe('pieceLevel', () => {
  it('piece level folds members into classes', () => {
    const { nodes, edges } = pieceLevel(bot, 'src/orch.ts', all);
    expect(nodes).toEqual([
      { id: 'src/orch.ts#Base', label: 'Base', foreign: false },
      { id: 'src/orch.ts#Orch', label: 'Orch', foreign: false },
      { id: 'mod:m/client.ts#Client', label: 'Client', foreign: true },
      { id: 'src/handler.ts#handle', label: 'handle', foreign: true },
    ]);
    expect(edges).toEqual([
      { from: 'src/handler.ts#handle', to: 'src/orch.ts#Orch', count: 3, kinds: ['calls', 'instantiates'] },
      { from: 'src/orch.ts#Orch', to: 'mod:m/client.ts#Client', count: 3, kinds: ['calls'] },
      { from: 'src/orch.ts#Orch', to: 'src/orch.ts#Base', count: 1, kinds: ['extends'] },
    ]);
  });

  it('module-level code shows as a node of its own', () => {
    const { nodes, edges } = pieceLevel(bot, 'src/handler.ts', all);
    expect(nodes).toContainEqual({ id: 'src/handler.ts', label: 'handler.ts', foreign: false });
    expect(edges).toContainEqual({ from: 'src/handler.ts', to: 'src/handler.ts#handle', count: 1, kinds: ['calls'] });
  });
});

describe('parseNodeId', () => {
  it('splits component, path and piece', () => {
    expect(parseNodeId('src/orch.ts#Orch', 'bot')).toEqual({ component: 'bot', path: 'src/orch.ts', piece: 'Orch' });
    expect(parseNodeId('mod:m/client.ts', 'bot')).toEqual({ component: 'mod', path: 'm/client.ts' });
  });
});
