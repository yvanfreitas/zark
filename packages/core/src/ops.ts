import { join } from 'node:path';
import { isMap, isScalar, isSeq, Scalar, type Document } from 'yaml';
import { buildProject, parseFile, resolveEndpoint, type FileKind, type Project } from './project.js';
import type { Connection, DrawingEdge, Entity, Flow, FlowItem } from './schema.js';
import { errorsOf, nodeSize, validate, type Problem } from './validate.js';
import { createDoc, pushItem, removeFile, setKey, toText, writeAtomic } from './writer.js';
import { autoLayout } from './layout.js';
import { diffProjects, type Change } from './diff.js';
import { drawingLabelOverlaps } from './labels.js';
import { IMPACT_EN, type Params } from './messages.js';

export interface ImpactItem {
  key: string;
  params: Params;
}

type Fields = Record<string, unknown>;
type CatalogList = 'technologies' | 'tags' | 'teams';

export type Op =
  | { op: 'entity.create'; entity: Omit<Entity, 'connections'> & { connections?: Connection[] } }
  | { op: 'entity.update'; id: string; set?: Fields; unset?: string[] }
  | { op: 'entity.delete'; id: string; cascade?: boolean }
  | { op: 'entity.move'; id: string; parent: string | null }
  | { op: 'connection.create'; from: string; connection: Connection }
  | { op: 'connection.update'; ref: string; set?: Fields; unset?: string[] }
  | { op: 'connection.delete'; ref: string; cascade?: boolean }
  | { op: 'connection.reverse'; ref: string }
  | { op: 'rename-id'; kind: 'entity' | 'connection' | 'drawing' | 'flow'; from: string; to: string }
  | { op: 'drawing.create'; drawing: { id: string; name: string; description?: string; scope?: string | null } }
  | { op: 'drawing.update'; id: string; set?: Fields; unset?: string[] }
  | { op: 'drawing.delete'; id: string; cascade?: boolean }
  | { op: 'drawing.place'; drawing: string; nodes: { id: string; x?: number; y?: number; w?: number; h?: number; expanded?: boolean }[] }
  | { op: 'drawing.move-nodes'; drawing: string; nodes: { id: string; x: number; y: number; w?: number; h?: number }[] }
  | { op: 'drawing.remove-nodes'; drawing: string; ids: string[] }
  | { op: 'drawing.draw-edges'; drawing: string; edges: ({ ref: string } & DrawingEdge)[] }
  | { op: 'drawing.update-edge'; drawing: string; ref: string; set?: Fields; unset?: string[] }
  | { op: 'drawing.remove-edges'; drawing: string; refs: string[] }
  | { op: 'drawing.auto-layout'; drawing: string; ids?: string[] }
  | { op: 'drawing.auto-place-labels'; drawing: string }
  | { op: 'drawing.set-group'; drawing: string; group: { id: string; label: string; members: string[]; style?: 'dashed' | 'solid' } }
  | { op: 'drawing.remove-group'; drawing: string; id: string }
  | { op: 'drawing.set-note'; drawing: string; note: { id: string; text: string; x: number; y: number; w?: number } }
  | { op: 'drawing.remove-note'; drawing: string; id: string }
  | { op: 'flow.create'; flow: Flow }
  | { op: 'flow.update'; id: string; set?: Fields; unset?: string[] }
  | { op: 'flow.delete'; id: string }
  | { op: 'flow.add-steps'; flow: string; steps: FlowItem[]; index?: number }
  | { op: 'flow.update-step'; flow: string; step: string; set?: Fields; unset?: string[] }
  | { op: 'flow.move-step'; flow: string; step: string; index: number }
  | { op: 'flow.remove-steps'; flow: string; steps: string[] }
  | { op: 'catalog.set'; list: CatalogList; item: { id: string; name: string; color?: string; icon?: string } }
  | { op: 'catalog.remove'; list: CatalogList; id: string };

export class OpError extends Error {}

export interface ApplyResult {
  ok: boolean;
  /** path -> new text, or null for deleted files. */
  files: Map<string, string | null>;
  project: Project;
  problems: Problem[];
  /** Errors present after the change but not before. */
  newErrors: Problem[];
  changes: Change[];
  /** Cascade impact (English lines); set when a delete needs `cascade: true`. */
  impact?: string[];
  /** Same impact as message keys + params, for localized UIs. */
  impactItems?: ImpactItem[];
  conflict?: { file: string; expected: string; actual: string };
  error?: string;
}

const ENTITY_FIELDS = ['name', 'kind', 'caption', 'icon', 'description', 'external', 'status', 'technologies', 'tags', 'owner', 'links', 'source'];
const CONNECTION_FIELDS = ['to', 'label', 'direction', 'description', 'via', 'technologies', 'status', 'tags'];
const DRAWING_FIELDS = ['name', 'description', 'scope'];
const FLOW_FIELDS = ['name', 'description', 'drawing', 'steps'];
const STEP_FIELDS = ['via', 'text', 'reply', 'reverse', 'description'];
const EDGE_FIELDS = ['shape', 'from', 'to', 'points', 'labelAt'];
const NODE_FIELDS = ['x', 'y', 'w', 'h', 'expanded'];

