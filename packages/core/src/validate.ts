import { ALLOWED_PARENTS, type Drawing, type FlowItem } from './schema.js';
import { ancestors, lineOf, resolveEndpoint, walkSteps, type Project, type SourceFile } from './project.js';

export type Severity = 'error' | 'warning';

export interface Problem {
  code: string;
  severity: Severity;
  file: string;
  line?: number;
  message: string;
  /** Model reference the problem is about (entity id, connection ref, `flow#step`). */
  ref?: string;
}

const GENERIC_LABELS = new Set(['', 'sends data to', 'uses', 'calls', 'reads from', 'writes to', 'connects to']);
const DEFAULT_SIZE = { w: 256, h: 128 };
const ACTOR_SIZE = { w: 128, h: 128 };
const MAX_NESTING = 3;

export function nodeSize(project: Project, id: string, node: { w?: number; h?: number }) {
  const base = project.entities.get(id)?.entity.kind === 'actor' ? ACTOR_SIZE : DEFAULT_SIZE;
  return { w: node.w ?? base.w, h: node.h ?? base.h };
}

export function validate(project: Project, extra: Problem[] = []): Problem[] {
  const out: Problem[] = [];
  const add = (code: string, file: SourceFile | string, message: string, path?: (string | number)[], ref?: string) => {
    const f = typeof file === 'string' ? project.files.get(file) : file;
    const filePath = typeof file === 'string' ? file : file.path;
    out.push({ code, severity: code[0] === 'E' ? 'error' : 'warning', file: filePath, line: f && path ? lineOf(f, path) : undefined, message, ref });
  };
  const fileOf = (path: string) => project.files.get(path)!;

  // E001 / E002
  for (const file of project.files.values()) {
    if (file.error) {
      out.push({ code: 'E001', severity: 'error', file: file.path, line: file.error.line, message: file.error.message });
      continue;
    }
    if ((file.kind === 'entity' || file.kind === 'drawing' || file.kind === 'flow') && file.data.id !== file.nameId) {
      add('E002', file, `id "${file.data.id}" diferente do nome do arquivo (${file.nameId})`, ['id'], file.data.id);
    }
  }
  // E003
  for (const dup of project.duplicates) {
    add('E003', dup.file, `${dup.kind} "${dup.id}" duplicado`, dup.kind === 'connection' ? ['connections'] : ['id'], dup.id);
  }

  const catalogIds = {
    technologies: new Set((project.catalog.technologies ?? []).map((t) => t.id)),
    tags: new Set((project.catalog.tags ?? []).map((t) => t.id)),
    teams: new Set((project.catalog.teams ?? []).map((t) => t.id)),
  };
  const checkCatalog = (file: SourceFile, base: (string | number)[], obj: { technologies?: string[]; tags?: string[]; owner?: string }, ref: string) => {
    for (const key of ['technologies', 'tags'] as const) {
      (obj[key] ?? []).forEach((id, i) => {
        if (!catalogIds[key].has(id)) add('E022', file, `${key === 'tags' ? 'tag' : 'tecnologia'} "${id}" não existe em catalog.yaml${list(catalogIds[key])}`, [...base, key, i], ref);
      });
    }
    if (obj.owner && !catalogIds.teams.has(obj.owner)) add('E022', file, `time "${obj.owner}" não existe em catalog.yaml${list(catalogIds.teams)}`, [...base, 'owner'], ref);
  };

  // Entities and connections
  const pairLabels = new Map<string, string>();
  for (const [id, { entity, file: path }] of project.entities) {
    const file = fileOf(path);
    const parentId = entity.parent ?? null;
    if (parentId) {
      const parent = project.entities.get(parentId);
      if (!parent) add('E010', file, `parent "${parentId}" não existe`, ['parent'], id);
      else if (!ALLOWED_PARENTS[entity.kind].includes(parent.entity.kind)) {
        add('E011', file, `${entity.kind} não pode ficar dentro de ${parent.entity.kind} (${parentId}). Pais aceitos: ${ALLOWED_PARENTS[entity.kind].map((k) => k ?? 'raiz').join(', ')}`, ['parent'], id);
      }
      const chain = ancestors(project, id);
      const last = chain[chain.length - 1];
      const lastParent = project.entities.get(last)?.entity.parent;
      if (lastParent && chain.includes(lastParent)) add('E012', file, `ciclo na hierarquia: ${[...chain, lastParent].join(' -> ')}`, ['parent'], id);
    } else if (!ALLOWED_PARENTS[entity.kind].includes(null)) {
      add('E011', file, `${entity.kind} precisa de parent (${ALLOWED_PARENTS[entity.kind].join(', ')})`, ['kind'], id);
    }
    checkCatalog(file, [], entity, id);

    (entity.connections ?? []).forEach((conn, i) => {
      const ref = `${id}.${conn.id}`;
      const base = ['connections', i];
      if (!project.entities.has(conn.to)) add('E020', file, `conexão ${ref}: destino "${conn.to}" não existe`, [...base, 'to'], ref);
      if (conn.via && !project.entities.has(conn.via)) add('E020', file, `conexão ${ref}: via "${conn.via}" não existe`, [...base, 'via'], ref);
      if (conn.to === id) add('E021', file, `conexão ${ref} liga ${id} a ele mesmo`, [...base, 'to'], ref);
      checkCatalog(file, base, conn, ref);
      if (GENERIC_LABELS.has(conn.label.trim().toLowerCase())) add('W004', file, `conexão ${ref} com rótulo ${conn.label.trim() ? `genérico ("${conn.label}")` : 'vazio'}`, [...base, 'label'], ref);
      const pair = [id, conn.to].sort().join('|') + '|' + conn.label.trim().toLowerCase();
      const seen = pairLabels.get(pair);
      if (seen) add('W005', file, `conexões ${seen} e ${ref} entre o mesmo par com o mesmo rótulo "${conn.label}"`, [...base, 'label'], ref);
      else pairLabels.set(pair, ref);
    });
  }

  // Drawings
  const placed = new Set<string>();
  const drawn = new Set<string>();
  for (const [id, { drawing, file: path }] of project.drawings) {
    const file = fileOf(path);
    if (drawing.scope && !project.entities.has(drawing.scope)) add('E033', file, `scope "${drawing.scope}" não existe`, ['scope'], id);
    const nodes = drawing.nodes ?? {};
    for (const [nodeId, node] of Object.entries(nodes)) {
      const entry = project.entities.get(nodeId);
      if (!entry) {
        add('E030', file, `desenho posiciona "${nodeId}", que não existe`, ['nodes', nodeId], nodeId);
        continue;
      }
      placed.add(nodeId);
      if (entry.entity.status === 'removed') add('W006', file, `${nodeId} tem status removed e ainda aparece no desenho`, ['nodes', nodeId], nodeId);
      const g = project.config.grid;
      if (node.x % g || node.y % g || (node.w ?? 0) % g || (node.h ?? 0) % g) add('W011', file, `${nodeId} fora do grid de ${g}px`, ['nodes', nodeId], nodeId);
    }
    for (const ref of Object.keys(drawing.edges ?? {})) {
      const conn = project.connections.get(ref);
      if (!conn) {
        add('E031', file, `desenho traça "${ref}", que não existe${suggest(ref, project.connections.keys())}`, ['edges', ref], ref);
        continue;
      }
      drawn.add(ref);
      const a = resolveEndpoint(project, drawing, conn.from);
      const b = resolveEndpoint(project, drawing, conn.conn.to);
      if (!a || !b) add('E032', file, `${ref}: ${!a ? conn.from : conn.conn.to} nem um ancestral estão no desenho`, ['edges', ref], ref);
    }
    (drawing.groups ?? []).forEach((group, gi) =>
      group.members.forEach((m, mi) => {
        if (!nodes[m]) add('E034', file, `grupo ${group.id}: membro "${m}" não está em nodes`, ['groups', gi, 'members', mi], m);
      }),
    );
    checkLayout(project, drawing, file, add);
  }

  for (const [id, { entity, file }] of project.entities) {
    if (placed.has(id)) continue;
    const hasConnections = (entity.connections?.length ?? 0) > 0 || (project.connectionsTo.get(id)?.length ?? 0) > 0;
    add(hasConnections ? 'W002' : 'W001', file, hasConnections ? `${id} não aparece em nenhum desenho` : `${id} sem conexões e fora de qualquer desenho (órfã)`, ['id'], id);
  }
  for (const [ref, conn] of project.connections) {
    if (!drawn.has(ref)) add('W003', conn.file, `${ref}: fora de qualquer desenho`, connectionPath(project, ref), ref);
  }

  // Flows
  for (const [id, { flow, file: path }] of project.flows) {
    const file = fileOf(path);
    const drawing = project.drawings.get(flow.drawing)?.drawing;
    if (!drawing) add('E043', file, `fluxo aponta para desenho "${flow.drawing}", que não existe${list(new Set(project.drawings.keys()))}`, ['drawing'], id);
    let count = 0;
    const stepIds = new Set<string>();
    walkSteps(flow.steps, ({ step, path: stepPath, depth }) => {
      count++;
      const ref = `${id}#${step.id}`;
      if (stepIds.has(step.id)) add('E003', file, `passo "${step.id}" duplicado`, [...stepPath, 'id'], ref);
      stepIds.add(step.id);
      if (depth > MAX_NESTING) add('E001', file, `aninhamento acima de ${MAX_NESTING} níveis`, stepPath, ref);
      const conn = project.connections.get(step.via);
      if (!conn) {
        add('E040', file, `passo ${step.id}: conexão "${step.via}" não existe${suggest(step.via, project.connections.keys())}`, [...stepPath, 'via'], ref);
        return;
      }
      const bidirectional = conn.conn.direction === 'bidirectional';
      if (step.reverse && !bidirectional) {
        if (step.reply) add('E042', file, `passo ${step.id}: reverse em ${step.via}, que não é bidirectional`, [...stepPath, 'reverse'], ref);
        else add('E041', file, `passo ${step.id} anda na contramão de ${step.via} (${conn.from} -> ${conn.conn.to}). Inverta a conexão ou marque reply: true`, [...stepPath, 'reverse'], ref);
      }
      if (drawing && !drawing.edges?.[step.via]) add('E044', file, `passo ${step.id}: ${step.via} não está traçada no desenho ${flow.drawing}`, [...stepPath, 'via'], ref);
    });
    checkFlowItems(flow.steps, ['steps'], file, add, id);
    if (count + countSubflows(flow.steps) <= 1) add('W020', file, `fluxo ${id} ${count ? 'com um único passo' : 'vazio'}`, ['steps'], id);
  }
  checkSubflowCycles(project, add);

  out.push(...extra);
  return applyRules(project, out);
}

