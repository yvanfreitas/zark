import { ALLOWED_PARENTS, type Drawing, type FlowItem } from './schema.js';
import { ancestors, lineOf, resolveEndpoint, walkSteps, type Project, type SourceFile } from './project.js';
import { PROBLEM_EN, type Params } from './messages.js';
import { hasIcon, iconSets } from './icons/registry.js';
import { drawingLabelOverlaps } from './labels.js';

export type Severity = 'error' | 'warning';

export interface Problem {
  code: string;
  severity: Severity;
  file: string;
  line?: number;
  /** English text (CLI, MCP, PR). The UI localizes from `key` + `params`. */
  message: string;
  key?: string;
  params?: Params;
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
  const add: Add = (code, file, key, params, path, ref) => {
    const f = typeof file === 'string' ? project.files.get(file) : file;
    const filePath = typeof file === 'string' ? file : file.path;
    out.push({ code, severity: code[0] === 'E' ? 'error' : 'warning', file: filePath, line: f && path ? lineOf(f, path) : undefined, message: PROBLEM_EN[key](params), key, params, ref });
  };
  const fileOf = (path: string) => project.files.get(path)!;

  // E001 / E002
  for (const file of project.files.values()) {
    if (file.error) {
      const key = file.error.key ?? 'E001.raw';
      const params = file.error.params ?? { detail: file.error.message };
      out.push({ code: 'E001', severity: 'error', file: file.path, line: file.error.line, message: file.error.message, key, params });
      continue;
    }
    if ((file.kind === 'entity' || file.kind === 'drawing' || file.kind === 'flow') && file.data.id !== file.nameId) {
      add('E002', file, 'E002', { id: file.data.id, file: file.nameId }, ['id'], file.data.id);
    }
    if (file.kind === 'code' && file.data.component !== file.nameId) {
      add('E002', file, 'E002', { id: file.data.component, file: file.nameId }, ['component'], file.data.component);
    }
  }
  // E003
  for (const dup of project.duplicates) {
    add('E003', dup.file, 'E003', { kind: dup.kind, id: dup.id }, dup.kind === 'connection' ? ['connections'] : dup.kind === 'code' ? ['component'] : ['id'], dup.id);
  }

  const catalogIds = {
    technologies: new Set((project.catalog.technologies ?? []).map((t) => t.id)),
    tags: new Set((project.catalog.tags ?? []).map((t) => t.id)),
    teams: new Set((project.catalog.teams ?? []).map((t) => t.id)),
  };
  const checkCatalog = (file: SourceFile, base: (string | number)[], obj: { technologies?: string[]; tags?: string[]; owner?: string }, ref: string) => {
    for (const key of ['technologies', 'tags'] as const) {
      (obj[key] ?? []).forEach((id, i) => {
        if (!catalogIds[key].has(id)) add('E022', file, key === 'tags' ? 'E022.tag' : 'E022.technology', { id, valid: [...catalogIds[key]] }, [...base, key, i], ref);
      });
    }
    if (obj.owner && !catalogIds.teams.has(obj.owner)) add('E022', file, 'E022.team', { id: obj.owner, valid: [...catalogIds.teams] }, [...base, 'owner'], ref);
  };

  // W040: technology icons given as <set>:<name>
  const catalogFile = project.files.get('catalog.yaml');
  (project.catalog.technologies ?? []).forEach((t, i) => {
    if (catalogFile && t.icon && /^[a-z0-9-]+:[a-z0-9._-]+$/.test(t.icon) && !hasIcon(project, t.icon)) {
      add('W040', catalogFile, 'W040.technology', { id: t.id, icon: t.icon, sets: unknownSetHint(project, t.icon) }, ['technologies', i, 'icon'], t.id);
    }
  });