/** Working copy of the project's files for one transaction. */
class Tx {
  texts: Map<string, string>;
  project: Project;
  private docs = new Map<string, Document>();
  impact: ImpactItem[] = [];

  constructor(base: Project) {
    this.project = base;
    this.texts = new Map([...base.files].map(([p, f]) => [p, f.text]));
  }

  has(path: string) {
    return this.texts.has(path);
  }

  doc(path: string): Document {
    let doc = this.docs.get(path);
    if (!doc) {
      const text = this.texts.get(path);
      if (text === undefined) throw new OpError(`File not found: ${path}`);
      doc = parseFile(path, text).doc;
      this.docs.set(path, doc);
    }
    return doc;
  }

  create(path: string, kind: FileKind, data: unknown) {
    if (this.texts.has(path)) throw new OpError(`Already exists: ${path}`);
    this.docs.set(path, createDoc(kind, data));
    this.texts.set(path, '');
  }

  remove(path: string) {
    this.docs.delete(path);
    this.texts.delete(path);
  }

  /** Serializes touched docs and rebuilds the model, so later ops see earlier ones. */
  refresh() {
    for (const [path, doc] of this.docs) this.texts.set(path, toText(doc));
    this.docs.clear();
    this.project = buildProject(this.project.dir, this.texts);
  }
}

// ---------- lookups ----------

function entityFile(tx: Tx, id: string) {
  const e = tx.project.entities.get(id);
  if (!e) throw new OpError(`Entity "${id}" does not exist${valid(tx.project.entities.keys())}`);
  return e;
}
function drawingFile(tx: Tx, id: string) {
  const d = tx.project.drawings.get(id);
  if (!d) throw new OpError(`Drawing "${id}" does not exist${valid(tx.project.drawings.keys())}`);
  return d;
}
function flowFile(tx: Tx, id: string) {
  const f = tx.project.flows.get(id);
  if (!f) throw new OpError(`Flow "${id}" does not exist${valid(tx.project.flows.keys())}`);
  return f;
}
function connection(tx: Tx, ref: string) {
  const c = tx.project.connections.get(ref);
  if (!c) throw new OpError(`Connection "${ref}" does not exist${valid(tx.project.connections.keys())}`);
  const index = tx.project.entities.get(c.from)!.entity.connections!.findIndex((x) => x.id === c.conn.id);
  return { ...c, index };
}
function valid(keys: Iterable<string>) {
  const all = [...keys];
  return all.length ? `. Valid: ${all.slice(0, 20).join(', ')}${all.length > 20 ? ', ...' : ''}` : '';
}

function applyFields(doc: Document, path: (string | number)[], shapeName: Parameters<typeof setKey>[4], allowed: string[], set: Fields = {}, unset: string[] = []) {
  for (const [key, value] of Object.entries(set)) {
    if (!allowed.includes(key)) throw new OpError(`Field "${key}" cannot be changed here. Fields: ${allowed.join(', ')}`);
    setKey(doc, path, key, value, shapeName);
  }
  for (const key of unset) {
    if (!allowed.includes(key)) throw new OpError(`Field "${key}" cannot be removed here`);
    setKey(doc, path, key, undefined, shapeName);
  }
}

/** Finds a step anywhere in the flow document. Returns the containing seq path and index. */
function findStep(doc: Document, stepId: string): { seq: (string | number)[]; index: number } | undefined {
  const search = (path: (string | number)[]): ReturnType<typeof findStep> => {
    const seq = doc.getIn(path, true);
    if (!isSeq(seq)) return undefined;
    for (let i = 0; i < seq.items.length; i++) {
      const item = seq.items[i];
      if (!isMap(item)) continue;
      if (item.get('id') === stepId && item.has('via')) return { seq: path, index: i };
      const par = item.get('parallel', true);
      if (isSeq(par)) for (let b = 0; b < par.items.length; b++) {
        const r = search([...path, i, 'parallel', b]);
        if (r) return r;
      }
      const alts = item.get('alternatives', true);
      if (isSeq(alts)) for (let a = 0; a < alts.items.length; a++) {
        const r = search([...path, i, 'alternatives', a, 'steps']);
        if (r) return r;
      }
    }
    return undefined;
  };
  return search(['steps']);
}

