import { allSteps, type Project } from './project.js';
import { CHANGE_EN, type Params } from './messages.js';

export type ChangeType =
  | 'entity.added' | 'entity.removed' | 'entity.changed' | 'entity.moved'
  | 'connection.added' | 'connection.removed' | 'connection.reversed' | 'connection.changed'
  | 'drawing.added' | 'drawing.removed' | 'drawing.content' | 'drawing.layout'
  | 'flow.added' | 'flow.removed' | 'flow.steps';

export interface Change {
  type: ChangeType;
  /** English text (CLI, MCP, PR). The UI localizes from `key` + `params`. */
  text: string;
  ref: string;
  key: string;
  params: Params;
}

/** Relevance order used for PR titles (section 13). */
export const CHANGE_ORDER: ChangeType[] = [
  'entity.added', 'entity.removed', 'entity.moved', 'entity.changed',
  'connection.added', 'connection.removed', 'connection.reversed', 'connection.changed',
  'flow.added', 'flow.removed', 'flow.steps',
  'drawing.added', 'drawing.removed', 'drawing.content', 'drawing.layout',
];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function diffProjects(before: Project, after: Project): Change[] {
  const out: Change[] = [];
  const push = (type: ChangeType, ref: string, params: Params, key: string = type) => out.push({ type, ref, key, params, text: CHANGE_EN[key](params) });
  const name = (id: string) => after.entities.get(id)?.entity.name ?? before.entities.get(id)?.entity.name ?? id;

  // Entities
  for (const [id, { entity }] of after.entities) {
    const old = before.entities.get(id)?.entity;
    if (!old) {
      push('entity.added', id, { name: entity.name, kind: entity.kind, external: entity.external ? 1 : 0 });
      continue;
    }
    if ((old.parent ?? null) !== (entity.parent ?? null)) {
      if (entity.parent) push('entity.moved', id, { name: entity.name, parent: name(entity.parent) });
      else push('entity.moved', id, { name: entity.name }, 'entity.movedRoot');
    }
    const fields = Object.keys({ ...old, ...entity }).filter((k) => !['id', 'parent', 'connections'].includes(k) && !same((old as any)[k], (entity as any)[k]));
    if (fields.length) push('entity.changed', id, { name: old.name, fields, oldName: old.name, newName: entity.name });
  }
  for (const [id, { entity }] of before.entities) {
    if (!after.entities.has(id)) push('entity.removed', id, { name: entity.name });
  }

  // Connections
  const added = [...after.connections.values()].filter((c) => !before.connections.has(c.ref));
  const removed = [...before.connections.values()].filter((c) => !after.connections.has(c.ref));
  const reversedRemoved = new Set<string>();
  for (const c of added) {
    const rev = removed.find((r) => !reversedRemoved.has(r.ref) && r.from === c.conn.to && r.conn.to === c.from && r.conn.label === c.conn.label);
    if (rev) {
      reversedRemoved.add(rev.ref);
      push('connection.reversed', c.ref, { from: name(c.from), to: name(c.conn.to) });
    } else push('connection.added', c.ref, { from: name(c.from), to: name(c.conn.to), label: c.conn.label });
  }
  for (const r of removed) {
    if (!reversedRemoved.has(r.ref)) push('connection.removed', r.ref, { from: name(r.from), to: name(r.conn.to), label: r.conn.label });
  }
  for (const [ref, c] of after.connections) {
    const old = before.connections.get(ref);
    if (!old || same(old.conn, c.conn)) continue;
    const fields = Object.keys({ ...old.conn, ...c.conn }).filter((k) => k !== 'id' && !same((old.conn as any)[k], (c.conn as any)[k]));
    push('connection.changed', ref, { from: name(c.from), to: name(c.conn.to), fields, oldLabel: old.conn.label, newLabel: c.conn.label });
  }

  // Drawings
  for (const [id, { drawing }] of after.drawings) {
    const old = before.drawings.get(id)?.drawing;
    if (!old) {
      push('drawing.added', id, { name: drawing.name });
      continue;
    }
    const nb = old.nodes ?? {}, na = drawing.nodes ?? {};
    const eb = old.edges ?? {}, ea = drawing.edges ?? {};
    const plusN = Object.keys(na).filter((k) => !nb[k]).length;
    const minusN = Object.keys(nb).filter((k) => !na[k]).length;
    const plusE = Object.keys(ea).filter((k) => !eb[k]).length;
    const minusE = Object.keys(eb).filter((k) => !ea[k]).length;
    if (plusN || minusN || plusE || minusE) push('drawing.content', id, { name: drawing.name, plusN, minusN, plusE, minusE });
    const moved = Object.keys(na).filter((k) => nb[k] && !same(nb[k], na[k])).length;
    const reshaped = Object.keys(ea).filter((k) => eb[k] && !same(eb[k], ea[k])).length;
    const visual = !same(old.groups, drawing.groups) || !same(old.notes, drawing.notes) || old.name !== drawing.name || old.description !== drawing.description || (old.scope ?? null) !== (drawing.scope ?? null);
    if (moved || reshaped || visual) push('drawing.layout', id, { name: drawing.name, moved, reshaped, visual: visual ? 1 : 0 });
  }
  for (const [id, { drawing }] of before.drawings) {
    if (!after.drawings.has(id)) push('drawing.removed', id, { name: drawing.name });
  }

  // Flows
  for (const [id, { flow }] of after.flows) {
    const old = before.flows.get(id)?.flow;
    const steps = allSteps(flow);
    if (!old) {
      push('flow.added', id, { name: flow.name, steps: steps.length });
      continue;
    }
    if (same(old, flow)) continue;
    const oldSteps = allSteps(old);
    const oldIds = oldSteps.map((s) => s.id);
    const newIds = steps.map((s) => s.id);
    const plus = newIds.filter((s) => !oldIds.includes(s)).length;
    const minus = oldIds.filter((s) => !newIds.includes(s)).length;
    const common = newIds.filter((s) => oldIds.includes(s));
    const oldCommon = oldIds.filter((s) => newIds.includes(s));
    const reordered = common.filter((s, i) => oldCommon[i] !== s).length;
    const edited = steps.filter((s) => {
      const o = oldSteps.find((x) => x.id === s.id);
      return o && !same(o, s);
    }).length;
    push('flow.steps', id, { name: flow.name, plus, minus, reordered, edited });
  }
  for (const [id, { flow }] of before.flows) {
    if (!after.flows.has(id)) push('flow.removed', id, { name: flow.name });
  }

  return out.sort((a, b) => CHANGE_ORDER.indexOf(a.type) - CHANGE_ORDER.indexOf(b.type));
}
