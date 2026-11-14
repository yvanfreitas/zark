import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  applyOps,
  buildProject,
  diffProjects,
  errorsOf,
  fileKind,
  formatText,
  planImport,
  readTexts,
  toIcePanelYaml,
  toStructurizr,
  validate,
  type Project,
} from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../examples/ai-chat/architecture', import.meta.url));
const fixture = (name: string) => readFile(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
const texts = await readTexts(EXAMPLE);
const example = buildProject(EXAMPLE, texts);
const empty = () => buildProject(EXAMPLE, new Map([['zark.yaml', texts.get('zark.yaml')!]]));

async function importInto(project: Project, text: string, format?: string) {
  const plan = planImport(text, format, project);
  const result = await applyOps(project, plan.ops);
  expect(result.ok, `${result.error} ${result.newErrors.map((e) => `${e.code} ${e.message}`).join('; ')}`).toBe(true);
  for (const [path, t] of result.files) if (t) expect(formatText(fileKind(path)!, t), path).toBe(t);
  return { ...result, warnings: plan.warnings, format: plan.format };
}

const modelChanges = (a: Project, b: Project) => diffProjects(a, b).filter((c) => c.type.startsWith('entity.') || c.type.startsWith('connection.'));

describe('Structurizr', () => {
  it('round trip of the appendix keeps the model and the drawing positions', async () => {
    const json = JSON.stringify(toStructurizr(example), null, 2);
    const r = await importInto(empty(), json, 'structurizr');
    expect(modelChanges(example, r.project)).toEqual([]);
    for (const [id, { drawing }] of example.drawings) {
      const back = r.project.drawings.get(id)?.drawing;
      expect(back?.scope ?? null, id).toBe(drawing.scope ?? null);
      // Structurizr views carry positions only; explicit sizes are not part of the format.
      const xy = (n: Record<string, { x: number; y: number }> | undefined) => Object.fromEntries(Object.entries(n ?? {}).map(([k, v]) => [k, { x: v.x, y: v.y }]));
      expect(xy(back?.nodes), id).toEqual(xy(drawing.nodes));
      expect(Object.keys(back?.edges ?? {}).sort(), id).toEqual(Object.keys(drawing.edges ?? {}).sort());
    }
    expect(errorsOf(validate(r.project))).toEqual([]);
  });

  it('imports a hand-written workspace', async () => {
    const r = await importInto(empty(), await fixture('structurizr-bank.json'));
    const p = r.project;
    expect(r.format).toBe('structurizr');
    const e = (id: string) => p.entities.get(id)?.entity;
    expect(e('personal-banking-customer')).toMatchObject({ kind: 'actor', external: true, caption: 'A customer of the bank.', tags: ['customer'] });
    expect(e('mainframe-banking-system')).toMatchObject({ kind: 'system', external: true, tags: ['existing-system'] });
    expect(e('web-application')).toMatchObject({ kind: 'app', parent: 'internet-banking-system', technologies: ['java-and-spring-mvc'] });
    expect(e('database')).toMatchObject({ kind: 'store', parent: 'internet-banking-system', technologies: ['oracle'] });
    expect(e('sign-in-controller')).toMatchObject({ kind: 'component', parent: 'web-application' });
    expect(p.catalog.technologies?.find((t) => t.id === 'jdbc')?.name).toBe('JDBC');
    // The implied relationship (linkedRelationshipId) is not duplicated.
    expect([...p.connections.keys()].filter((k) => k.startsWith('mainframe-banking-system.'))).toEqual([]);
    const ctx = p.drawings.get('systemcontext')!.drawing;
    expect(ctx.name).toBe('System Context');
    expect(ctx.nodes!['mainframe-banking-system']).toEqual({ x: 552, y: 352 });
    expect(ctx.edges!['internet-banking-system.gets-account-information-from']).toEqual({ shape: 'step', points: [[448, 304]], labelAt: 0.3 });
    const containers = p.drawings.get('containers')!.drawing;
    expect(containers.scope).toBe('internet-banking-system');
    expect(Object.keys(containers.edges ?? {}).sort()).toEqual(['personal-banking-customer.visits', 'web-application.reads-from-and-writes-to']);
    expect(Object.values(containers.nodes!).every((n) => n.x % 8 === 0 && n.y % 8 === 0)).toBe(true);
    expect(r.warnings.join('\n')).toMatch(/dynamicViews/);
  });
});

describe('IcePanel', () => {
  it('round trip of the appendix keeps the model', async () => {
    const yamlText = toIcePanelYaml(example);
    expect(yamlText.startsWith('# yaml-language-server: $schema=https://api.icepanel.io/v1/schemas/LandscapeImportData')).toBe(true);
    const r = await importInto(empty(), yamlText, 'icepanel-yaml');
    expect(modelChanges(example, r.project)).toEqual([]);
    const drawing = r.project.drawings.get('icepanel')!.drawing;
    expect(Object.keys(drawing.nodes!).sort()).toEqual([...example.entities.values()].filter((x) => !x.entity.parent).map((x) => x.entity.id).sort());
    expect(errorsOf(validate(r.project))).toEqual([]);
  });

  it('export matches the LandscapeImportData shape', () => {
    const data = parse(toIcePanelYaml(example));
    expect(data.modelObjects.find((o: { id: string }) => o.id === 'websocket-api')).toMatchObject({ type: 'app', parentId: 'platform', name: 'WebSocket API' });
    expect(data.modelConnections.find((c: { id: string }) => c.id === 'bot-orchestrator.complete')).toMatchObject({
      originId: 'bot-orchestrator',
      targetId: 'llm-provider',
      name: 'Generates the answer',
      direction: 'bidirectional',
    });
    expect(data.tags[0]).toMatchObject({ id: 'messaging', name: 'Messaging', color: 'grey', groupId: 'zark' });
  });

  it('imports a hand-written landscape: domains and groups dropped with warnings, hierarchy kept', async () => {
    const r = await importInto(empty(), await fixture('icepanel-landscape.yaml'));
    const p = r.project;
    const e = (id: string) => p.entities.get(id)?.entity;
    expect(r.format).toBe('icepanel');
    expect(e('obj-cliente')).toMatchObject({ kind: 'actor', name: 'Cliente' });
    expect(e('obj-cliente')?.parent).toBeUndefined();
    expect(e('obj-loja')).toMatchObject({ kind: 'system', caption: 'Vitrine e checkout', tags: ['pagamentos'], links: [{ label: 'Repositório', url: 'https://example.com/loja' }] });
    expect(e('obj-api')).toMatchObject({ kind: 'app', parent: 'obj-loja', status: 'future', technologies: ['nodejs'] });
    expect(e('obj-gateway')).toMatchObject({ external: true });
    expect(p.connections.get('obj-api.autoriza-pagamento')?.conn).toMatchObject({ direction: 'bidirectional', tags: ['pagamentos'] });
    expect(p.catalog.tags?.find((t) => t.id === 'pagamentos')).toMatchObject({ name: 'Pagamentos', color: 'green' });
    const w = r.warnings.join('\n');
    expect(w).toMatch(/IcePanel domains/);
    expect(w).toMatch(/IcePanel groups/);
    expect(w).toMatch(/Laço/);
    const d = p.drawings.get('icepanel')!.drawing;
    expect(Object.keys(d.nodes!).sort()).toEqual(['obj-cliente', 'obj-gateway', 'obj-loja']);
    expect(validate(p).map((x) => x.code)).not.toContain('W010');
  });
});

describe('import into an existing project', () => {
  it('suffixes colliding ids and keeps the existing catalog', async () => {
    const r = await importInto(example, toIcePanelYaml(example), 'icepanel');
    expect(r.project.entities.has('platform-2')).toBe(true);
    expect(r.project.entities.get('websocket-api-2')?.entity.parent).toBe('platform-2');
    expect(r.project.catalog.technologies?.find((t) => t.id === 'lambda')?.name).toBe('AWS Lambda');
    expect(r.project.drawings.has('icepanel')).toBe(true);
  });

  it('rejects unknown files with a readable message', () => {
    expect(() => planImport('{"hello": 1}', 'auto')).toThrow(/Unrecognized format/);
    expect(() => planImport('modelObjects: []', 'structurizr')).toThrow(/Structurizr/);
    expect(() => planImport('{ broken', 'auto')).toThrow(/Invalid file/);
  });
});
