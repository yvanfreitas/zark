import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyOps,
  buildProject,
  formatText,
  planImport,
  toIcePanelYaml,
  toStructurizr,
  hasIcon,
  iconSets,
  iconSvg,
  sanitizeSvg,
  searchIcons,
  STATIC_SUGGESTIONS,
  suggestIcons,
  usedIcons,
  validate,
  type Project,
} from '../src/index.js';

const CONFIG = 'schema: 1\nname: Teste\n';

async function projectWith(files: Record<string, string>, pack?: Record<string, string>): Promise<Project> {
  const dir = await mkdtemp(join(tmpdir(), 'zark-icons-'));
  if (pack) {
    await mkdir(join(dir, 'icons', 'aws'), { recursive: true });
    for (const [name, svg] of Object.entries(pack)) await writeFile(join(dir, 'icons', 'aws', name), svg);
  }
  return buildProject(dir, new Map(Object.entries({ 'zark.yaml': CONFIG, ...files })));
}

const box = (extra = '') => `id: fila\nname: Fila de entrada\nkind: system\n${extra}`;

describe('icon registry', () => {
  it('bundles Lucide and Simple Icons, with no AWS/Azure brand icons', async () => {
    const p = await projectWith({});
    const sets = iconSets(p);
    expect(sets.find((s) => s.id === 'lucide')!.count).toBeGreaterThan(1500);
    expect(sets.find((s) => s.id === 'si')!.count).toBeGreaterThan(3000);
    expect(hasIcon(p, 'lucide:database')).toBe(true);
    expect(hasIcon(p, 'si:kubernetes')).toBe(true);
    expect(hasIcon(p, 'si:amazonsqs')).toBe(false);
  });

  it('searches by name, title and keyword', async () => {
    const p = await projectWith({});
    expect(searchIcons(p, 'database')[0].id).toBe('lucide:database');
    expect(searchIcons(p, 'Google Cloud Storage').map((i) => i.id)).toContain('si:googlecloudstorage');
    expect(searchIcons(p, 'python', { set: 'si' })[0].id).toBe('si:python');
  });

  it('every icon the suggester can emit exists', async () => {
    const p = await projectWith({});
    expect(STATIC_SUGGESTIONS.filter((id) => !hasIcon(p, id))).toEqual([]);
  });

  it('sanitizes SVG: no scripts, handlers or external links', () => {
    const svg = sanitizeSvg(
      '<?xml version="1.0"?><svg width="48" height="48" onload="x()"><script>alert(1)</script><a href="https://evil"><path d="M0 0" onclick="y()"/></a><use href="#ok"/><foreignObject><div/></foreignObject></svg>',
    )!;
    expect(svg).toContain('viewBox="0 0 48 48"');
    expect(svg).not.toMatch(/script|onload|onclick|evil|foreignObject/);
    expect(svg).toContain('href="#ok"');
  });

  it('serves brand colour fills and follows the theme for near-black marks', async () => {
    const p = await projectWith({});
    expect(iconSvg(p, 'si:python')).toMatch(/fill="#[0-9A-Fa-f]{6}"/);
    expect(iconSvg(p, 'si:github')).toContain('fill="currentColor"');
    expect(iconSvg(p, 'lucide:database')).toContain('stroke="currentColor"');
  });

  it('loads user packs declared in zark.yaml', async () => {
    const p = await projectWith(
      { 'zark.yaml': `${CONFIG}icons:\n  packs:\n    - id: aws\n      dir: icons/aws\n` },
      { 'SQS.svg': '<svg viewBox="0 0 64 64"><rect width="64" height="64"/></svg>' },
    );
    expect(hasIcon(p, 'aws:sqs')).toBe(true);
    expect(iconSets(p).map((s) => s.id)).toEqual(['lucide', 'si', 'aws']);
    expect(searchIcons(p, 'sqs')[0].id).toBe('aws:sqs');
    expect(iconSvg(p, 'aws:sqs')).toContain('viewBox="0 0 64 64"');
  });
});