  // Entities and connections
  const pairLabels = new Map<string, string>();
  for (const [id, { entity, file: path }] of project.entities) {
    const file = fileOf(path);
    const parentId = entity.parent ?? null;
    if (parentId) {
      const parent = project.entities.get(parentId);
      if (!parent) add('E010', file, 'E010', { parent: parentId }, ['parent'], id);
      else if (!ALLOWED_PARENTS[entity.kind].includes(parent.entity.kind)) {
        add('E011', file, 'E011', { kind: entity.kind, parentKind: parent.entity.kind, parent: parentId, allowed: ALLOWED_PARENTS[entity.kind].map((k) => k ?? 'root') }, ['parent'], id);
      }
      const chain = ancestors(project, id);
      const last = chain[chain.length - 1];
      const lastParent = project.entities.get(last)?.entity.parent;
      if (lastParent && chain.includes(lastParent)) add('E012', file, 'E012', { chain: [...chain, lastParent] }, ['parent'], id);
    } else if (!ALLOWED_PARENTS[entity.kind].includes(null)) {
      add('E011', file, 'E011.needsParent', { kind: entity.kind, allowed: ALLOWED_PARENTS[entity.kind].map((k) => k ?? 'root') }, ['kind'], id);
    }
    checkCatalog(file, [], entity, id);
    if (entity.icon && !hasIcon(project, entity.icon)) add('W040', file, 'W040', { icon: entity.icon, sets: unknownSetHint(project, entity.icon) }, ['icon'], id);

    (entity.connections ?? []).forEach((conn, i) => {
      const ref = `${id}.${conn.id}`;
      const base = ['connections', i];
      if (!project.entities.has(conn.to)) add('E020', file, 'E020', { ref, target: conn.to }, [...base, 'to'], ref);
      if (conn.via && !project.entities.has(conn.via)) add('E020', file, 'E020.via', { ref, via: conn.via }, [...base, 'via'], ref);
      if (conn.to === id) add('E021', file, 'E021', { ref, entity: id }, [...base, 'to'], ref);
      checkCatalog(file, base, conn, ref);
      if (GENERIC_LABELS.has(conn.label.trim().toLowerCase())) add('W004', file, conn.label.trim() ? 'W004' : 'W004.empty', { ref, label: conn.label }, [...base, 'label'], ref);
      const pair = [id, conn.to].sort().join('|') + '|' + conn.label.trim().toLowerCase();
      const seen = pairLabels.get(pair);
      if (seen) add('W005', file, 'W005', { first: seen, second: ref, label: conn.label }, [...base, 'label'], ref);
      else pairLabels.set(pair, ref);
    });
  }

  // Drawings
  const placed = new Set<string>();
  const drawn = new Set<string>();
  for (const [id, { drawing, file: path }] of project.drawings) {
    const file = fileOf(path);
    if (drawing.scope && !project.entities.has(drawing.scope)) add('E033', file, 'E033', { scope: drawing.scope }, ['scope'], id);
    const nodes = drawing.nodes ?? {};
    for (const [nodeId, node] of Object.entries(nodes)) {
      const entry = project.entities.get(nodeId);
      if (!entry) {
        add('E030', file, 'E030', { id: nodeId }, ['nodes', nodeId], nodeId);
        continue;
      }
      placed.add(nodeId);
      if (entry.entity.status === 'removed') add('W006', file, 'W006', { id: nodeId }, ['nodes', nodeId], nodeId);
      const g = project.config.grid;
      if (node.x % g || node.y % g || (node.w ?? 0) % g || (node.h ?? 0) % g) add('W011', file, 'W011', { id: nodeId, grid: g }, ['nodes', nodeId], nodeId);
    }
    for (const ref of Object.keys(drawing.edges ?? {})) {
      const conn = project.connections.get(ref);
      if (!conn) {
        add('E031', file, 'E031', { ref, ...siblings(ref, project.connections.keys()) }, ['edges', ref], ref);
        continue;
      }
      drawn.add(ref);
      const a = resolveEndpoint(project, drawing, conn.from);
      const b = resolveEndpoint(project, drawing, conn.conn.to);
      if (!a || !b) add('E032', file, 'E032', { ref, missing: !a ? conn.from : conn.conn.to }, ['edges', ref], ref);
    }
    (drawing.groups ?? []).forEach((group, gi) =>
      group.members.forEach((m, mi) => {
        if (!nodes[m]) add('E034', file, 'E034', { group: group.id, member: m }, ['groups', gi, 'members', mi], m);
      }),
    );
    checkLayout(project, drawing, file, add);
    // W013: connector labels must not cover each other or other boxes.
    for (const o of drawingLabelOverlaps(project, drawing).overlaps) {
      if (o.with.kind === 'label') add('W013', file, 'W013.label', { ref: o.ref, other: o.with.ref }, ['edges', o.ref], o.ref);
      else add('W013', file, 'W013.box', { ref: o.ref, box: o.with.id }, ['edges', o.ref], o.ref);
    }
  }

  for (const [id, { entity, file }] of project.entities) {
    if (placed.has(id)) continue;
    const hasConnections = (entity.connections?.length ?? 0) > 0 || (project.connectionsTo.get(id)?.length ?? 0) > 0;
    add(hasConnections ? 'W002' : 'W001', file, hasConnections ? 'W002' : 'W001', { id }, ['id'], id);
  }
  for (const [ref, conn] of project.connections) {
    if (!drawn.has(ref)) add('W003', conn.file, 'W003', { ref }, connectionPath(project, ref), ref);
  }

