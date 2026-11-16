import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectStore } from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../examples/ai-chat/architecture', import.meta.url));
const graph = (component: string) => `component: ${component}
modules: []
edges: []
unresolved:
  calls: 0
  external: 0
  unowned: 0
`;

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'zark-codegraphs-'));
  await cp(EXAMPLE, root, { recursive: true });
  await mkdir(join(root, 'code'), { recursive: true });
  await writeFile(join(root, 'code', 'zeta.yaml'), graph('zeta'));
  await writeFile(join(root, 'code', 'alpha.yaml'), graph('alpha'));
});

afterAll(() => rm(root, { recursive: true, force: true }));

describe('snapshot', () => {
  it('includes code graphs sorted by component', async () => {
    const store = await new ProjectStore(root).load();
    const snap = store.snapshot();
    expect(snap.codeGraphs.map((g) => g.component)).toEqual(['alpha', 'zeta']);
    expect(snap.codeGraphs[0]).toMatchObject({ modules: [], edges: [], unresolved: { calls: 0, external: 0, unowned: 0 } });
    await store.close();
  });
});
