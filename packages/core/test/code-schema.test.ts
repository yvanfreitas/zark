import { describe, expect, it } from 'vitest';
import { buildProject, fileKind, formatText, validate } from '../src/index.js';
import { Config, Entity } from '../src/schema.js';

const entity = { id: 'bot', name: 'Bot', kind: 'component', parent: 'api' };
const graph = `component: bot
modules: []
edges: []
unresolved:
  calls: 0
  external: 0
  unowned: 0
`;

describe('code-level schema', () => {
  it('parses source as string and list', () => {
    expect(Entity.parse({ ...entity, source: 'src/bot' }).source).toBe('src/bot');
    expect(Entity.parse({ ...entity, source: ['src/a', 'src/b'] }).source).toEqual(['src/a', 'src/b']);
  });

  it('rejects source with a number', () => {
    expect(Entity.safeParse({ ...entity, source: 3 }).success).toBe(false);
  });

  it('config accepts code.tsconfig and code.exclude', () => {
    const c = Config.parse({ schema: 1, name: 'X', code: { tsconfig: 'tsconfig.json', exclude: ['**/*.test.ts'] } });
    expect(c.code).toEqual({ tsconfig: 'tsconfig.json', exclude: ['**/*.test.ts'] });
  });

  it('loads code/bot.yaml into project.codeGraphs', () => {
    expect(fileKind('code/bot.yaml')).toBe('code');
    const p = buildProject('/x', new Map([['code/bot.yaml', graph]]));
    expect(p.codeGraphs.get('bot')).toMatchObject({ file: 'code/bot.yaml', graph: { component: 'bot' } });
    expect(validate(p).filter((x) => x.file === 'code/bot.yaml')).toEqual([]);
  });

  it('invalid code file yields E001 like other kinds', () => {
    const p = buildProject('/x', new Map([['code/bot.yaml', graph.replace('modules: []', 'modules: 5')]]));
    expect(p.codeGraphs.size).toBe(0);
    expect(validate(p).map((x) => x.code)).toContain('E001');
  });

  it('flags a code file whose component differs from the file name (E002)', () => {
    const p = buildProject('/x', new Map([['code/other.yaml', graph]]));
    expect(validate(p).map((x) => x.code)).toContain('E002');
  });

  it('canonical writer orders code graph keys', () => {
    const shuffled = `unresolved: { unowned: 3, external: 2, calls: 1 }
edges:
  - { count: 2, kind: calls, to: src/b.ts#B, from: src/a.ts#A.run }
modules:
  - pieces:
      - { members: [run, stop], kind: class, name: A }
    path: src/a.ts
component: bot
`;
    const expected = `# yaml-language-server: $schema=https://unpkg.com/zark/schema/code.json

component: bot
modules:
  - path: src/a.ts
    pieces:
      - name: A
        kind: class
        members: [ run, stop ]
edges:
  - from: src/a.ts#A.run
    to: src/b.ts#B
    kind: calls
    count: 2
unresolved:
  calls: 1
  external: 2
  unowned: 3
`;
    expect(formatText('code', shuffled)).toBe(expected);
    expect(formatText('code', expected)).toBe(expected);
  });
});
