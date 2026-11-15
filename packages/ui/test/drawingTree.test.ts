import { describe, expect, it } from 'vitest';
import { buildDrawingTree, type DrawingTreeNode } from '../src/drawingTree';
import { buildIndex } from '../src/model';
import type { Model } from '../src/types';

type Ent = [id: string, parent?: string];
type Draw = [id: string, scope: string | null];

function tree(entities: Ent[], drawings: Draw[], flows: [id: string, drawing: string][] = []) {
  const model = {
    entities: entities.map(([id, parent]) => ({ id, name: id, kind: 'system', parent, file: `${id}.yaml` })),
    drawings: drawings.map(([id, scope]) => ({ id, name: id, scope, file: `drawings/${id}.yaml` })),
    flows: flows.map(([id, drawing]) => ({ id, name: id, drawing, steps: [], file: `flows/${id}.yaml` })),
  } as unknown as Model;
  return buildDrawingTree(buildIndex(model), model.flows);
}

/** Compact shape: drawing id -> children shape; flows as `~id`. */
const shape = (nodes: DrawingTreeNode[]): Record<string, unknown> =>
  Object.fromEntries(nodes.map((n) => [n.drawing.id, { ...shape(n.children), ...Object.fromEntries(n.flows.map((f) => [`~${f.id}`, true])) }]));

describe('buildDrawingTree', () => {
  it('puts unscoped drawings at root level', () => {
    expect(shape(tree([], [['a', null], ['b', null]]).roots)).toEqual({ a: {}, b: {} });
  });

  it('nests a drawing whose scope has no parent under the first root drawing', () => {
    // Example project: "Context" (root) -> "Papo platform" scoped to a top-level entity.
    expect(shape(tree([['papo']], [['context', null], ['papo-platform', 'papo']]).roots)).toEqual({ context: { 'papo-platform': {} } });
  });

  it('nests under the nearest ancestor with drawings, skipping entities without any', () => {
    const t = tree(
      [['sys'], ['app', 'sys'], ['comp', 'app']],
      [['ctx', null], ['sys-d', 'sys'], ['sys-d2', 'sys'], ['comp-d', 'comp']],
    );
    expect(shape(t.roots)).toEqual({ ctx: { 'sys-d': { 'comp-d': {} }, 'sys-d2': {} } });
    expect(t.parentOf.get('comp-d')).toBe('sys-d');
  });

  it('shows orphans at root level when there is no root drawing', () => {
    expect(shape(tree([['x']], [['x-d', 'x'], ['ghost-d', 'missing']]).roots)).toEqual({ 'x-d': {}, 'ghost-d': {} });
  });

  it('terminates on entity parent cycles and keeps every drawing exactly once', () => {
    const t = tree([['x', 'y'], ['y', 'x']], [['root', null], ['x-d', 'x'], ['y-d', 'y']]);
    const ids: string[] = [];
    const walk = (ns: DrawingTreeNode[]) => ns.forEach((n) => (ids.push(n.drawing.id), walk(n.children)));
    walk(t.roots);
    expect(ids.sort()).toEqual(['root', 'x-d', 'y-d']);
    expect(t.roots.map((n) => n.drawing.id)).toEqual(['root']);
  });

  it('attaches flows to their drawing and collects unassigned ones', () => {
    const t = tree([], [['a', null]], [['f1', 'a'], ['f2', 'gone']]);
    expect(shape(t.roots)).toEqual({ a: { '~f1': true } });
    expect(t.unassignedFlows.map((f) => f.id)).toEqual(['f2']);
  });
});
