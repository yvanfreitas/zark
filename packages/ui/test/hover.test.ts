// Hover highlight: which ids stay lit, and the stylesheet that lights them.
import { describe, expect, it } from 'vitest';
import { hoverCss, hoverTargets } from '../src/canvas/hover';

const edges = [
  { id: 'e1', source: 'a', target: 'b' },
  { id: 'e2', source: 'c', target: 'a' },
  { id: 'e3', source: 'b', target: 'c' },
  { id: 'e4', source: 'a', target: 'b' }, // parallel connector
];

describe('hoverTargets', () => {
  it('lights a node, its direct neighbours and only the edges touching it', () => {
    const t = hoverTargets({ node: 'a' }, edges);
    expect([...t.nodes].sort()).toEqual(['a', 'b', 'c']);
    expect([...t.edges].sort()).toEqual(['e1', 'e2', 'e4']);
  });

  it('lights an unconnected node alone', () => {
    const t = hoverTargets({ node: 'z' }, edges);
    expect([...t.nodes]).toEqual(['z']);
    expect(t.edges.size).toBe(0);
  });

  it('lights an edge and its two rendered ends (inherited edges end on placed ancestors)', () => {
    const t = hoverTargets({ edge: 'e3', source: 'b', target: 'c' }, edges);
    expect([...t.nodes].sort()).toEqual(['b', 'c']);
    expect([...t.edges]).toEqual(['e3']);
  });
});

describe('hoverCss', () => {
  it('dims everything and re-lights the targets by data-id', () => {
    const css = hoverCss(hoverTargets({ node: 'a' }, edges));
    expect(css).toContain('.zark-hovering .react-flow__node, .zark-hovering .react-flow__edge { opacity: 0.3; }');
    expect(css).toContain('.react-flow__node[data-id="b"]');
    expect(css).toContain('.react-flow__edge[data-id="e1"] .react-flow__edge-path');
    expect(css).toContain(':not([data-edge-label="e1"]');
    expect(css).not.toContain('data-id="e3"');
  });

  it('quotes ids holding quotes or backslashes so the selector stays valid', () => {
    const css = hoverCss({ nodes: new Set(['x"y\\z']), edges: new Set() });
    expect(css).toContain('[data-id="x\\"y\\\\z"]');
    expect(css).not.toContain(':not(');
  });
});