  // Flows
  for (const [id, { flow, file: path }] of project.flows) {
    const file = fileOf(path);
    const drawing = project.drawings.get(flow.drawing)?.drawing;
    if (!drawing) add('E043', file, 'E043', { drawing: flow.drawing, valid: [...project.drawings.keys()] }, ['drawing'], id);
    let count = 0;
    const stepIds = new Set<string>();
    walkSteps(flow.steps, ({ step, path: stepPath, depth }) => {
      count++;
      const ref = `${id}#${step.id}`;
      if (stepIds.has(step.id)) add('E003', file, 'E003.step', { id: step.id }, [...stepPath, 'id'], ref);
      stepIds.add(step.id);
      if (depth > MAX_NESTING) add('E001', file, 'E001.nesting', { max: MAX_NESTING }, stepPath, ref);
      const conn = project.connections.get(step.via);
      if (!conn) {
        add('E040', file, 'E040', { step: step.id, via: step.via, ...siblings(step.via, project.connections.keys()) }, [...stepPath, 'via'], ref);
        return;
      }
      const bidirectional = conn.conn.direction === 'bidirectional';
      if (step.reverse && !bidirectional) {
        if (step.reply) add('E042', file, 'E042', { step: step.id, via: step.via }, [...stepPath, 'reverse'], ref);
        else add('E041', file, 'E041', { step: step.id, via: step.via, source: conn.from, target: conn.conn.to }, [...stepPath, 'reverse'], ref);
      }
      if (drawing && !drawing.edges?.[step.via]) add('E044', file, 'E044', { step: step.id, via: step.via, drawing: flow.drawing }, [...stepPath, 'via'], ref);
    });
    checkFlowItems(flow.steps, ['steps'], file, add, id);
    if (count + countSubflows(flow.steps) <= 1) add('W020', file, count ? 'W020.single' : 'W020', { id }, ['steps'], id);
  }
  checkSubflowCycles(project, add);

  out.push(...extra);
  return applyRules(project, out);
}

type Add = (code: string, file: SourceFile | string, key: string, params: Params, path?: (string | number)[], ref?: string) => void;

function checkLayout(project: Project, drawing: Drawing, file: SourceFile, add: Add) {
  const boxes = Object.entries(drawing.nodes ?? {})
    .filter(([id]) => project.entities.has(id))
    .map(([id, n]) => ({ id, x: n.x, y: n.y, ...nodeSize(project, id, n), expanded: n.expanded }));
  const byId = new Map(boxes.map((b) => [b.id, b]));
  for (const box of boxes) {
    const chain = ancestors(project, box.id).slice(1);
    const parent = chain.map((a) => byId.get(a)).find(Boolean);
    if (parent?.expanded && !(box.x >= parent.x && box.y >= parent.y && box.x + box.w <= parent.x + parent.w && box.y + box.h <= parent.y + parent.h)) {
      add('W012', file, 'W012', { id: box.id, parent: parent.id }, ['nodes', box.id], box.id);
    }
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      // A child drawn inside its expanded ancestor is containment, not overlap.
      if (ancestors(project, a.id).includes(b.id) || ancestors(project, b.id).includes(a.id)) continue;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) add('W010', file, 'W010', { a: a.id, b: b.id }, ['nodes', b.id], b.id);
    }
  }
}

function checkFlowItems(items: FlowItem[] | undefined, path: (string | number)[], file: SourceFile, add: Add, flowId: string) {
  (items ?? []).forEach((item, i) => {
    const here = [...path, i];
    if ('parallel' in item) {
      item.parallel.forEach((branch, b) => {
        if (!branch.length) add('W021', file, 'W021.parallel', { branch: b + 1 }, [...here, 'parallel', b], flowId);
        checkFlowItems(branch, [...here, 'parallel', b], file, add, flowId);
      });
    } else if ('alternatives' in item) {
      item.alternatives.forEach((alt, a) => {
        if (!alt.steps.length) add('W021', file, 'W021.alternative', { name: alt.name }, [...here, 'alternatives', a], flowId);
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
      if (!project.flows.has(sub)) add('E043', file, 'E043.subflow', { subflow: sub }, ['steps'], id);
    }
    const stack = [[id]];
    while (stack.length) {
      const path = stack.pop()!;
      const last = path[path.length - 1];
      for (const sub of subflowsOf(project.flows.get(last)?.flow.steps)) {
        if (sub === id) {
          const key = [...path].sort().join('|');
          if (!reported.has(key)) add('E045', file, 'E045', { chain: [...path, id] }, ['steps'], id);
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

/** Other connections of the same origin, suggested when a ref is wrong. */
function siblings(ref: string, keys: Iterable<string>): Params {
  const [from] = ref.split('.');
  return { from, siblings: [...keys].filter((k) => k.startsWith(from + '.')) };
}

/** Known icon sets, listed only when the icon's set itself is unknown. */
function unknownSetHint(project: Project, ref: string): string[] {
  const set = ref.split(':')[0];
  const sets = iconSets(project).map((s) => s.id);
  return sets.includes(set) ? [] : sets;
}

export const errorsOf = (problems: Problem[]) => problems.filter((p) => p.severity === 'error');
export const warningsOf = (problems: Problem[]) => problems.filter((p) => p.severity === 'warning');

export function formatProblem(p: Problem): string {
  return `${p.file}${p.line ? `:${p.line}` : ''} ${p.code} ${p.severity === 'error' ? 'error' : 'warning'}: ${p.message}`;
}
