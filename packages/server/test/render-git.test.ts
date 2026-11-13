import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { buildProject, diffProjects, readTexts, type Project } from '@zark/core';
import {
  discard,
  embedHash,
  projectAtRef,
  prBody,
  prPreview,
  prTitle,
  ProjectStore,
  readHash,
  renderedProblems,
  renderHash,
  status,
} from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../examples/ecommerce/architecture', import.meta.url));

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function tinyPng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.from([0, 255, 255, 255]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

let texts: Map<string, string>;
const project = (edit?: (t: Map<string, string>) => void): Project => {
  const t = new Map(texts);
  edit?.(t);
  return buildProject(EXAMPLE, t);
};

beforeAll(async () => {
  texts = await readTexts(EXAMPLE);
});

describe('render hash', () => {
  it('embeds and reads back the hash in a valid PNG', () => {
    const png = embedHash(tinyPng(), 'abc123');
    expect(readHash(png)).toBe('abc123');
    expect(png.subarray(0, 8)).toEqual(tinyPng().subarray(0, 8));
    expect(readHash(tinyPng())).toBeUndefined();
  });

  it('changes only when referenced inputs change', () => {
    const h = renderHash(project(), { drawing: 'vtex' });
    const renamed = renderHash(project((t) => t.set('entities/gateway.yaml', t.get('entities/gateway.yaml')!.replace('name: Gateway', 'name: Gateway 2'))), { drawing: 'vtex' });
    expect(renamed).not.toBe(h);
    // Transportadora is not in the vtex drawing.
    const unrelated = renderHash(project((t) => t.set('entities/transportadora.yaml', t.get('entities/transportadora.yaml')!.replace('name: Transportadora', 'name: Outra'))), { drawing: 'vtex' });
    expect(unrelated).toBe(h);
  });

  it('flags a stale PNG in rendered/ as W030', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zark-render-'));
    try {
      const dir = join(root, 'architecture');
      await cp(EXAMPLE, dir, { recursive: true });
      await mkdir(join(dir, 'rendered'));
      const p = buildProject(dir, await readTexts(dir));
      await writeFile(join(dir, 'rendered/contexto.png'), embedHash(tinyPng(), 'wrong'));
      await writeFile(join(dir, 'rendered/vtex.png'), embedHash(tinyPng(), renderHash(p, { drawing: 'vtex' })));
      const problems = await renderedProblems(p);
      expect(problems.map((x) => `${x.code} ${x.file}`)).toEqual(['W030 rendered/contexto.png']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('PR text', () => {
  it('uses the change text as title for a single change', () => {
    const before = project();
    const after = project((t) => t.set('entities/deco.yaml', t.get('entities/deco.yaml')!.replace('caption: Front', 'caption: Frontend')));
    const changes = diffProjects(before, after);
    expect(prTitle(changes, after, before)).toBe('deco: caption alterado');
  });

  it('summarizes several changes', () => {
    const before = project();
    const after = project((t) => {
      t.set('entities/novo.yaml', 'id: novo\nname: Novo\nkind: system\nconnections:\n  - id: a\n    to: deco\n    label: A\n  - id: b\n    to: linx\n    label: B\n');
      t.set('drawings/contexto.yaml', t.get('drawings/contexto.yaml')!.replace('stone: { x: 360, y: -272 }', 'stone: { x: 360, y: -280 }'));
    });
    const title = prTitle(diffProjects(before, after), after, before);
    expect(title).toBe('Arquitetura: adiciona Novo e 2 conexões, ajusta Contexto');
  });

  it('builds the body with summary, drawings table and validation line', () => {
    const before = project();
    const after = project((t) => t.set('entities/deco.yaml', t.get('entities/deco.yaml')!.replace('caption: Front', 'caption: Frontend')));
    const body = prBody({
      changes: diffProjects(before, after),
      images: [{ drawing: 'contexto', name: 'Contexto', path: 'rendered/contexto.png', hasBefore: true }],
      imageUrl: (p, side) => `https://x/${side}/${p}`,
      flows: [],
      problems: [
        { code: 'W003', severity: 'warning', file: 'a', message: 'x' },
        { code: 'W003', severity: 'warning', file: 'b', message: 'y' },
      ],
    });
    expect(body).toContain('## Resumo\n- deco: caption alterado');
    expect(body).toContain('| Antes | Depois |');
    expect(body).toContain('![antes](https://x/before/rendered/contexto.png)');
    expect(body).toContain('0 erros, 2 avisos (W003 x2)');
  });
});

describe('git integration', () => {
  let root: string;
  let dir: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'zark-git-'));
    dir = join(root, 'architecture');
    await cp(EXAMPLE, dir, { recursive: true });
    git('init', '-q', '-b', 'main');
    git('config', 'core.autocrlf', 'false');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reports changes, loads HEAD, discards, and blocks PR without remote', async () => {
    const store = await new ProjectStore(dir).load();
    const r = await store.apply([{ op: 'entity.update', id: 'deco', set: { caption: 'Frontend' } }], 'ui');
    expect(r.ok).toBe(true);

    const st = await status(dir, 'main', false);
    expect(st.isRepo).toBe(true);
    expect(st.branch).toBe('main');
    expect(st.changed.map((c) => c.path)).toEqual(['entities/deco.yaml']);

    const head = await projectAtRef(dir, 'HEAD');
    expect(head.entities.size).toBe(13);
    expect(head.entities.get('deco')!.entity.caption).toBe('Front');

    const preview = await prPreview(dir, store.project, store.problems);
    expect(preview.ok).toBe(false);
    expect(preview.blockers.join('\n')).toMatch(/remoto/);
    expect(preview.changes.map((c) => c.text)).toEqual(['deco: caption alterado']);

    await discard(dir, ['entities/deco.yaml']);
    expect(await readFile(join(dir, 'entities/deco.yaml'), 'utf8')).toBe(await readFile(join(EXAMPLE, 'entities/deco.yaml'), 'utf8'));
    expect((await status(dir, 'main', false)).changed).toEqual([]);
  });
});
