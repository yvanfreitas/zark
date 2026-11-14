// IcePanel conformance: Zark's export and the fixtures are checked against IcePanel's official
// LandscapeImportData JSON Schema (vendored in fixtures/icepanel-schema, see its README) and against the
// object hierarchy the schema documents in `parentId` (which JSON Schema itself cannot express).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv, type ErrorObject } from 'ajv';
import addFormatsModule from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { applyOps, buildProject, errorsOf, planImport, readTexts, toIcePanelYaml, validate } from '../src/index.js';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const SCHEMA_DIR = here('./fixtures/icepanel-schema/');
const ROOT_ID = 'https://api.icepanel.io/v1/schemas/LandscapeImportData';

// ajv-formats is CommonJS; NodeNext types see the namespace, runtime gives the function.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ?? addFormatsModule) as (ajv: Ajv) => Ajv;
const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addKeyword('example'); // OpenAPI annotation used by IcePanel's schemas; `nullable` is built into Ajv.
addFormats(ajv);
for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json'))) ajv.addSchema(JSON.parse(readFileSync(SCHEMA_DIR + file, 'utf8')));
const validateLandscape = ajv.getSchema(ROOT_ID)!;

const schemaErrors = (data: unknown) => {
  validateLandscape(data);
  return (validateLandscape.errors ?? []).map((e: ErrorObject) => `${e.instancePath} ${e.keyword} ${e.message}`);
};

type IceObject = { id: string; type: string; parentId?: string | null };
/** Hierarchy from the schema's `parentId` description. */
const ALLOWED_PARENT: Record<string, (string | null)[]> = {
  domain: [null],
  actor: ['domain'],
  system: ['domain'],
  group: ['domain', 'group'],
  app: ['system'],
  store: ['system'],
  component: ['app', 'store'],
};
function hierarchyErrors(data: { modelObjects?: IceObject[]; modelConnections?: { id: string; originId: string; targetId: string }[] }) {
  const byId = new Map((data.modelObjects ?? []).map((o) => [o.id, o]));
  const out: string[] = [];
  for (const o of data.modelObjects ?? []) {
    const parentType = o.parentId ? byId.get(o.parentId)?.type ?? `missing:${o.parentId}` : null;
    if (!(ALLOWED_PARENT[o.type] ?? []).includes(parentType)) out.push(`${o.id}: ${o.type} under ${parentType ?? 'root'}`);
  }
  for (const c of data.modelConnections ?? []) {
    if (!byId.has(c.originId) || !byId.has(c.targetId)) out.push(`${c.id}: dangling endpoint`);
  }
  return out;
}

const EXAMPLE = here('../../../examples/ai-chat/architecture');
const texts = await readTexts(EXAMPLE);
const example = buildProject(EXAMPLE, texts);
const empty = () => buildProject(EXAMPLE, new Map([['zark.yaml', texts.get('zark.yaml')!]]));

async function importText(text: string) {
  const plan = planImport(text, 'icepanel', empty());
  const result = await applyOps(empty(), plan.ops);
  expect(result.ok, `${result.error} ${result.newErrors.map((e) => `${e.code} ${e.message}`).join('; ')}`).toBe(true);
  expect(errorsOf(validate(result.project))).toEqual([]);
  return { project: result.project, warnings: plan.warnings };
}

