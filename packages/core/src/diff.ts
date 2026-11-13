import { allSteps, type Project } from './project.js';
import type { Connection, Entity } from './schema.js';

export type ChangeType =
  | 'entity.added' | 'entity.removed' | 'entity.changed' | 'entity.moved'
  | 'connection.added' | 'connection.removed' | 'connection.reversed' | 'connection.changed'
  | 'drawing.added' | 'drawing.removed' | 'drawing.content' | 'drawing.layout'
  | 'flow.added' | 'flow.removed' | 'flow.steps';

export interface Change {
  type: ChangeType;
  text: string;
  ref: string;
}

/** Relevance order used for PR titles (section 13). */
export const CHANGE_ORDER: ChangeType[] = [
  'entity.added', 'entity.removed', 'entity.moved', 'entity.changed',
  'connection.added', 'connection.removed', 'connection.reversed', 'connection.changed',
  'flow.added', 'flow.removed', 'flow.steps',
  'drawing.added', 'drawing.removed', 'drawing.content', 'drawing.layout',
];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const joinPt = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`);

export function diffProjects(before: Project, after: Project): Change[] {
  const out: Change[] = [];
  const name = (id: string) => after.entities.get(id)?.entity.name ?? before.entities.get(id)?.entity.name ?? id;
  const describe = (e: Entity) => `${e.name} (${e.kind}${e.external ? ', externo' : ''})`;

  // Entities
  for (const [id, { entity }] of after.entities) {
    const old = before.entities.get(id)?.entity;
    if (!old) {
      out.push({ type: 'entity.added', text: `Entidade adicionada: ${describe(entity)}`, ref: id });
      continue;
    }
    if ((old.parent ?? null) !== (entity.parent ?? null)) {
      out.push({ type: 'entity.moved', text: entity.parent ? `${entity.name} movido para dentro de ${name(entity.parent)}` : `${entity.name} movido para a raiz`, ref: id });
    }
    const fields = Object.keys({ ...old, ...entity }).filter((k) => !['id', 'parent', 'connections'].includes(k) && !same((old as any)[k], (entity as any)[k]));
    if (fields.length) out.push({ type: 'entity.changed', text: `${old.name}: ${joinPt(fields.map((f) => (f === 'name' ? `nome "${old.name}" -> "${entity.name}"` : f)))} ${fields.length === 1 ? 'alterado' : 'alterados'}`, ref: id });
  }
  for (const [id, { entity }] of before.entities) {
    if (!after.entities.has(id)) out.push({ type: 'entity.removed', text: `Entidade removida: ${entity.name}`, ref: id });
  }

  // Connections
  const arrow = (from: string, c: Connection) => `${name(from)} -> ${name(c.to)}`;
  const added = [...after.connections.values()].filter((c) => !before.connections.has(c.ref));
  const removed = [...before.connections.values()].filter((c) => !after.connections.has(c.ref));
  const reversedRemoved = new Set<string>();
  for (const c of added) {
    const rev = removed.find((r) => !reversedRemoved.has(r.ref) && r.from === c.conn.to && r.conn.to === c.from && r.conn.label === c.conn.label);
    if (rev) {
      reversedRemoved.add(rev.ref);
      out.push({ type: 'connection.reversed', text: `Conexão invertida: agora ${arrow(c.from, c.conn)}`, ref: c.ref });
    } else out.push({ type: 'connection.added', text: `Nova conexão: ${arrow(c.from, c.conn)} ("${c.conn.label}")`, ref: c.ref });
  }
  for (const r of removed) {
    if (!reversedRemoved.has(r.ref)) out.push({ type: 'connection.removed', text: `Conexão removida: ${arrow(r.from, r.conn)} ("${r.conn.label}")`, ref: r.ref });
  }
  for (const [ref, c] of after.connections) {
    const old = before.connections.get(ref);
    if (!old || same(old.conn, c.conn)) continue;
    const parts = Object.keys({ ...old.conn, ...c.conn })
      .filter((k) => k !== 'id' && !same((old.conn as any)[k], (c.conn as any)[k]))
      .map((k) => (k === 'label' ? `rótulo "${old.conn.label}" -> "${c.conn.label}"` : `${k} alterado`));
    out.push({ type: 'connection.changed', text: `${arrow(c.from, c.conn)}: ${parts.join(', ')}`, ref });
  }

  // Drawings
  for (const [id, { drawing }] of after.drawings) {
    const old = before.drawings.get(id)?.drawing;
    if (!old) {
      out.push({ type: 'drawing.added', text: `Novo desenho: ${drawing.name}`, ref: id });
      continue;
    }
    const nb = old.nodes ?? {}, na = drawing.nodes ?? {};
    const eb = old.edges ?? {}, ea = drawing.edges ?? {};
    const plusN = Object.keys(na).filter((k) => !nb[k]).length;
    const minusN = Object.keys(nb).filter((k) => !na[k]).length;
    const plusE = Object.keys(ea).filter((k) => !eb[k]).length;
    const minusE = Object.keys(eb).filter((k) => !ea[k]).length;
    const content = [
      plusN && `+${plural(plusN, 'entidade', 'entidades')}`,
      minusN && `-${plural(minusN, 'entidade', 'entidades')}`,
      plusE && `+${plural(plusE, 'conexão', 'conexões')}`,
      minusE && `-${plural(minusE, 'conexão', 'conexões')}`,
    ].filter(Boolean);
    if (content.length) out.push({ type: 'drawing.content', text: `${drawing.name}: ${content.join(', ')}`, ref: id });
    const moved = Object.keys(na).filter((k) => nb[k] && !same(nb[k], na[k])).length;
    const reshaped = Object.keys(ea).filter((k) => eb[k] && !same(eb[k], ea[k])).length;
    const visual = !same(old.groups, drawing.groups) || !same(old.notes, drawing.notes) || old.name !== drawing.name || old.description !== drawing.description || (old.scope ?? null) !== (drawing.scope ?? null);
    const layout = [
      moved && `${plural(moved, 'caixa reposicionada', 'caixas reposicionadas')}`,
      reshaped && `${plural(reshaped, 'conector ajustado', 'conectores ajustados')}`,
      visual && 'metadados, grupos ou notas alterados',
    ].filter(Boolean);
    if (layout.length) out.push({ type: 'drawing.layout', text: `${drawing.name}: ${layout.join(', ')}`, ref: id });
  }
  for (const [id, { drawing }] of before.drawings) {
    if (!after.drawings.has(id)) out.push({ type: 'drawing.removed', text: `Desenho removido: ${drawing.name}`, ref: id });
  }

  // Flows
  for (const [id, { flow }] of after.flows) {
    const old = before.flows.get(id)?.flow;
    const steps = allSteps(flow);
    if (!old) {
      out.push({ type: 'flow.added', text: `Novo fluxo: ${flow.name} (${plural(steps.length, 'passo', 'passos')})`, ref: id });
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
    const parts = [
      plus && `${plural(plus, 'passo adicionado', 'passos adicionados')}`,
      minus && `${plural(minus, 'passo removido', 'passos removidos')}`,
      reordered && `${plural(reordered, 'reordenado', 'reordenados')}`,
      edited && `${plural(edited, 'passo alterado', 'passos alterados')}`,
    ].filter(Boolean);
    out.push({ type: 'flow.steps', text: `${flow.name}: ${parts.length ? parts.join(', ') : 'metadados alterados'}`, ref: id });
  }
  for (const [id, { flow }] of before.flows) {
    if (!after.flows.has(id)) out.push({ type: 'flow.removed', text: `Fluxo removido: ${flow.name}`, ref: id });
  }

  return out.sort((a, b) => CHANGE_ORDER.indexOf(a.type) - CHANGE_ORDER.indexOf(b.type));
}
