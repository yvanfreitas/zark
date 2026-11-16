import { describe, expect, it } from 'vitest';
import { rightView } from '../src/rightPanel';

const none = { nodes: [], edges: [] };

describe('rightView', () => {
  it('shows the model list when nothing is selected', () => {
    expect(rightView(none, false, true)).toBe('list');
  });

  it('shows the drawing properties when asked for, with nothing selected', () => {
    expect(rightView(none, true, true)).toBe('drawing');
  });

  it('falls back to the list when there is no drawing to describe', () => {
    expect(rightView(none, true, false)).toBe('list');
  });

  it('shows the editor for any selection, even over the drawing properties', () => {
    expect(rightView({ nodes: ['api'], edges: [] }, false, true)).toBe('selection');
    expect(rightView({ nodes: [], edges: ['a-b'] }, true, true)).toBe('selection');
    expect(rightView({ nodes: ['note:n1'], edges: [] }, false, false)).toBe('selection');
  });

  it('shows the code detail in the code view, selection or not', () => {
    expect(rightView(none, true, true, true)).toBe('code');
    expect(rightView({ nodes: ['src/a.ts'], edges: [] }, false, true, true)).toBe('code');
  });
});
