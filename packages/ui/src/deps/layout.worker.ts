// Layered auto-layout off the main thread (spec section 16: elkjs in a web worker).
import ELK from 'elkjs/lib/elk.bundled.js';

export interface LayoutRequest {
  id: number;
  nodes: { id: string; w: number; h: number }[];
  edges: { id: string; source: string; target: string }[];
}
export interface LayoutResponse {
  id: number;
  positions: Record<string, { x: number; y: number }>;
  error?: string;
}

const elk = new ELK();

self.onmessage = async (e: MessageEvent<LayoutRequest>) => {
  const { id, nodes, edges } = e.data;
  try {
    const graph = await elk.layout({
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '56',
        'elk.layered.spacing.nodeNodeBetweenLayers': '140',
      },
      children: nodes.map((n) => ({ id: n.id, width: n.w, height: n.h })),
      edges: edges.map((ed) => ({ id: ed.id, sources: [ed.source], targets: [ed.target] })),
    });
    const positions: LayoutResponse['positions'] = {};
    for (const c of graph.children ?? []) positions[c.id] = { x: Math.round(c.x ?? 0), y: Math.round(c.y ?? 0) };
    (self as unknown as Worker).postMessage({ id, positions } satisfies LayoutResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, positions: {}, error: String(err) } satisfies LayoutResponse);
  }
};
