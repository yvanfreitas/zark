import { describe, expect, it } from 'vitest';
import { renderRoute, repoPrefix } from '../src/route';

describe('repoPrefix', () => {
  it('reads the /r/<repo> prefix', () => {
    expect(repoPrefix('/r/a/')).toBe('/r/a');
    expect(repoPrefix('/r/a/render/drawing/x')).toBe('/r/a');
    expect(repoPrefix('/r/a')).toBe('/r/a');
  });
  it('keeps the repo name encoded', () => {
    expect(repoPrefix('/r/my%20repo/')).toBe('/r/my%20repo');
  });
  it('is empty outside workspace mode', () => {
    expect(repoPrefix('/')).toBe('');
    expect(repoPrefix('/render/flow/f')).toBe('');
  });
});

describe('renderRoute', () => {
  it('matches without a prefix', () => {
    expect(renderRoute('/render/flow/f')).toEqual({ kind: 'flow', id: 'f' });
  });
  it('matches with a prefix', () => {
    expect(renderRoute('/r/a/render/drawing/x')).toEqual({ kind: 'drawing', id: 'x' });
  });
  it('decodes the id', () => {
    expect(renderRoute('/render/drawing/a%20b/')).toEqual({ kind: 'drawing', id: 'a b' });
  });
  it('ignores non-render paths', () => {
    expect(renderRoute('/r/a/')).toBeUndefined();
    expect(renderRoute('/')).toBeUndefined();
  });
});
