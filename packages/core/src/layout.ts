import ELKModule from 'elkjs/lib/elk.bundled.js';
import type { ELK as ElkApi } from 'elkjs/lib/elk-api.js';
import { resolveEndpoint, type Project } from './project.js';
import type { Drawing } from './schema.js';
import { nodeSize } from './validate.js';

// elkjs is CommonJS (`module.exports = ELK`); NodeNext types see it as a namespace.
const ELK = ((ELKModule as any).default ?? ELKModule) as new () => ElkApi;
const elk = new ELK();

/**
 * Layered left-to-right layout of a drawing (or a subset of its nodes),
 * snapped to the grid. A subset keeps its current top-left corner.
 * ponytail: flat layout; children of expanded containers are laid out as peers.
 */
export async function autoLayout(project: Project, drawing: Drawing, ids?: string[]): Promise<Record<string, { x: number; y: number }>> {
  const nodes = drawing.nodes ?? {};
  const selected = (ids?.length ? ids : Object.keys(nodes)).filter((id) => nodes[id]);
  if (!selected.length) return {};
  const set = new Set(selected);
  const edges = Object.keys(drawing.edges ?? {})
    .map((ref) => {
      const c = project.connections.get(ref);
      if (!c) return undefined;
      const a = resolveEndpoint(project, drawing, c.from);
      const b = resolveEndpoint(project, drawing, c.conn.to);
      return a && b && a !== b && set.has(a) && set.has(b) ? { id: ref, sources: [a], targets: [b] } : undefined;
    })
    .filter((e): e is NonNullable<typeof e> => !!e);

  const graph = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '64',
      'elk.layered.spacing.nodeNodeBetweenLayers': '160',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    },
    children: selected.sort().map((id) => ({ id, width: nodeSize(project, id, nodes[id]).w, height: nodeSize(project, id, nodes[id]).h })),
    edges,
  });

  const g = project.config.grid;
  const originX = ids?.length ? Math.min(...selected.map((id) => nodes[id].x)) : 0;
  const originY = ids?.length ? Math.min(...selected.map((id) => nodes[id].y)) : 0;
  const out: Record<string, { x: number; y: number }> = {};
  for (const child of graph.children ?? []) {
    out[child.id] = { x: Math.round((originX + (child.x ?? 0)) / g) * g, y: Math.round((originY + (child.y ?? 0)) / g) * g };
  }
  return out;
}
