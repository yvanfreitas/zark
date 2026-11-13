import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LineCounter, isAlias, parseDocument, visit, type Document } from 'yaml';
import type { z } from 'zod';
import {
  Catalog,
  Config,
  Drawing,
  Entity,
  Flow,
  type Connection,
  type FlowItem,
  type Step,
} from './schema.js';

export type FileKind = 'config' | 'catalog' | 'entity' | 'drawing' | 'flow';

export interface SourceFile {
  /** Posix path relative to the architecture dir, e.g. `entities/vtex.yaml`. */
  path: string;
  kind: FileKind;
  /** Id implied by the file name (`entities/vtex.yaml` -> `vtex`). */
  nameId: string;
  text: string;
  hash: string;
  doc: Document;
  lc: LineCounter;
  /** Parsed and schema-valid data; undefined when the file is invalid (E001). */
  data?: any;
  error?: { message: string; line?: number };
}

export interface ResolvedConnection {
  ref: string;
  from: string;
  conn: Connection;
  file: string;
}

export interface Project {
  dir: string;
  files: Map<string, SourceFile>;
  config: Required<Pick<Config, 'schema' | 'name' | 'grid'>> & Config & {
    render: { commit: 'pr' | 'always' | 'never'; scale: number; theme: 'light' | 'dark' };
    git: { baseBranch: string; branchPrefix: string };
  };
  catalog: Catalog;
  entities: Map<string, { entity: Entity; file: string }>;
  connections: Map<string, ResolvedConnection>;
  drawings: Map<string, { drawing: Drawing; file: string }>;
  flows: Map<string, { flow: Flow; file: string }>;
  /** Duplicate definitions found while indexing (E003). */
  duplicates: { kind: string; id: string; file: string }[];
  children: Map<string, string[]>;
  connectionsTo: Map<string, string[]>;
}

const DIRS: Record<string, FileKind> = { entities: 'entity', drawings: 'drawing', flows: 'flow' };
const SCHEMAS: Record<FileKind, z.ZodType> = { config: Config, catalog: Catalog, entity: Entity, drawing: Drawing, flow: Flow };

export const hashText = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

export function fileKind(path: string): FileKind | undefined {
  if (path === 'zark.yaml') return 'config';
  if (path === 'catalog.yaml') return 'catalog';
  const m = /^(entities|drawings|flows)\/[^/]+\.yaml$/.exec(path);
  return m ? DIRS[m[1]] : undefined;
}

export async function readTexts(dir: string): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  for (const name of ['zark.yaml', 'catalog.yaml']) {
    const text = await readFile(join(dir, name), 'utf8').catch(() => undefined);
    if (text !== undefined) texts.set(name, text);
  }
  for (const sub of Object.keys(DIRS)) {
    const names = await readdir(join(dir, sub)).catch(() => [] as string[]);
    for (const name of names.filter((n) => n.endsWith('.yaml')).sort()) {
      texts.set(`${sub}/${name}`, await readFile(join(dir, sub, name), 'utf8'));
    }
  }
  return texts;
}

export function parseFile(path: string, text: string): SourceFile {
  const kind = fileKind(path);
  if (!kind) throw new Error(`Arquivo fora da estrutura do Zark: ${path}`);
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc, keepSourceTokens: false, uniqueKeys: true });
  const nameId = path.split('/').pop()!.replace(/\.yaml$/, '');
  const file: SourceFile = { path, kind, nameId, text, hash: hashText(text), doc, lc };
  const yamlError = doc.errors[0];
  if (yamlError) {
    file.error = { message: yamlError.message.split('\n')[0], line: yamlError.linePos?.[0].line };
    return file;
  }
  if (hasAlias(doc)) {
    file.error = { message: 'anchors e aliases não são permitidos' };
    return file;
  }
  const raw = doc.toJS() ?? {};
  const parsed = SCHEMAS[kind].safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length ? issue.path.join('.') + ': ' : '';
    file.error = { message: `${where}${issue.message}`, line: lineOf(file, issue.path as (string | number)[]) };
    return file;
  }
  file.data = parsed.data;
  return file;
}

function hasAlias(doc: Document): boolean {
  let found = false;
  visit(doc, {
    Node(_, node) {
      if (isAlias(node) || (node as { anchor?: string }).anchor) {
        found = true;
        return visit.BREAK;
      }
    },
  });
  return found;
}

