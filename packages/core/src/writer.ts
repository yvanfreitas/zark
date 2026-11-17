import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Document, isMap, isScalar, isSeq, parseDocument, type Node as YNode, type YAMLMap } from 'yaml';
import { KEY_ORDER, SCHEMA_URL } from './schema.js';
import type { FileKind } from './project.js';

/**
 * Shape types describe where a YAML node sits in the schema, so new or
 * reformatted nodes get canonical key order and flow/block style.
 */
type Shape =
  | keyof typeof KEY_ORDER
  | 'ids' | 'links' | 'connections' | 'nodeMap' | 'edgeMap' | 'points' | 'groups' | 'notes'
  | 'steps' | 'flowItem' | 'catalogItems' | 'codeModules' | 'codePieces' | 'codeEdges' | 'block' | 'leaf';

const CHILDREN: Partial<Record<Shape, Record<string, Shape>>> = {
  config: { render: 'block', git: 'block', rules: 'block', mcp: 'block', icons: 'block' },
  catalog: { technologies: 'catalogItems', tags: 'catalogItems', teams: 'catalogItems' },
  entity: { technologies: 'ids', tags: 'ids', links: 'links', connections: 'connections' },
  connection: { technologies: 'ids', tags: 'ids' },
  drawing: { nodes: 'nodeMap', edges: 'edgeMap', groups: 'groups', notes: 'notes' },
  edge: { points: 'points' },
  group: { members: 'ids' },
  flow: { steps: 'steps' },
  step: {},
  codeGraph: { modules: 'codeModules', edges: 'codeEdges', unresolved: 'codeUnresolved' },
  codeModule: { pieces: 'codePieces' },
  codePiece: { members: 'ids' },
};
const ITEMS: Partial<Record<Shape, Shape>> = {
  links: 'link', connections: 'connection', groups: 'group', notes: 'note', steps: 'flowItem', catalogItems: 'catalogItem',
  codeModules: 'codeModule', codePieces: 'codePiece', codeEdges: 'codeEdge',
};

const KIND_SHAPE: Record<FileKind, Shape> = { config: 'config', catalog: 'catalog', entity: 'entity', drawing: 'drawing', flow: 'flow', code: 'codeGraph' };
const SCHEMA_NAME: Record<FileKind, Parameters<typeof SCHEMA_URL>[0]> = { config: 'config', catalog: 'catalog', entity: 'entity', drawing: 'drawing', flow: 'flow', code: 'code' };

export const TO_STRING = { indent: 2, indentSeq: true, lineWidth: 0, minContentWidth: 0, flowCollectionPadding: true } as const;

/** Applies canonical order and style to `node`, recursively. */
export function shape(node: unknown, type: Shape): void {
  if (isMap(node)) {
    if (type === 'nodeMap' || type === 'edgeMap') {
      node.items.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
      // Empty stays `nodes: {}` on one line; a block map with no items prints `{}` on its own line.
      node.flow = node.items.length === 0;
      for (const pair of node.items) shape(pair.value, type === 'nodeMap' ? 'node' : 'edge');
      return;
    }
    if (type === 'flowItem') {
      const key = keyOf(node.items[0]);
      if (key === 'parallel') {
        const branches = node.get('parallel', true);
        if (isSeq(branches)) branches.items.forEach((b) => shape(b, 'steps'));
        return;
      }
      if (key === 'alternatives') {
        const alts = node.get('alternatives', true);
        if (isSeq(alts)) alts.items.forEach((alt) => {
          if (isMap(alt)) {
            orderKeys(alt, ['name', 'steps']);
            shape(alt.get('steps', true), 'steps');
          }
        });
        return;
      }
      if (key === 'subflow' || key === 'note') return;
      type = 'step';
    }
    const order = KEY_ORDER[type as string];
    if (order) orderKeys(node, order);
    // Code graphs (spec section 4): one line per edge, per member-less piece and for `unresolved`;
    // also keeps big generated files cheap to write and parse.
    if (type === 'node' || type === 'codeEdge' || type === 'codeUnresolved') node.flow = true;
    else if (type === 'codePiece') node.flow = !node.has('members');
    else if (type === 'edge') node.flow = !node.has('points');
    else node.flow = false;
    const children = CHILDREN[type] ?? {};
    for (const pair of node.items) {
      const child = children[keyOf(pair)];
      if (child) shape(pair.value, child);
    }
    return;
  }
  if (isSeq(node)) {
    if (type === 'ids') node.flow = true;
    else if (type === 'points') {
      node.flow = true;
      node.items.forEach((p) => isSeq(p) && (p.flow = true));
    } else {
      node.flow = false;
      const item = ITEMS[type];
      if (item) node.items.forEach((i) => shape(i, item));
    }
  }
}

function keyOf(pair: { key: unknown }): string {
  return isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
}

