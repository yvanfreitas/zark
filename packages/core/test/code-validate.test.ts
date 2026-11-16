import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildProject, claimFiles, repoRootOf, validate } from '../src/index.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const entityYaml = (id: string, kind: string, extra = '') => `id: ${id}\nname: ${id}\nkind: ${kind}\n${extra}`;
const graphYaml = (component: string) => `component: ${component}\nmodules: []\nedges: []\nunresolved:\n  calls: 0\n  external: 0\n  unowned: 0\n`;

function project(entities: Record<string, string>, extra: Record<string, string> = {}, dir = '/x/architecture') {
  const texts = new Map<string, string>(Object.entries(extra));
  for (const [id, yaml] of Object.entries(entities)) texts.set(`entities/${id}.yaml`, yaml);
  return buildProject(dir, texts);
}
const codes = (p: ReturnType<typeof project>) => validate(p).map((x) => x.code);

async function repo(files: string[]) {
  const root = await mkdtemp(join(tmpdir(), 'zark-src-'));
  dirs.push(root);
  for (const f of files) {
    await mkdir(dirname(join(root, f)), { recursive: true });
    await writeFile(join(root, f), '');
  }
  return root;
}

const sys = entityYaml('sys', 'system');
const api = entityYaml('api', 'container', 'parent: sys\n');
const comp = (id: string, source: string) => entityYaml(id, 'component', `parent: api\nsource: ${source}\n`);

describe('YAML-only code validation', () => {
  it('E013: source on a non-component', () => {
    const p = project({ sys: entityYaml('sys', 'system', 'source: src\n') });
    expect(codes(p)).toContain('E013');
  });

  it('W014: component with source but no generated file', () => {
    const p = project({ sys, api, bot: comp('bot', 'src/bot') });
    expect(codes(p)).toContain('W014');
    const q = project({ sys, api, bot: comp('bot', 'src/bot') }, { 'code/bot.yaml': graphYaml('bot') });
    expect(codes(q)).not.toContain('W014');
  });

  it('W015: generated file whose component is missing', () => {
    const p = project({ sys, api }, { 'code/ghost.yaml': graphYaml('ghost') });
    expect(codes(p)).toContain('W015');
  });

  it('W015: generated file whose component has no source', () => {
    const p = project({ sys, api, bot: entityYaml('bot', 'component', 'parent: api\n') }, { 'code/bot.yaml': graphYaml('bot') });
    expect(codes(p)).toContain('W015');
  });

  it('E003: two code files declaring the same component', () => {
    const p = project({ sys, api, bot: comp('bot', 'src') }, { 'code/bot.yaml': graphYaml('bot'), 'code/bot2.yaml': graphYaml('bot') });
    expect(codes(p)).toContain('E003');
  });

  it('validate() never touches the filesystem (no E014 for a missing path)', () => {
    const p = project({ sys, api, bot: comp('bot', 'does/not/exist') }, { 'code/bot.yaml': graphYaml('bot') });
    expect(codes(p)).not.toContain('E014');
  });
});

describe('claimFiles', () => {
  it('claims files under a folder and by glob, only for source languages', async () => {
    const root = await repo(['src/bot/a.ts', 'src/bot/deep/b.tsx', 'src/bot/readme.md', 'lib/x.js', 'lib/y.mjs']);
    const p = project({ sys, api, bot: comp('bot', 'src/bot'), lib: entityYaml('lib', 'component', 'parent: api\nsource: lib/*.js\n') });
    const { owner, problems } = await claimFiles(root, p);
    expect(problems).toEqual([]);
    expect([...owner].sort()).toEqual([['lib/x.js', 'lib'], ['src/bot/a.ts', 'bot'], ['src/bot/deep/b.tsx', 'bot']]);
  });

  it('E014: source matching nothing', async () => {
    const root = await repo(['src/a.ts']);
    const { problems } = await claimFiles(root, project({ sys, api, bot: comp('bot', 'nope') }));
    expect(problems.map((x) => x.code)).toEqual(['E014']);
    expect(problems[0].ref).toBe('bot');
  });

  it('source with only excluded files claims nothing and is not E014', async () => {
    const root = await repo(['src/bot/a.test.ts', 'src/bot/generated/g.ts', 'src/bot/t.d.ts']);
    const { owner, problems } = await claimFiles(root, project({ sys, api, bot: comp('bot', 'src/bot') }));
    expect(owner.size).toBe(0);
    expect(problems).toEqual([]);
  });

  it('code.exclude overrides the default list', async () => {
    const root = await repo(['src/a.test.ts', 'src/b.ts']);
    const p = project({ sys, api, bot: comp('bot', 'src') }, { 'zark.yaml': 'schema: 1\nname: X\ncode:\n  exclude: ["**/b.ts"]\n' });
    const { owner } = await claimFiles(root, p);
    expect([...owner.keys()]).toEqual(['src/a.test.ts']);
  });

  it('longest source wins', async () => {
    const root = await repo(['services/bot/src/llm.ts', 'services/bot/main.ts']);
    const p = project({ sys, api, bot: comp('bot', 'services/bot'), llm: comp('llm', 'services/bot/src/llm.ts') });
    const { owner, problems } = await claimFiles(root, p);
    expect(problems).toEqual([]);
    expect(Object.fromEntries(owner)).toEqual({ 'services/bot/src/llm.ts': 'llm', 'services/bot/main.ts': 'bot' });
  });

  it('E015: equally specific sources tie', async () => {
    const root = await repo(['src/a.ts']);
    const p = project({ sys, api, one: comp('one', 'src/*.ts'), two: comp('two', 'src/a.ts') });
    // 'src/*.ts' (8) vs 'src/a.ts' (8): same length
    const { owner, problems } = await claimFiles(root, p);
    expect(problems.map((x) => x.code)).toEqual(['E015']);
    expect(owner.size).toBe(0);
  });
});

describe('repoRootOf', () => {
  it('finds the ancestor with .git, else the parent', async () => {
    const root = await repo(['.git/HEAD', 'architecture/zark.yaml']);
    expect(repoRootOf(join(root, 'architecture'))).toBe(root);
    const bare = await repo(['architecture/zark.yaml']);
    expect(repoRootOf(join(bare, 'architecture'))).toBe(bare);
  });
});