describe('IcePanel LandscapeImportData conformance', () => {
  it('the schema set compiles (all $refs resolve offline)', () => {
    expect(typeof validateLandscape).toBe('function');
  });

  it('Zark export of the appendix validates and follows the IcePanel hierarchy', () => {
    const data = parse(toIcePanelYaml(example));
    expect(schemaErrors(data)).toEqual([]);
    expect(hierarchyErrors(data)).toEqual([]);
    // Root actor/system sit under one domain named after the project.
    const domain = data.modelObjects.find((o: IceObject) => o.type === 'domain');
    expect(domain).toMatchObject({ id: 'domain-papo', name: 'Papo' });
    expect(data.modelObjects.find((o: IceObject) => o.id === 'user').parentId).toBe('domain-papo');
    // No Zark catalog ids where IcePanel expects its own catalog/organization ids.
    const all = [...data.modelObjects, ...data.modelConnections];
    expect(all.filter((o) => 'technologyIds' in o || 'teamIds' in o)).toEqual([]);
    expect(data.modelObjects.find((o: IceObject) => o.id === 'platform').labels).toEqual({ 'zark:owner': 'platform-team=Platform team' });
    expect(data.modelObjects.find((o: IceObject) => o.id === 'history').labels).toEqual({ 'zark:technologies': 'dynamodb=Amazon DynamoDB' });
  });

  it('round trip through IcePanel keeps catalog names via labels', async () => {
    const { project } = await importText(toIcePanelYaml(example));
    expect(project.entities.size).toBe(example.entities.size);
    expect(project.entities.get('user')?.entity.parent).toBeUndefined();
    expect(project.entities.get('history')?.entity.technologies).toEqual(['dynamodb']);
    expect(project.catalog.technologies?.find((t) => t.id === 'dynamodb')?.name).toBe('Amazon DynamoDB');
    expect(project.catalog.technologies?.find((t) => t.id === 'rest')?.name).toBe('REST');
    expect(project.entities.get('platform')?.entity.owner).toBe('platform-team');
    expect(project.catalog.teams?.find((t) => t.id === 'platform-team')?.name).toBe('Platform team');
  });

  it('the hand-written fixture validates and follows the hierarchy', () => {
    const data = parse(readFileSync(here('./fixtures/icepanel-landscape.yaml'), 'utf8'));
    expect(schemaErrors(data)).toEqual([]);
    expect(hierarchyErrors(data)).toEqual([]);
  });

  describe("IcePanel's own guide example", () => {
    const guide = JSON.parse(readFileSync(here('./fixtures/icepanel-guide-example.json'), 'utf8'));
    /** The example projected onto the schema: database -> store, a TagGroupIcon enum value. */
    const projected = {
      ...guide,
      modelObjects: guide.modelObjects.map((o: IceObject) => (o.type === 'database' ? { ...o, type: 'store' } : o)),
      tagGroups: guide.tagGroups.map((g: { icon: string }) => ({ ...g, icon: 'users' })),
    };

    it('verbatim, deviates from the schema in exactly the known places', () => {
      expect(schemaErrors(guide).sort()).toEqual(
        [
          '/modelObjects/8/type enum must be equal to one of the allowed values',
          '/modelObjects/9/type enum must be equal to one of the allowed values',
          '/tagGroups/0/icon enum must be equal to one of the allowed values',
        ].sort(),
      );
    });

    it('projected, validates, follows the hierarchy and imports with no errors', async () => {
      expect(schemaErrors(projected)).toEqual([]);
      expect(hierarchyErrors(projected)).toEqual([]);
      const { project, warnings } = await importText(JSON.stringify(projected));
      // 14 objects minus the domain; all 10 connections.
      expect(project.entities.size).toBe(13);
      expect(project.connections.size).toBe(10);
      expect(project.entities.get('container-db')?.entity).toMatchObject({ kind: 'store', parent: 'system-storefront' });
      expect(project.entities.get('component-auth-service')?.entity.parent).toBe('container-api');
      expect(project.entities.get('person-customer')?.entity).toMatchObject({ kind: 'actor', tags: ['external'] });
      expect(warnings.join('\n')).toMatch(/IcePanel domains/);
    });

    it('verbatim, still imports: "database" is read as store', async () => {
      const { project } = await importText(JSON.stringify(guide));
      expect(project.entities.size).toBe(13);
      expect(project.connections.size).toBe(10);
      expect(project.entities.get('container-cache')?.entity.kind).toBe('store');
    });
  });
});