/** Removes every step whose `via` matches; returns how many were removed. */
function removeStepsWhere(doc: Document, match: (via: string) => boolean, path: (string | number)[] = ['steps']): number {
  const seq = doc.getIn(path, true);
  if (!isSeq(seq)) return 0;
  let removed = 0;
  for (let i = seq.items.length - 1; i >= 0; i--) {
    const item = seq.items[i];
    if (!isMap(item)) continue;
    const via = item.get('via');
    if (typeof via === 'string' && match(via)) {
      seq.items.splice(i, 1);
      removed++;
      continue;
    }
    const par = item.get('parallel', true);
    if (isSeq(par)) par.items.forEach((_, b) => (removed += removeStepsWhere(doc, match, [...path, i, 'parallel', b])));
    const alts = item.get('alternatives', true);
    if (isSeq(alts)) alts.items.forEach((_, a) => (removed += removeStepsWhere(doc, match, [...path, i, 'alternatives', a, 'steps'])));
  }
  return removed;
}

/** Rewrites `via` on every matching step. */
function mapStepVia(doc: Document, rewrite: (via: string) => string | undefined, path: (string | number)[] = ['steps']) {
  const seq = doc.getIn(path, true);
  if (!isSeq(seq)) return;
  seq.items.forEach((item, i) => {
    if (!isMap(item)) return;
    const via = item.get('via', true);
    if (isScalar(via) && typeof via.value === 'string') {
      const next = rewrite(via.value);
      if (next) via.value = next;
    }
    const par = item.get('parallel', true);
    if (isSeq(par)) par.items.forEach((_, b) => mapStepVia(doc, rewrite, [...path, i, 'parallel', b]));
    const alts = item.get('alternatives', true);
    if (isSeq(alts)) alts.items.forEach((_, a) => mapStepVia(doc, rewrite, [...path, i, 'alternatives', a, 'steps']));
  });
}

function renameMapKey(doc: Document, mapPath: (string | number)[], from: string, to: string) {
  const map = doc.getIn(mapPath, true);
  if (!isMap(map)) return;
  const pair = map.items.find((p) => (isScalar(p.key) ? p.key.value : p.key) === from);
  if (!pair) return;
  pair.key = new Scalar(to);
  map.items.sort((a, b) => String(isScalar(a.key) ? a.key.value : a.key).localeCompare(String(isScalar(b.key) ? b.key.value : b.key)));
}

function deleteMapKeys(doc: Document, mapPath: (string | number)[], keys: string[]) {
  const map = doc.getIn(mapPath, true);
  if (!isMap(map)) return 0;
  let n = 0;
  for (const k of keys) if (map.delete(k)) n++;
  return n;
}

// ---------- operations ----------

