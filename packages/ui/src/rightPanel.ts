/**
 * What the right panel shows outside flow mode and the problems/changes views:
 * the model list, the current drawing's properties, or the editor for the selection.
 */
export type RightView = 'list' | 'drawing' | 'selection';

export function rightView(selection: { nodes: string[]; edges: string[] }, drawingDetails: boolean, hasDrawing: boolean): RightView {
  if (selection.nodes.length || selection.edges.length) return 'selection';
  return drawingDetails && hasDrawing ? 'drawing' : 'list';
}