function orderKeys(map: YAMLMap, order: string[]) {
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i === -1 ? order.length : i;
  };
  // Stable sort keeps unknown keys in their relative position at the end.
  map.items = map.items
    .map((pair, i) => ({ pair, i }))
    .sort((a, b) => rank(keyOf(a.pair)) - rank(keyOf(b.pair)) || a.i - b.i)
    .map((x) => x.pair);
}

function ensureSchemaComment(doc: Document, kind: FileKind) {
  const line = ` yaml-language-server: $schema=${SCHEMA_URL(SCHEMA_NAME[kind])}`;
  const existing = [doc.commentBefore, (doc.contents as YNode | null)?.commentBefore].join('\n');
  if (existing.includes('yaml-language-server:')) return;
  doc.commentBefore = doc.commentBefore ? `${line}\n${doc.commentBefore}` : line;
}

/** Whole-document canonical form (used by `fmt` and for new files). */
export function canonicalize(doc: Document, kind: FileKind): void {
  ensureSchemaComment(doc, kind);
  if (doc.contents) shape(doc.contents, KIND_SHAPE[kind]);
}

export function createDoc(kind: FileKind, data: unknown): Document {
  const doc = new Document(stripUndefined(data));
  canonicalize(doc, kind);
  return doc;
}

export function toText(doc: Document): string {
  const text = doc.toString(TO_STRING).replace(/\r\n/g, '\n');
  return text.endsWith('\n') ? text : text + '\n';
}

export function formatText(kind: FileKind, text: string): string {
  const doc = parseDocument(text);
  if (doc.errors.length) return text;
  canonicalize(doc, kind);
  return toText(doc);
}

export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, stripUndefined(v)])) as T;
  }
  return value;
}

/**
 * Sets (or deletes, with `undefined`) `key` on the map at `mapPath`, touching
 * only that key. Scalars are updated in place so comments and style survive.
 */
export function setKey(doc: Document, mapPath: (string | number)[], key: string | number, value: unknown, mapShape: Shape) {
  const map = mapPath.length ? doc.getIn(mapPath, true) : doc.contents;
  if (!isMap(map)) throw new Error(`Expected a map at ${mapPath.join('.') || '(root)'}`);
  if (value === undefined) {
    map.delete(key);
    return;
  }
  const existing = map.get(key, true);
  const isScalarValue = value === null || ['string', 'number', 'boolean'].includes(typeof value);
  if (isScalar(existing) && isScalarValue && !(typeof value === 'string' && value.includes('\n'))) {
    existing.value = value;
    return;
  }
  const child = mapShape === 'nodeMap' ? 'node' : mapShape === 'edgeMap' ? 'edge' : CHILDREN[mapShape]?.[String(key)] ?? 'leaf';
  const node = doc.createNode(stripUndefined(value));
  shape(node, child);
  map.set(doc.createNode(key), node);
  if (mapShape === 'nodeMap' || mapShape === 'edgeMap') {
    map.items.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
    // A new drawing starts as `nodes: {}`, which re-parses as a flow map; once it has items it is a block map.
    map.flow = false;
  }
  else if (KEY_ORDER[mapShape as string]) orderKeys(map, KEY_ORDER[mapShape as string]);
}

/** Appends `value` to the sequence at `seqPath`, creating it on `parentShape` when missing. */
export function pushItem(doc: Document, seqPath: (string | number)[], value: unknown, itemShape: Shape, parentShape: Shape, index?: number) {
  let seq = doc.getIn(seqPath, true);
  if (!isSeq(seq)) {
    setKey(doc, seqPath.slice(0, -1), seqPath[seqPath.length - 1], [], parentShape);
    seq = doc.getIn(seqPath, true);
  }
  if (!isSeq(seq)) throw new Error(`Expected a list at ${seqPath.join('.')}`);
  const node = doc.createNode(stripUndefined(value));
  shape(node, itemShape);
  if (index === undefined || index >= seq.items.length) seq.items.push(node);
  else seq.items.splice(Math.max(0, index), 0, node);
  if (seq.items.length && CHILDREN[parentShape]?.[String(seqPath[seqPath.length - 1])] !== 'ids') seq.flow = false;
}

/** Write via temp file + rename so a crash never leaves a half-written YAML. */
export async function writeAtomic(path: string, data: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  await writeFile(tmp, data);
  try {
    await renameWithRetry(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/**
 * On Windows, rename over a file another process has open (the watcher, an
 * editor, antivirus) fails with EPERM/EACCES/EBUSY for a few milliseconds.
 * Retry briefly instead of losing the write, as graceful-fs does.
 */
async function renameWithRetry(from: string, to: string) {
  const transient = new Set(['EPERM', 'EACCES', 'EBUSY']);
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!transient.has(code) || attempt >= 20) throw err;
      await new Promise((r) => setTimeout(r, Math.min(10 * 2 ** attempt, 200)));
    }
  }
}

export async function removeFile(path: string) {
  await rm(path, { force: true });
}