type Add = (code: string, file: SourceFile | string, message: string, path?: (string | number)[], ref?: string) => void;

function checkLayout(project: Project, drawing: Drawing, file: SourceFile, add: Add) {
  const boxes = Object.entries(drawing.nodes ?? {})
    .filter(([id]) => project.entities.has(id))
    .map(([id, n]) => ({ id, x: n.x, y: n.y, ...nodeSize(project, id, n), expanded: n.expanded }));
  const byId = new Map(boxes.map((b) => [b.id, b]));
  for (const box of boxes) {
    const chain = ancestors(project, box.id).slice(1);
    const parent = chain.map((a) => byId.get(a)).find(Boolean);
    if (parent?.expanded && !(box.x >= parent.x && box.y >= parent.y && box.x + box.w <= parent.x + parent.w && box.y + box.h <= parent.y + parent.h)) {
      add('W012', file, `${box.id} fora da moldura de ${parent.id}`, ['nodes', box.id], box.id);
    }
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      // A child drawn inside its expanded ancestor is containment, not overlap.
      if (ancestors(project, a.id).includes(b.id) || ancestors(project, b.id).includes(a.id)) continue;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) add('W010', file, `${a.id} e ${b.id} sobrepostas`, ['nodes', b.id], b.id);
    }
  }
}

