import type { Index } from './model';
import type { Drawing, Flow, WithFile } from './types';

export interface DrawingTreeNode {
  drawing: WithFile<Drawing>;
  /** Child drawings first (model order), then `flows`. */
  children: DrawingTreeNode[];
  flows: WithFile<Flow>[];
}

export interface DrawingTree {
  roots: DrawingTreeNode[];
  /** Flows whose `drawing` does not exist. */
  unassignedFlows: WithFile<Flow>[];
  /** Parent drawing id of each drawing (null at root level). */
  parentOf: Map<string, string | null>;
}

/**
 * Sidebar tree of drawings, nested by the entity `parent` hierarchy.
 * Root level: drawings with scope null. A drawing scoped to E nests under the first
 * drawing of the nearest ancestor of E (E.parent, its parent, ...) that has drawings;
 * failing that, under the first root drawing, or at root level if there is none.
 */
export function buildDrawingTree(index: Pick<Index, 'drawings' | 'drawingsByScope' | 'ancestors'>, flows: WithFile<Flow>[]): DrawingTree {
  const fallback = index.drawingsByScope.get(null)?.[0]?.id ?? null;
  const parentOf = new Map<string, string | null>();
  for (const d of index.drawings.values()) {
    if (!d.scope) {
      parentOf.set(d.id, null);
      continue;
    }
    // `ancestors` includes the scope itself first and stops on parent cycles.
    const owner = index.ancestors(d.scope).slice(1).find((a) => index.drawingsByScope.get(a)?.length);
    parentOf.set(d.id, owner ? index.drawingsByScope.get(owner)![0].id : fallback);
  }
  // A cycle in entity parents can still make two drawings each other's parent: re-attach to the fallback.
  for (const id of parentOf.keys()) {
    const seen = new Set<string>([id]);
    for (let p = parentOf.get(id); p; p = parentOf.get(p)) {
      if (seen.has(p)) {
        parentOf.set(id, fallback === id ? null : fallback);
        break;
      }
      seen.add(p);
    }
  }

  const nodes = new Map<string, DrawingTreeNode>();
  for (const d of index.drawings.values()) nodes.set(d.id, { drawing: d, children: [], flows: [] });
  const roots: DrawingTreeNode[] = [];
  for (const [id, parent] of parentOf) (parent ? nodes.get(parent)!.children : roots).push(nodes.get(id)!);
  const unassignedFlows: WithFile<Flow>[] = [];
  for (const f of flows) (nodes.get(f.drawing)?.flows ?? unassignedFlows).push(f);
  return { roots, unassignedFlows, parentOf };
}