async function run(tx: Tx, op: Op): Promise<void> {
  const p = tx.project;
  switch (op.op) {
    case 'entity.create': {
      const e = op.entity;
      if (p.entities.has(e.id)) throw new OpError(`Entity "${e.id}" already exists`);
      tx.create(`entities/${e.id}.yaml`, 'entity', { ...e, parent: e.parent ?? undefined });
      return;
    }
    case 'entity.update': {
      const { file } = entityFile(tx, op.id);
      applyFields(tx.doc(file), [], 'entity', ENTITY_FIELDS, op.set, op.unset);
      return;
    }
    case 'entity.move': {
      const { file } = entityFile(tx, op.id);
      setKey(tx.doc(file), [], 'parent', op.parent ?? undefined, 'entity');
      return;
    }
    case 'entity.delete':
      return deleteEntity(tx, op.id, !!op.cascade);
    case 'connection.create': {
      const { file, entity } = entityFile(tx, op.from);
      if (entity.connections?.some((c) => c.id === op.connection.id)) throw new OpError(`Connection "${op.from}.${op.connection.id}" already exists`);
      pushItem(tx.doc(file), ['connections'], op.connection, 'connection', 'entity');
      return;
    }
    case 'connection.update': {
      const c = connection(tx, op.ref);
      applyFields(tx.doc(c.file), ['connections', c.index], 'connection', CONNECTION_FIELDS, op.set, op.unset);
      return;
    }
    case 'connection.delete':
      return deleteConnection(tx, op.ref, !!op.cascade);
    case 'connection.reverse':
      return reverseConnection(tx, op.ref);
    case 'rename-id':
      return renameId(tx, op.kind, op.from, op.to);
    case 'drawing.create': {
      if (p.drawings.has(op.drawing.id)) throw new OpError(`Drawing "${op.drawing.id}" already exists`);
      tx.create(`drawings/${op.drawing.id}.yaml`, 'drawing', { scope: null, ...op.drawing, nodes: {}, edges: {} });
      return;
    }
    case 'drawing.update': {
      const { file } = drawingFile(tx, op.id);
      applyFields(tx.doc(file), [], 'drawing', DRAWING_FIELDS, op.set, op.unset);
      return;
    }
    case 'drawing.delete': {
      const { file } = drawingFile(tx, op.id);
      const users = [...p.flows.values()].filter((f) => f.flow.drawing === op.id).map((f) => f.flow.id);
      if (users.length) throw new OpError(`Drawing "${op.id}" is used by flows ${users.join(', ')}. Point them to another drawing before deleting`);
      tx.remove(file);
      return;
    }
    case 'drawing.place': {
      const { file, drawing } = drawingFile(tx, op.drawing);
      const doc = tx.doc(file);
      const free = freeSpot(p, drawing.nodes ?? {});
      for (const n of op.nodes) {
        entityFile(tx, n.id);
        const { id, ...rest } = n;
        const pos = rest.x === undefined || rest.y === undefined ? free(id) : { x: rest.x, y: rest.y };
        setKey(doc, ['nodes'], id, { ...rest, ...pos }, 'nodeMap');
      }
      return;
    }
    case 'drawing.move-nodes': {
      const { file, drawing } = drawingFile(tx, op.drawing);
      const doc = tx.doc(file);
      for (const n of op.nodes) {
        if (!drawing.nodes?.[n.id]) throw new OpError(`"${n.id}" is not in drawing ${op.drawing}`);
        for (const key of ['x', 'y', 'w', 'h'] as const) if (n[key] !== undefined) setKey(doc, ['nodes', n.id], key, Math.round(n[key]!), 'node');
      }
      return;
    }
    case 'drawing.remove-nodes': {
      const { file, drawing } = drawingFile(tx, op.drawing);
      const doc = tx.doc(file);
      deleteMapKeys(doc, ['nodes'], op.ids);
      // Edges that no longer resolve to any placed endpoint go too; the model is untouched.
      const remaining = { ...drawing, nodes: Object.fromEntries(Object.entries(drawing.nodes ?? {}).filter(([k]) => !op.ids.includes(k))) };
      const orphanEdges = Object.keys(drawing.edges ?? {}).filter((ref) => {
        const c = p.connections.get(ref);
        return c && (!resolveEndpoint(p, remaining, c.from) || !resolveEndpoint(p, remaining, c.conn.to));
      });
      deleteMapKeys(doc, ['edges'], orphanEdges);
      removeGroupMembers(doc, op.ids);
      return;
    }
    case 'drawing.draw-edges': {
      const { file } = drawingFile(tx, op.drawing);
      const doc = tx.doc(file);
      for (const { ref, ...edge } of op.edges) {
        connection(tx, ref);
        setKey(doc, ['edges'], ref, edge, 'edgeMap');
      }
      return;
    }
    case 'drawing.update-edge': {
      const { file, drawing } = drawingFile(tx, op.drawing);
      if (!drawing.edges?.[op.ref]) throw new OpError(`"${op.ref}" is not drawn in drawing ${op.drawing}`);
      applyFields(tx.doc(file), ['edges', op.ref], 'edge', EDGE_FIELDS, op.set, op.unset);
      const edge = tx.doc(file).getIn(['edges', op.ref], true);
      if (isMap(edge)) edge.flow = !edge.has('points');
      return;
    }
    case 'drawing.remove-edges': {
      const { file } = drawingFile(tx, op.drawing);
      deleteMapKeys(tx.doc(file), ['edges'], op.refs);
      return;
    }
    case 'drawing.auto-place-labels': {
      // Fixed labelAt values that cause W013 go back to automatic placement,
      // which avoids other labels and boxes (same geometry as canvas and PNG).
      const { file, drawing } = drawingFile(tx, op.drawing);
      const { overlaps } = drawingLabelOverlaps(p, drawing);
      const involved = new Set(overlaps.flatMap((o) => [o.ref, ...(o.with.kind === 'label' ? [o.with.ref] : [])]));
      const doc = tx.doc(file);
      for (const ref of [...involved].sort()) if (drawing.edges?.[ref]?.labelAt !== undefined) setKey(doc, ['edges', ref], 'labelAt', undefined, 'edge');
      return;
    }
    case 'drawing.auto-layout': {
      const { file, drawing } = drawingFile(tx, op.drawing);
      const positions = await autoLayout(p, drawing, op.ids);
      const doc = tx.doc(file);
      for (const [id, pos] of Object.entries(positions)) {
        setKey(doc, ['nodes', id], 'x', pos.x, 'node');
        setKey(doc, ['nodes', id], 'y', pos.y, 'node');
      }
      return;
    }
    case 'drawing.set-group':
    case 'drawing.set-note': {
      const { file } = drawingFile(tx, op.drawing);
      const doc = tx.doc(file);
      const key = op.op === 'drawing.set-group' ? 'groups' : 'notes';
      const value = op.op === 'drawing.set-group' ? op.group : op.note;
      const seq = doc.getIn([key], true);
      const index = isSeq(seq) ? seq.items.findIndex((i) => isMap(i) && i.get('id') === value.id) : -1;
      if (index >= 0) {
        for (const [k, v] of Object.entries(value)) setKey(doc, [key, index], k, v, key === 'groups' ? 'group' : 'note');
      } else pushItem(doc, [key], value, key === 'groups' ? 'group' : 'note', 'drawing');
      return;
    }
    case 'drawing.remove-group':
    case 'drawing.remove-note': {
      const { file } = drawingFile(tx, op.drawing);
      const doc = tx.doc(file);
      const key = op.op === 'drawing.remove-group' ? 'groups' : 'notes';
      const seq = doc.getIn([key], true);
      const index = isSeq(seq) ? seq.items.findIndex((i) => isMap(i) && i.get('id') === op.id) : -1;
      if (index < 0) throw new OpError(`${key === 'groups' ? 'Group' : 'Note'} "${op.id}" does not exist in drawing ${op.drawing}`);
      (seq as any).items.splice(index, 1);
      return;
    }
    case 'flow.create': {
      if (p.flows.has(op.flow.id)) throw new OpError(`Flow "${op.flow.id}" already exists`);
      tx.create(`flows/${op.flow.id}.yaml`, 'flow', { ...op.flow, steps: op.flow.steps ?? [] });
      return;
    }
    case 'flow.update': {
      const { file } = flowFile(tx, op.id);
      applyFields(tx.doc(file), [], 'flow', FLOW_FIELDS, op.set, op.unset);
      return;
    }
    case 'flow.delete': {
      const { file } = flowFile(tx, op.id);
      const users = [...p.flows.values()].filter((f) => JSON.stringify(f.flow.steps ?? []).includes(`"subflow":"${op.id}"`)).map((f) => f.flow.id);
      if (users.length) throw new OpError(`Flow "${op.id}" is a subflow of ${users.join(', ')}`);
      tx.remove(file);
      return;
    }
    case 'flow.add-steps': {
      const { file } = flowFile(tx, op.flow);
      const doc = tx.doc(file);
      op.steps.forEach((step, i) => pushItem(doc, ['steps'], step, 'flowItem', 'flow', op.index === undefined ? undefined : op.index + i));
      return;
    }
    case 'flow.update-step': {
      const { file } = flowFile(tx, op.flow);
      const doc = tx.doc(file);
      const at = findStep(doc, op.step);
      if (!at) throw new OpError(`Step "${op.step}" does not exist in flow ${op.flow}`);
      applyFields(doc, [...at.seq, at.index], 'step', STEP_FIELDS, op.set, op.unset);
      return;
    }
    case 'flow.move-step': {
      const { file } = flowFile(tx, op.flow);
      const doc = tx.doc(file);
      const at = findStep(doc, op.step);
      if (!at) throw new OpError(`Step "${op.step}" does not exist in flow ${op.flow}`);
      const seq = doc.getIn(at.seq, true) as any;
      const [item] = seq.items.splice(at.index, 1);
      seq.items.splice(Math.max(0, Math.min(op.index, seq.items.length)), 0, item);
      return;
    }
    case 'flow.remove-steps': {
      const { file } = flowFile(tx, op.flow);
      const doc = tx.doc(file);
      for (const id of op.steps) {
        const at = findStep(doc, id);
        if (!at) throw new OpError(`Step "${id}" does not exist in flow ${op.flow}`);
        (doc.getIn(at.seq, true) as any).items.splice(at.index, 1);
      }
      return;
    }
    case 'catalog.set': {
      if (!tx.has('catalog.yaml')) tx.create('catalog.yaml', 'catalog', {});
      const doc = tx.doc('catalog.yaml');
      const seq = doc.getIn([op.list], true);
      const index = isSeq(seq) ? seq.items.findIndex((i) => isMap(i) && i.get('id') === op.item.id) : -1;
      if (index >= 0) for (const [k, v] of Object.entries(op.item)) setKey(doc, [op.list, index], k, v, 'catalogItem');
      else pushItem(doc, [op.list], op.item, 'catalogItem', 'catalog');
      return;
    }
    case 'catalog.remove': {
      const doc = tx.doc('catalog.yaml');
      const seq = doc.getIn([op.list], true);
      const index = isSeq(seq) ? seq.items.findIndex((i) => isMap(i) && i.get('id') === op.id) : -1;
      if (index < 0) throw new OpError(`"${op.id}" does not exist in ${op.list}`);
      (seq as any).items.splice(index, 1);
      return;
    }
    default:
      throw new OpError(`Unknown operation: ${(op as { op: string }).op}`);
  }
}