function checkFlowItems(items: FlowItem[] | undefined, path: (string | number)[], file: SourceFile, add: Add, flowId: string) {
  (items ?? []).forEach((item, i) => {
    const here = [...path, i];
    if ('parallel' in item) {
      item.parallel.forEach((branch, b) => {
        if (!branch.length) add('W021', file, `ramo ${b + 1} de parallel vazio`, [...here, 'parallel', b], flowId);
        checkFlowItems(branch, [...here, 'parallel', b], file, add, flowId);
      });
    } else if ('alternatives' in item) {
      item.alternatives.forEach((alt, a) => {
        if (!alt.steps.length) add('W021', file, `alternativa "${alt.name}" vazia`, [...here, 'alternatives', a], flowId);
        checkFlowItems(alt.steps, [...here, 'alternatives', a, 'steps'], file, add, flowId);
      });
    }
  });
}

function subflowsOf(items: FlowItem[] | undefined): string[] {
  const out: string[] = [];
  for (const item of items ?? []) {
    if ('subflow' in item) out.push(item.subflow);
    else if ('parallel' in item) item.parallel.forEach((b) => out.push(...subflowsOf(b)));
    else if ('alternatives' in item) item.alternatives.forEach((a) => out.push(...subflowsOf(a.steps)));
  }
  return out;
}
const countSubflows = (items: FlowItem[] | undefined) => subflowsOf(items).length;

