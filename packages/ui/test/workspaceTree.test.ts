import { describe, expect, it } from 'vitest';
import { ancestorsOf, buildRepoTree } from '../src/workspaceTree';
import type { WorkspaceEntry } from '../src/types';

const repo = (key: string): WorkspaceEntry => ({ key, prefix: `/r/${encodeURIComponent(key)}`, name: key, dir: key, drawings: 0, errors: 0, warnings: 0, roots: [] });
const shape = (nodes: ReturnType<typeof buildRepoTree>): unknown[] => nodes.map((n) => [n.path, n.label, n.repo ? 'repo' : 'folder', shape(n.children)]);

describe('buildRepoTree', () => {
  it('lists flat keys sorted by label', () => {
    expect(shape(buildRepoTree([repo('b'), repo('a')]))).toEqual([['a', 'a', 'repo', []], ['b', 'b', 'repo', []]]);
  });
  it('groups nested keys into folders labelled by segment', () => {
    expect(shape(buildRepoTree([repo('a/b/c'), repo('a/z')]))).toEqual([
      ['a', 'a', 'folder', [['a/b', 'b', 'folder', [['a/b/c', 'c', 'repo', []]]], ['a/z', 'z', 'repo', []]]],
    ]);
  });
  it('lets a repo hold nested repos', () => {
    expect(shape(buildRepoTree([repo('mono/pkg'), repo('mono')]))).toEqual([['mono', 'mono', 'repo', [['mono/pkg', 'pkg', 'repo', []]]]]);
  });
});

describe('ancestorsOf', () => {
  it('returns every parent path', () => {
    expect(ancestorsOf('a/b/c')).toEqual(['a', 'a/b']);
    expect(ancestorsOf('x')).toEqual([]);
  });
});