function removeGroupMembers(doc: Document, ids: string[]) {
  const groups = doc.getIn(['groups'], true);
  if (!isSeq(groups)) return;
  for (const g of groups.items) {
    const members = isMap(g) ? g.get('members', true) : undefined;
    if (isSeq(members)) members.items = members.items.filter((m) => !ids.includes(String(isScalar(m) ? m.value : m)));
  }
}

function deleteEntity(tx: Tx, id: string, cascade: boolean) {
  const p = tx.project;
  entityFile(tx, id);
  // Collect the entity and, under cascade, all descendants.
  const doomed: string[] = [];
  const collect = (e: string) => {
    doomed.push(e);
    for (const child of p.children.get(e) ?? []) collect(child);
  };
  collect(id);
  const children = doomed.slice(1);
  if (children.length && !cascade) {
    tx.impact.push({ key: 'children', params: { ids: children } });
  }
  const doomedRefs = [...p.connections.values()].filter((c) => doomed.includes(c.from) || doomed.includes(c.conn.to)).map((c) => c.ref);
  const incoming = doomedRefs.filter((r) => !doomed.includes(p.connections.get(r)!.from));
  if (incoming.length) tx.impact.push({ key: 'incoming', params: { refs: incoming } });
  for (const [did, { drawing, file }] of p.drawings) {
    const nodes = doomed.filter((e) => drawing.nodes?.[e]);
    const edges = doomedRefs.filter((r) => drawing.edges?.[r]);
    if (nodes.length) tx.impact.push({ key: 'nodes', params: { drawing: did, ids: nodes } });
    if (edges.length) tx.impact.push({ key: 'edges', params: { drawing: did, refs: edges } });
    if (drawing.scope && doomed.includes(drawing.scope)) tx.impact.push({ key: 'scope', params: { drawing: did, scope: drawing.scope } });
    if (cascade) {
      const doc = tx.doc(file);
      deleteMapKeys(doc, ['nodes'], nodes);
      deleteMapKeys(doc, ['edges'], edges);
      removeGroupMembers(doc, doomed);
      if (drawing.scope && doomed.includes(drawing.scope)) setKey(doc, [], 'scope', null, 'drawing');
    }
  }
  for (const [fid, { flow, file }] of p.flows) {
    const uses = JSON.stringify(flow.steps ?? []);
    const hit = doomedRefs.filter((r) => uses.includes(`"via":"${r}"`));
    if (hit.length) tx.impact.push({ key: 'steps', params: { flow: fid, refs: hit } });
    if (cascade && hit.length) removeStepsWhere(tx.doc(file), (via) => hit.includes(via));
  }
  for (const [eid, { entity, file }] of p.entities) {
    if (doomed.includes(eid)) continue;
    const vias = (entity.connections ?? []).map((c, i) => ({ c, i })).filter(({ c }) => c.via && doomed.includes(c.via));
    if (vias.length) tx.impact.push({ key: 'via', params: { entity: eid, ids: vias.map(({ c }) => c.id) } });
    if (!cascade) continue;
    const doc = tx.doc(file);
    for (const { i } of vias) setKey(doc, ['connections', i], 'via', undefined, 'connection');
    const seq = doc.getIn(['connections'], true);
    if (isSeq(seq)) seq.items = seq.items.filter((item) => !(isMap(item) && doomed.includes(String(item.get('to')))));
  }
  if (!cascade) {
    // Nothing references the entity beyond its own file: plain delete is safe.
    if (tx.impact.length) return;
    tx.remove(p.entities.get(id)!.file);
    return;
  }
  for (const e of doomed) tx.remove(p.entities.get(e)!.file);
  tx.impact = [];
}