function checkSubflowCycles(project: Project, add: Add) {
  const reported = new Set<string>();
  for (const [id, { flow, file }] of project.flows) {
    for (const sub of subflowsOf(flow.steps)) {
      if (!project.flows.has(sub)) add('E043', file, `subflow "${sub}" não existe`, ['steps'], id);
    }
    const stack = [[id]];
    while (stack.length) {
      const path = stack.pop()!;
      const last = path[path.length - 1];
      for (const sub of subflowsOf(project.flows.get(last)?.flow.steps)) {
        if (sub === id) {
          const key = [...path].sort().join('|');
          if (!reported.has(key)) add('E045', file, `ciclo entre subfluxos: ${[...path, id].join(' -> ')}`, ['steps'], id);
          reported.add(key);
        } else if (!path.includes(sub)) stack.push([...path, sub]);
      }
    }
  }
}

function connectionPath(project: Project, ref: string): (string | number)[] {
  const conn = project.connections.get(ref)!;
  const index = project.entities.get(conn.from)!.entity.connections!.findIndex((c) => c.id === conn.conn.id);
  return ['connections', index];
}

function applyRules(project: Project, problems: Problem[]): Problem[] {
  const rules = project.config.rules ?? {};
  return problems
    .filter((p) => rules[p.code] !== 'off')
    .map((p) => (rules[p.code] ? { ...p, severity: rules[p.code] as Severity } : p))
    .sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || a.code.localeCompare(b.code));
}

function list(ids: Set<string>): string {
  if (!ids.size) return '';
  const all = [...ids];
  return `. Válidos: ${all.slice(0, 12).join(', ')}${all.length > 12 ? ', ...' : ''}`;
}

function suggest(ref: string, keys: Iterable<string>): string {
  const [from] = ref.split('.');
  const same = [...keys].filter((k) => k.startsWith(from + '.'));
  return same.length ? `. Conexões de ${from}: ${same.join(', ')}` : '';
}

export const errorsOf = (problems: Problem[]) => problems.filter((p) => p.severity === 'error');
export const warningsOf = (problems: Problem[]) => problems.filter((p) => p.severity === 'warning');

export function formatProblem(p: Problem): string {
  return `${p.file}${p.line ? `:${p.line}` : ''} ${p.code} ${p.severity === 'error' ? 'erro' : 'aviso'}: ${p.message}`;
}
