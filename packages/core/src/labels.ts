import { drawingGeometry, labelOverlaps, type GeometryBox, type GeometryEdge } from './edge-geometry.js';
import { resolveEndpoint, type Project } from './project.js';
import type { Drawing } from './schema.js';
import { nodeSize } from './validate.js';

/** Boxes and drawable connectors of a drawing, as the canvas shows them (no filters). */
export function geometryInput(project: Project, drawing: Drawing): { boxes: GeometryBox[]; edges: GeometryEdge[] } {
  const boxes: GeometryBox[] = Object.entries(drawing.nodes ?? {})
    .filter(([id]) => project.entities.has(id))
    .map(([id, n]) => ({ id, x: n.x, y: n.y, ...nodeSize(project, id, n), expanded: !!n.expanded }));
  const edges: GeometryEdge[] = [];
  for (const [ref, spec] of Object.entries(drawing.edges ?? {})) {
    const c = project.connections.get(ref);
    if (!c) continue;
    const source = resolveEndpoint(project, drawing, c.from);
    const target = resolveEndpoint(project, drawing, c.conn.to);
    if (!source || !target || source === target) continue;
    edges.push({ ref, source, target, spec, label: c.conn.label });
  }
  return { boxes, edges };
}

export function drawingLabelOverlaps(project: Project, drawing: Drawing) {
  const { boxes, edges } = geometryInput(project, drawing);
  const geometry = drawingGeometry(boxes, edges);
  return { overlaps: labelOverlaps(boxes, edges, geometry), geometry, boxes, edges };
}
