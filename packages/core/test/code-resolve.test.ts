import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractModule, type ModuleFacts } from '../src/code/extract.js';
import { loadAliases, resolveExport, resolveSpecifier, type Aliases } from '../src/code/resolve.js';

const none: Aliases = { paths: [] };
const set = (...f: string[]) => new Set(f);

let tmp: string | undefined;
afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
  tmp = undefined;
});
async function repo(files: Record<string, string>): Promise<string> {
  tmp = await mkdtemp(join(tmpdir(), 'zark-resolve-'));
  for (const [p, text] of Object.entries(files)) {
    await mkdir(join(tmp, p, '..'), { recursive: true });
    await writeFile(join(tmp, p), text);
  }
  return tmp;
}

describe('resolveSpecifier', () => {
  it('relative with and without extension', () => {
    const files = set('src/a.ts', 'src/b.ts', 'src/c.tsx', 'lib/d.ts');
    expect(resolveSpecifier('src/a.ts', './b', files, none)).toBe('src/b.ts');
    expect(resolveSpecifier('src/a.ts', './b.ts', files, none)).toBe('src/b.ts');
    expect(resolveSpecifier('src/a.ts', './c', files, none)).toBe('src/c.tsx');
    expect(resolveSpecifier('src/a.ts', '../lib/d', files, none)).toBe('lib/d.ts');
    expect(resolveSpecifier('src/a.ts', './missing', files, none)).toBe('external');
  });

  it('index files', () => {
    const files = set('src/a.ts', 'src/util/index.ts');
    expect(resolveSpecifier('src/a.ts', './util', files, none)).toBe('src/util/index.ts');
    expect(resolveSpecifier('src/util/index.ts', '..', files, none)).toBe('external');
    expect(resolveSpecifier('src/util/index.ts', '../a', files, none)).toBe('src/a.ts');
  });

  it('.js specifier to .ts file', () => {
    const files = set('src/a.ts', 'src/b.ts', 'src/c.tsx', 'src/d.js');
    expect(resolveSpecifier('src/a.ts', './b.js', files, none)).toBe('src/b.ts');
    expect(resolveSpecifier('src/a.ts', './c.js', files, none)).toBe('src/c.tsx');
    expect(resolveSpecifier('src/a.ts', './d.js', files, none)).toBe('src/d.js');
  });

  it('tsconfig paths and baseUrl', () => {
    const files = set('src/a.ts', 'src/lib/x.ts', 'src/shared/y/index.ts');
    const aliases: Aliases = { baseUrl: 'src', paths: [['@lib/*', ['src/lib/*']], ['@y', ['src/shared/y']]] };
    expect(resolveSpecifier('src/a.ts', '@lib/x', files, aliases)).toBe('src/lib/x.ts');
    expect(resolveSpecifier('src/a.ts', '@y', files, aliases)).toBe('src/shared/y/index.ts');
    expect(resolveSpecifier('src/a.ts', 'lib/x', files, aliases)).toBe('src/lib/x.ts');
    expect(resolveSpecifier('src/a.ts', '@lib/nope', files, aliases)).toBe('external');
  });

  it('bare and workspace packages are external', () => {
    const files = set('src/a.ts', 'src/moderation.ts');
    expect(resolveSpecifier('src/a.ts', 'react', files, none)).toBe('external');
    expect(resolveSpecifier('src/a.ts', '@acme/moderation', files, none)).toBe('external');
    expect(resolveSpecifier('src/a.ts', 'node:fs', files, none)).toBe('external');
  });
});

describe('loadAliases', () => {
  it('reads paths and baseUrl, tolerating comments and trailing commas', async () => {
    const root = await repo({
      'tsconfig.json': `{
        // comment
        "compilerOptions": { "baseUrl": "src", /* c */ "paths": { "@/*": ["*",], "u//x": ["a"] }, },
      }`,
    });
    expect(await loadAliases(root)).toEqual({
      baseUrl: 'src',
      paths: [['@/*', ['src/*']], ['u//x', ['src/a']]],
    });
  });

  it('tsconfig extends chain', async () => {
    const root = await repo({
      'tsconfig.base.json': '{"compilerOptions":{"baseUrl":".","paths":{"@core/*":["packages/core/src/*"]}}}',
      'packages/app/tsconfig.base2.json': '{"extends":"../../tsconfig.base","compilerOptions":{}}',
      'packages/app/tsconfig.json': '{"extends":"./tsconfig.base2.json","compilerOptions":{"strict":true}}',
    });
    expect(await loadAliases(root, 'packages/app/tsconfig.json')).toEqual({
      baseUrl: '.',
      paths: [['@core/*', ['packages/core/src/*']]],
    });
  });

  it('child paths override; package-name extends and missing files are ignored', async () => {
    const root = await repo({
      'tsconfig.json': '{"extends":["@tsconfig/node22/tsconfig.json"],"compilerOptions":{"paths":{"a/*":["x/*"]}}}',
    });
    expect(await loadAliases(root)).toEqual({ paths: [['a/*', ['x/*']]] });
    expect(await loadAliases(root, 'nope.json')).toEqual({ paths: [] });
  });
});

describe('resolveExport', () => {
  const facts = (m: Record<string, string>) =>
    new Map<string, ModuleFacts>(Object.entries(m).map(([p, t]) => [p, extractModule(p, t)]));

  it('follows named, aliased, star and namespace re-exports', () => {
    const f = facts({
      'src/index.ts': `export { a as b } from './impl'; export * from './more'; export * as ns from './more'; export { default as d } from './impl';`,
      'src/impl.ts': `export function a() {} export default function () {}`,
      'src/more.ts': `export function m() {} export default 1;`,
    });
    const files = new Set(f.keys());
    expect(resolveExport('src/index.ts', 'b', f, files, none)).toEqual({ path: 'src/impl.ts', name: 'a' });
    expect(resolveExport('src/index.ts', 'm', f, files, none)).toEqual({ path: 'src/more.ts', name: 'm' });
    expect(resolveExport('src/index.ts', 'ns', f, files, none)).toEqual({ path: 'src/more.ts', name: '*' });
    expect(resolveExport('src/index.ts', 'd', f, files, none)).toEqual({ path: 'src/impl.ts', name: 'default' });
    expect(resolveExport('src/index.ts', 'default', f, files, none)).toBeUndefined();
    expect(resolveExport('src/index.ts', 'zzz', f, files, none)).toBeUndefined();
  });

  it('re-export chains and cycles', () => {
    const f = facts({
      'src/a.ts': `export * from './b';`,
      'src/b.ts': `export * from './a'; export * from './c';`,
      'src/c.ts': `export function target() {}`,
    });
    const files = new Set(f.keys());
    expect(resolveExport('src/a.ts', 'target', f, files, none)).toEqual({ path: 'src/c.ts', name: 'target' });
    expect(resolveExport('src/a.ts', 'ghost', f, files, none)).toBeUndefined();
    const cyc = facts({ 'src/a.ts': `export { x } from './b';`, 'src/b.ts': `export { x } from './a';` });
    expect(resolveExport('src/a.ts', 'x', cyc, new Set(cyc.keys()), none)).toBeUndefined();
  });

  it('external re-exports resolve to undefined', () => {
    const f = facts({ 'src/a.ts': `export { z } from 'lodash';` });
    expect(resolveExport('src/a.ts', 'z', f, new Set(f.keys()), none)).toBeUndefined();
  });
});