function deleteConnection(tx: Tx, ref: string, cascade: boolean) {
  const p = tx.project;
  const c = connection(tx, ref);
  for (const [did, { drawing, file }] of p.drawings) {
    if (!drawing.edges?.[ref]) continue;
    tx.impact.push({ key: 'edge', params: { drawing: did } });
    if (cascade) deleteMapKeys(tx.doc(file), ['edges'], [ref]);
  }
  for (const [fid, { flow, file }] of p.flows) {
    if (!JSON.stringify(flow.steps ?? []).includes(`"via":"${ref}"`)) continue;
    tx.impact.push({ key: 'stepsOn', params: { flow: fid, ref } });
    if (cascade) removeStepsWhere(tx.doc(file), (via) => via === ref);
  }
  if (tx.impact.length && !cascade) return;
  (tx.doc(c.file).getIn(['connections'], true) as any).items.splice(c.index, 1);
  tx.impact = [];
}

function reverseConnection(tx: Tx, ref: string) {
  const p = tx.project;
  const c = connection(tx, ref);
  const target = entityFile(tx, c.conn.to);
  let newId = c.conn.id;
  for (let n = 2; target.entity.connections?.some((x) => x.id === newId); n++) newId = `${c.conn.id}-${n}`;
  const newRef = `${c.conn.to}.${newId}`;
  (tx.doc(c.file).getIn(['connections'], true) as any).items.splice(c.index, 1);
  pushItem(tx.doc(target.file), ['connections'], { ...c.conn, id: newId, to: c.from }, 'connection', 'entity');
  for (const { drawing, file } of p.drawings.values()) {
    if (!drawing.edges?.[ref]) continue;
    const doc = tx.doc(file);
    renameMapKey(doc, ['edges'], ref, newRef);
    // Swap anchor sides so the drawn line keeps its geometry.
    const e = drawing.edges[ref];
    if (e.from || e.to) {
      setKey(doc, ['edges', newRef], 'from', e.to, 'edge');
      setKey(doc, ['edges', newRef], 'to', e.from, 'edge');
    }
    if (e.points) setKey(doc, ['edges', newRef], 'points', [...e.points].reverse(), 'edge');
    if (e.labelAt !== undefined) setKey(doc, ['edges', newRef], 'labelAt', Math.round((1 - e.labelAt) * 100) / 100, 'edge');
  }
  for (const { flow, file } of p.flows.values()) {
    if (!JSON.stringify(flow.steps ?? []).includes(`"via":"${ref}"`)) continue;
    const doc = tx.doc(file);
    mapStepVia(doc, (via) => (via === ref ? newRef : undefined));
    // A step that walked against the old direction now walks with the new one, and vice versa.
    flipReverse(doc, newRef);
  }
}