describe('entity icon field', () => {
  it('validates the reference and warns W040 for unknown icons', async () => {
    const ok = await projectWith({ 'entities/fila.yaml': box('icon: lucide:list-ordered\n') });
    expect(validate(ok).map((x) => x.code)).not.toContain('W040');
    const bad = await projectWith({ 'entities/fila.yaml': box('icon: lucide:nao-existe\n') });
    expect(validate(bad).find((x) => x.code === 'W040')?.message).toMatch(/lucide:nao-existe/);
    const set = await projectWith({ 'entities/fila.yaml': box('icon: aws:sqs\n') });
    expect(validate(set).find((x) => x.code === 'W040')?.message).toMatch(/Sets: lucide, si/);
    const malformed = await projectWith({ 'entities/fila.yaml': box('icon: database\n') });
    expect(validate(malformed).map((x) => x.code)).toContain('E001');
  });

  it('checks technology icons given as set:name, and ships used icons', async () => {
    const p = await projectWith({
      'catalog.yaml': 'technologies:\n  - id: py\n    name: Python\n    icon: si:python\n  - id: x\n    name: X\n    icon: si:nao-existe\n',
      'entities/fila.yaml': box('icon: lucide:list-ordered\n'),
    });
    expect(validate(p).filter((x) => x.code === 'W040').map((x) => x.ref)).toEqual(['x']);
    expect(Object.keys(usedIcons(p)).sort()).toEqual(['lucide:list-ordered', 'si:python']);
  });

  it('keeps icon in canonical position, right after caption', () => {
    expect(formatText('entity', 'id: a\nname: A\nicon: lucide:box\nkind: system\ncaption: c\n')).toContain('caption: c\nicon: lucide:box\n');
  });
});

describe('icon suggestions', () => {
  const all = new Set([...STATIC_SUGGESTIONS, 'si:python', 'si:googlecloudstorage', 'aws:sqs', 'aws:lambda']);
  const has = (id: string) => all.has(id);

  it('puts official pack icons of the technology first, then brands', () => {
    const r = suggestIcons({ name: 'Fila de entrada', kind: 'app', technologies: [{ id: 'sqs', name: 'Amazon SQS' }] }, has, ['aws']);
    expect(r[0]).toBe('aws:sqs');
    expect(r).toContain('lucide:list-ordered');
    expect(r[r.length - 1]).toBe('lucide:app-window');
  });

  it('uses brand icons for languages and cloud products', () => {
    expect(suggestIcons({ name: 'Worker', kind: 'app', technologies: [{ id: 'python', name: 'Python' }] }, has)[0]).toBe('si:python');
    expect(suggestIcons({ name: 'Anexos', kind: 'store', technologies: [{ id: 'gcs', name: 'Google Cloud Storage' }] }, has)[0]).toBe('si:googlecloudstorage');
  });

  it('reads keywords in Portuguese and English, then falls back to kind', () => {
    expect(suggestIcons({ name: 'Bot de atendimento', caption: 'Responde com LLM', kind: 'app', technologies: [] }, has)).toEqual(
      expect.arrayContaining(['lucide:bot', 'lucide:brain']),
    );
    expect(suggestIcons({ name: 'Usuários', kind: 'actor', technologies: [] }, has).slice(0, 2)).toEqual(['lucide:users', 'lucide:user']);
    expect(suggestIcons({ name: 'Qualquer', kind: 'store', technologies: [] }, has)).toEqual(['lucide:database']);
  });

  it('honours an explicit technology icon and filters what does not exist', () => {
    expect(suggestIcons({ name: 'X', kind: 'app', technologies: [{ id: 'l', name: 'Lambda', icon: 'aws:lambda' }] }, has, ['aws'])[0]).toBe('aws:lambda');
    expect(suggestIcons({ name: 'X', kind: 'app', technologies: [{ id: 'zzz', name: 'Zzz' }] }, has)).toEqual(['lucide:app-window']);
  });
});

describe('icons in interop', () => {
  it('round-trips the entity icon through Structurizr and IcePanel', async () => {
    const src = await projectWith({ 'entities/fila.yaml': box('icon: lucide:list-ordered\n') });
    for (const text of [JSON.stringify(toStructurizr(src)), toIcePanelYaml(src)]) {
      const empty = buildProject(src.dir, new Map([['zark.yaml', CONFIG]]));
      const plan = planImport(text, undefined, empty);
      const r = await applyOps(empty, plan.ops);
      expect(r.ok, r.error).toBe(true);
      expect([...r.project.entities.values()].map((e) => e.entity.icon)).toContain('lucide:list-ordered');
    }
  });
});
