/**
 * What the right panel shows outside flow mode and the problems/changes views:
 * the model list, the current drawing's properties, the editor for the selection,
 * or, in the code view, the detail of the selected module or piece.
 */
export type RightView = 'list' | 'drawing' | 'selection' | 'code';

export function rightView(selection: { nodes: string[]; edges: string[] }, drawingDetails: boolean, hasDrawing: boolean, codeView = false): RightView {
  // The code view's selection holds module/piece ids, never entities: only the code detail can show them.
  if (codeView) return 'code';
  if (selection.nodes.length || selection.edges.length) return 'selection';
  return drawingDetails && hasDrawing ? 'drawing' : 'list';
}