function flipReverse(doc: Document, ref: string, path: (string | number)[] = ['steps']) {
  const seq = doc.getIn(path, true);
  if (!isSeq(seq)) return;
  seq.items.forEach((item, i) => {
    if (!isMap(item)) return;
    if (item.get('via') === ref) setKey(doc, [...path, i], 'reverse', item.get('reverse') ? undefined : true, 'step');
    const par = item.get('parallel', true);
    if (isSeq(par)) par.items.forEach((_, b) => flipReverse(doc, ref, [...path, i, 'parallel', b]));
    const alts = item.get('alternatives', true);
    if (isSeq(alts)) alts.items.forEach((_, a) => flipReverse(doc, ref, [...path, i, 'alternatives', a, 'steps']));
  });
}

function renameId(tx: Tx, kind: 'entity' | 'connection' | 'drawing' | 'flow', from: string, to: string) {
  const p = tx.project;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(to)) throw new OpError(`"${to}" is not a valid slug (a-z, 0-9, hyphen)`);
  if (kind === 'entity') {
    const { file } = entityFile(tx, from);
    if (p.entities.has(to)) throw new OpError(`Entity "${to}" already exists`);
    const doc = tx.doc(file);
    setKey(doc, [], 'id', to, 'entity');
    const text = toText(doc);
    tx.remove(file);
    tx.texts.set(`entities/${to}.yaml`, text);
    const prefix = `${from}.`;
    const rewriteRef = (r: string) => (r.startsWith(prefix) ? `${to}.${r.slice(prefix.length)}` : undefined);
    for (const [eid, { entity, file: f }] of p.entities) {
      const path = eid === from ? `entities/${to}.yaml` : f;
      if (entity.parent === from) setKey(tx.doc(path), [], 'parent', to, 'entity');
      (entity.connections ?? []).forEach((c, i) => {
        if (c.to === from) setKey(tx.doc(path), ['connections', i], 'to', to, 'connection');
        if (c.via === from) setKey(tx.doc(path), ['connections', i], 'via', to, 'connection');
      });
    }
    for (const { drawing, file: f } of p.drawings.values()) {
      const doc = tx.doc(f);
      if (drawing.nodes?.[from]) renameMapKey(doc, ['nodes'], from, to);
      for (const ref of Object.keys(drawing.edges ?? {})) {
        const next = rewriteRef(ref);
        if (next) renameMapKey(doc, ['edges'], ref, next);
      }
      if (drawing.scope === from) setKey(doc, [], 'scope', to, 'drawing');
      const groups = doc.getIn(['groups'], true);
      if (isSeq(groups)) for (const g of groups.items) {
        const members = isMap(g) ? g.get('members', true) : undefined;
        if (isSeq(members)) for (const m of members.items) if (isScalar(m) && m.value === from) m.value = to;
      }
    }
    for (const { file: f } of p.flows.values()) mapStepVia(tx.doc(f), rewriteRef);
    return;
  }
  if (kind === 'connection') {
    const c = connection(tx, from);
    const newRef = `${c.from}.${to}`;
    if (p.connections.has(newRef)) throw new OpError(`Connection "${newRef}" already exists`);
    setKey(tx.doc(c.file), ['connections', c.index], 'id', to, 'connection');
    for (const { drawing, file } of p.drawings.values()) if (drawing.edges?.[from]) renameMapKey(tx.doc(file), ['edges'], from, newRef);
    for (const { file } of p.flows.values()) mapStepVia(tx.doc(file), (via) => (via === from ? newRef : undefined));
    return;
  }
  if (kind === 'drawing') {
    const { file } = drawingFile(tx, from);
    if (p.drawings.has(to)) throw new OpError(`Drawing "${to}" already exists`);
    const doc = tx.doc(file);
    setKey(doc, [], 'id', to, 'drawing');
    const text = toText(doc);
    tx.remove(file);
    tx.texts.set(`drawings/${to}.yaml`, text);
    for (const { flow, file: f } of p.flows.values()) if (flow.drawing === from) setKey(tx.doc(f), [], 'drawing', to, 'flow');
    if (p.config.defaultDrawing === from && tx.has('zark.yaml')) setKey(tx.doc('zark.yaml'), [], 'defaultDrawing', to, 'config');
    return;
  }
  const { file } = flowFile(tx, from);
  if (p.flows.has(to)) throw new OpError(`Flow "${to}" already exists`);
  const doc = tx.doc(file);
  setKey(doc, [], 'id', to, 'flow');
  const text = toText(doc);
  tx.remove(file);
  tx.texts.set(`flows/${to}.yaml`, text);
  for (const [fid, { file: f }] of p.flows) {
    if (fid === from) continue;
    const d = tx.doc(f);
    const replace = (path: (string | number)[]) => {
      const seq = d.getIn(path, true);
      if (!isSeq(seq)) return;
      seq.items.forEach((item, i) => {
        if (!isMap(item)) return;
        const sub = item.get('subflow', true);
        if (isScalar(sub) && sub.value === from) sub.value = to;
        const par = item.get('parallel', true);
        if (isSeq(par)) par.items.forEach((_, b) => replace([...path, i, 'parallel', b]));
        const alts = item.get('alternatives', true);
        if (isSeq(alts)) alts.items.forEach((_, a) => replace([...path, i, 'alternatives', a, 'steps']));
      });
    };
    replace(['steps']);
  }
}

