/**
 * Hover highlighting: the hovered node or edge, plus its direct connections,
 * stays lit while everything else fades. Applied as one generated stylesheet
 * keyed by React Flow's `data-id` attributes, so hovering never rebuilds the
 * graph or re-renders a single node or edge.
 */

export type Hover = { node: string } | { edge: string; source: string; target: string };
type Link = { id: string; source: string; target: string };

/** Ids to keep lit: a node with its neighbours and the edges between them, or an edge with its two ends. */
export function hoverTargets(hover: Hover, edges: readonly Link[]): { nodes: Set<string>; edges: Set<string> } {
  if ('edge' in hover) return { nodes: new Set([hover.source, hover.target]), edges: new Set([hover.edge]) };
  const nodes = new Set([hover.node]);
  const lit = new Set<string>();
  for (const e of edges) {
    if (e.source !== hover.node && e.target !== hover.node) continue;
    lit.add(e.id);
    nodes.add(e.source);
    nodes.add(e.target);
  }
  return { nodes, edges: lit };
}

/** Attribute selector value, quoted; ids may hold dots, colons or quotes. */
const q = (id: string) => `"${id.replace(/["\\]/g, '\\$&')}"`;

/** CSS for one hover state, scoped to the `.zark-hovering` canvas wrapper. */
export function hoverCss(t: { nodes: Set<string>; edges: Set<string> }): string {
  const nodes = [...t.nodes].map((id) => `.zark-hovering .react-flow__node[data-id=${q(id)}]`);
  const edges = [...t.edges].map((id) => `.zark-hovering .react-flow__edge[data-id=${q(id)}]`);
  const litLabels = [...t.edges].map((id) => `[data-edge-label=${q(id)}]`);
  const rules = [
    '.zark-hovering .react-flow__node, .zark-hovering .react-flow__edge { opacity: 0.3; }',
    // Labels carry an inline opacity (filter/flow dim), so fade them with a filter that multiplies with it.
    `.zark-hovering [data-edge-label]${litLabels.length ? `:not(${litLabels.join(', ')})` : ''} { filter: opacity(0.3); }`,
  ];
  if (nodes.length || edges.length) rules.push(`${[...nodes, ...edges].join(', ')} { opacity: 1; }`);
  if (edges.length) rules.push(`${edges.map((s) => `${s} .react-flow__edge-path`).join(', ')} { stroke: var(--accent) !important; stroke-width: 2.25 !important; }`);
  return rules.join('\n');
}