/** 1-based line of the node at `path`, falling back to the nearest existing ancestor. */
export function lineOf(file: SourceFile, path: (string | number)[]): number | undefined {
  for (let n = path.length; n >= 0; n--) {
    const node: any = n === 0 ? file.doc.contents : file.doc.getIn(path.slice(0, n), true);
    if (node?.range) return file.lc.linePos(node.range[0]).line;
  }
  return undefined;
}

export function buildProject(dir: string, texts: Map<string, string>): Project {
  const files = new Map<string, SourceFile>();
  for (const [path, text] of texts) if (fileKind(path)) files.set(path, parseFile(path, text));

  const cfg: Config = files.get('zark.yaml')?.data ?? { schema: 1, name: 'Arquitetura' };
  const project: Project = {
    dir,
    files,
    config: {
      ...cfg,
      grid: cfg.grid ?? 8,
      render: { commit: cfg.render?.commit ?? 'pr', scale: cfg.render?.scale ?? 2, theme: cfg.render?.theme ?? 'light' },
      git: { baseBranch: cfg.git?.baseBranch ?? 'main', branchPrefix: cfg.git?.branchPrefix ?? 'zark/' },
    },
    catalog: files.get('catalog.yaml')?.data ?? {},
    entities: new Map(),
    connections: new Map(),
    drawings: new Map(),
    flows: new Map(),
    duplicates: [],
    children: new Map(),
    connectionsTo: new Map(),
  };

  for (const file of files.values()) {
    if (!file.data) continue;
    const id: string = file.data.id;
    const target = file.kind === 'entity' ? project.entities : file.kind === 'drawing' ? project.drawings : file.kind === 'flow' ? project.flows : undefined;
    if (!target) continue;
    if (target.has(id)) {
      project.duplicates.push({ kind: file.kind, id, file: file.path });
      continue;
    }
    target.set(id, { [file.kind]: file.data, file: file.path } as any);
  }

  for (const [id, { entity, file }] of project.entities) {
    const parent = entity.parent ?? null;
    if (parent) push(project.children, parent, id);
    for (const conn of entity.connections ?? []) {
      const ref = `${id}.${conn.id}`;
      if (project.connections.has(ref)) {
        project.duplicates.push({ kind: 'connection', id: ref, file });
        continue;
      }
      project.connections.set(ref, { ref, from: id, conn, file });
      push(project.connectionsTo, conn.to, ref);
    }
  }
  return project;
}

export async function loadProject(dir: string): Promise<Project> {
  return buildProject(dir, await readTexts(dir));
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Ancestor chain starting at `id` itself. Stops on cycles or missing parents. */
export function ancestors(project: Project, id: string): string[] {
  const chain: string[] = [];
  let current: string | null | undefined = id;
  while (current && !chain.includes(current)) {
    chain.push(current);
    current = project.entities.get(current)?.entity.parent;
  }
  return chain;
}

/** Nearest entity in the chain [id, parent, ...] that is placed in the drawing. */
export function resolveEndpoint(project: Project, drawing: Drawing, id: string): string | undefined {
  return ancestors(project, id).find((a) => drawing.nodes?.[a]);
}

export interface StepVisit {
  step: Step;
  /** Path to the step inside the flow document, for line lookups. */
  path: (string | number)[];
  depth: number;
}

/** Depth-first walk over every step of a flow, including nested branches. */
export function walkSteps(items: FlowItem[] | undefined, visit: (v: StepVisit) => void, path: (string | number)[] = ['steps'], depth = 0) {
  (items ?? []).forEach((item, i) => {
    const here = [...path, i];
    if ('via' in item) visit({ step: item, path: here, depth });
    else if ('parallel' in item) item.parallel.forEach((branch, b) => walkSteps(branch, visit, [...here, 'parallel', b], depth + 1));
    else if ('alternatives' in item) item.alternatives.forEach((alt, a) => walkSteps(alt.steps, visit, [...here, 'alternatives', a, 'steps'], depth + 1));
  });
}

export function allSteps(flow: Flow): Step[] {
  const steps: Step[] = [];
  walkSteps(flow.steps, ({ step }) => steps.push(step));
  return steps;
}