/**
 * Places new nodes in a column right of the current drawing.
 * ponytail: column placement, not true free-space search; use auto_layout for real arrangement.
 */
function freeSpot(project: Project, nodes: Record<string, { x: number; y: number; w?: number; h?: number }>) {
  const g = project.config.grid;
  const entries = Object.entries(nodes);
  const maxX = entries.length ? Math.max(...entries.map(([id, n]) => n.x + nodeSize(project, id, n).w)) : 0;
  const minY = entries.length ? Math.min(...entries.map(([, n]) => n.y)) : 0;
  const x = Math.ceil((maxX + (entries.length ? 96 : 0)) / g) * g;
  let y = Math.floor(minY / g) * g;
  return (id: string) => {
    const pos = { x, y };
    y += Math.ceil((nodeSize(project, id, {}).h + 64) / g) * g;
    return pos;
  };
}

// ---------- public API ----------

export interface ApplyOptions {
  /** Expected file hashes (optimistic concurrency). */
  expect?: Record<string, string>;
  /** Allow ops that introduce new errors (used by tests and `fmt`). */
  allowErrors?: boolean;
}

export async function applyOps(base: Project, ops: Op[], options: ApplyOptions = {}): Promise<ApplyResult> {
  const before = validate(base);
  const fail = (extra: Partial<ApplyResult>): ApplyResult => ({ ok: false, files: new Map(), project: base, problems: before, newErrors: [], changes: [], ...extra });

  for (const [file, expected] of Object.entries(options.expect ?? {})) {
    const actual = base.files.get(file)?.hash ?? '';
    if (actual !== expected) return fail({ conflict: { file, expected, actual }, error: `Conflict: ${file} changed on disk. Reload and try again` });
  }

  const tx = new Tx(base);
  try {
    for (const op of ops) {
      await run(tx, op);
      if (tx.impact.length) {
        const impactItems = tx.impact;
        return fail({ impact: impactItems.map((i) => IMPACT_EN[i.key](i.params)), impactItems, error: 'The deletion affects other items. Repeat with cascade: true to confirm' });
      }
      tx.refresh();
    }
  } catch (err) {
    if (err instanceof OpError) return fail({ error: err.message });
    throw err;
  }

  const files = new Map<string, string | null>();
  for (const [path, text] of tx.texts) if (base.files.get(path)?.text !== text) files.set(path, text);
  for (const path of base.files.keys()) if (!tx.texts.has(path)) files.set(path, null);

  const project = tx.project;
  const problems = validate(project);
  const key = (p: Problem) => `${p.code}|${p.ref ?? ''}|${p.file}`;
  const old = new Set(errorsOf(before).map(key));
  const newErrors = errorsOf(problems).filter((p) => !old.has(key(p)));
  const changes = diffProjects(base, project);
  if (newErrors.length && !options.allowErrors) {
    return { ok: false, files: new Map(), project: base, problems: before, newErrors, changes, error: `The operation introduces ${newErrors.length} error(s)` };
  }
  return { ok: true, files, project, problems, newErrors, changes };
}

/** Persists an ApplyResult's files atomically. Writes are validated before any file is touched. */
export async function writeResult(dir: string, files: Map<string, string | null>) {
  for (const [path, text] of files) {
    if (text === null) await removeFile(join(dir, path));
    else await writeAtomic(join(dir, path), text);
  }
}
