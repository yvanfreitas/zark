// Pure (no Node imports): shared by core, server and the UI.
// Problems and semantic changes carry a message key + params; the English
// text below is what the CLI, MCP and PR descriptions show. The UI renders
// the same key in the viewer's language (packages/ui/src/i18n).

export type Params = Record<string, string | number | string[]>;
export type Template = (p: Params) => string;

const list = (v: unknown, max = 12) => {
  const all = Array.isArray(v) ? v : [];
  return all.length ? `${all.slice(0, max).join(', ')}${all.length > max ? ', ...' : ''}` : '';
};
/** ". Valid: a, b" when there are valid values to suggest. */
/** ". Sets: lucide, si (own packs in zark.yaml icons.packs)" when the set is unknown. */
const iconSets = (v: unknown) => (list(v) ? `. Sets: ${list(v)} (own packs in zark.yaml icons.packs)` : '');

export const validSuffix = (label: string, v: unknown) => (list(v) ? `. ${label}: ${list(v)}` : '');

export const PROBLEM_EN: Record<string, Template> = {
  'E001.raw': (p) => `${p.detail}`,
  'E001.alias': () => 'anchors and aliases are not allowed',
  'E001.schemaNewer': (p) => `schema ${p.schema} is newer than this Zark (supports ${p.supported}). Upgrade Zark`,
  'E001.schemaOlder': (p) => `schema ${p.schema} is old. Run "zark migrate"`,
  'E001.nesting': (p) => `nesting deeper than ${p.max} levels`,
  E002: (p) => `id "${p.id}" differs from the file name (${p.file})`,
  E003: (p) => `${p.kind} "${p.id}" is duplicated`,
  'E003.step': (p) => `step "${p.id}" is duplicated`,
  E010: (p) => `parent "${p.parent}" does not exist`,
  E011: (p) => `${p.kind} cannot be inside ${p.parentKind} (${p.parent}). Allowed parents: ${list(p.allowed)}`,
  'E011.needsParent': (p) => `${p.kind} needs a parent (${list(p.allowed)})`,
  E012: (p) => `cycle in the hierarchy: ${(p.chain as string[]).join(' -> ')}`,
  E013: (p) => `${p.id} is a ${p.kind}: only components can have a source`,
  E014: (p) => `${p.id}: source "${p.source}" matches no file or folder`,
  'E014.outside': (p) => `${p.id}: source "${p.source}" must be a path inside the repository (no absolute path, no "..")`,
  E015: (p) => `${p.file} is claimed by ${list(p.components)} with equally specific sources`,
  E020: (p) => `connection ${p.ref}: target "${p.target}" does not exist`,
  'E020.via': (p) => `connection ${p.ref}: via "${p.via}" does not exist`,
  E021: (p) => `connection ${p.ref} links ${p.entity} to itself`,
  'E022.technology': (p) => `technology "${p.id}" does not exist in catalog.yaml${validSuffix('Valid', p.valid)}`,
  'E022.tag': (p) => `tag "${p.id}" does not exist in catalog.yaml${validSuffix('Valid', p.valid)}`,
  'E022.team': (p) => `team "${p.id}" does not exist in catalog.yaml${validSuffix('Valid', p.valid)}`,
  E030: (p) => `drawing places "${p.id}", which does not exist`,
  E031: (p) => `drawing draws "${p.ref}", which does not exist${validSuffix(`Connections of ${p.from}`, p.siblings)}`,
  E032: (p) => `${p.ref}: neither ${p.missing} nor an ancestor is in the drawing`,
  E033: (p) => `scope "${p.scope}" does not exist`,
  E034: (p) => `group ${p.group}: member "${p.member}" is not in nodes`,
  E040: (p) => `step ${p.step}: connection "${p.via}" does not exist${validSuffix(`Connections of ${p.from}`, p.siblings)}`,
  E041: (p) => `step ${p.step} goes against ${p.via} (${p.source} -> ${p.target}). Reverse the connection or mark reply: true`,
  E042: (p) => `step ${p.step}: reverse on ${p.via}, which is not bidirectional`,
  E043: (p) => `flow points to drawing "${p.drawing}", which does not exist${validSuffix('Valid', p.valid)}`,
  'E043.subflow': (p) => `subflow "${p.subflow}" does not exist`,
  E044: (p) => `step ${p.step}: ${p.via} is not drawn in drawing ${p.drawing}`,
  E045: (p) => `cycle between subflows: ${(p.chain as string[]).join(' -> ')}`,
  W001: (p) => `${p.id} has no connections and is in no drawing (orphan)`,
  W002: (p) => `${p.id} is in no drawing`,
  W003: (p) => `${p.ref}: not in any drawing`,
  W004: (p) => `connection ${p.ref} has a generic label ("${p.label}")`,
  'W004.empty': (p) => `connection ${p.ref} has an empty label`,
  W005: (p) => `connections ${p.first} and ${p.second} link the same pair with the same label "${p.label}"`,
  W006: (p) => `${p.id} has status removed and still appears in the drawing`,
  W014: (p) => `${p.id} has a source but no generated code graph. Run "zark scan"`,
  W015: (p) => `${p.file} belongs to component "${p.id}", which ${p.reason === 'noSource' ? 'has no source' : 'does not exist'}`,
  W010: (p) => `${p.a} and ${p.b} overlap`,
  W011: (p) => `${p.id} is off the ${p.grid}px grid`,
  W012: (p) => `${p.id} is outside the frame of ${p.parent}`,
  W020: (p) => `flow ${p.id} is empty`,
  'W020.single': (p) => `flow ${p.id} has a single step`,
  'W021.parallel': (p) => `parallel branch ${p.branch} is empty`,
  'W021.alternative': (p) => `alternative "${p.name}" is empty`,
  'W030.orphan': (p) => `${p.file} matches no drawing or flow`,
  W030: (p) => `${p.file} is out of date. Run "zark render"`,
  'W013.label': (p) => `label of ${p.ref} overlaps the label of ${p.other}`,
  'W013.box': (p) => `label of ${p.ref} overlaps the box ${p.box}`,
  W040: (p) => `icon "${p.icon}" does not exist${iconSets(p.sets)}`,
  'W040.technology': (p) => `technology ${p.id}: icon "${p.icon}" does not exist${iconSets(p.sets)}`,
};

const plural = (n: unknown, one: string, many: string) => `${n} ${Number(n) === 1 ? one : many}`;
const andList = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** Semantic diff texts (section 9). Params come from core/diff.ts. */
export const CHANGE_EN: Record<string, Template> = {
  'entity.added': (p) => `Entity added: ${p.name} (${p.kind}${p.external ? ', external' : ''})`,
  'entity.removed': (p) => `Entity removed: ${p.name}`,
  'entity.moved': (p) => `${p.name} moved inside ${p.parent}`,
  'entity.movedRoot': (p) => `${p.name} moved to the root`,
  'entity.changed': (p) => {
    const fields = (p.fields as string[]).map((f) => (f === 'name' ? `name "${p.oldName}" -> "${p.newName}"` : f));
    return `${p.name}: ${andList(fields)} changed`;
  },
  'connection.added': (p) => `New connection: ${p.from} -> ${p.to} ("${p.label}")`,
  'connection.removed': (p) => `Connection removed: ${p.from} -> ${p.to} ("${p.label}")`,
  'connection.reversed': (p) => `Connection reversed: now ${p.from} -> ${p.to}`,
  'connection.changed': (p) => {
    const parts = (p.fields as string[]).map((f) => (f === 'label' ? `label "${p.oldLabel}" -> "${p.newLabel}"` : `${f} changed`));
    return `${p.from} -> ${p.to}: ${parts.join(', ')}`;
  },
  'drawing.added': (p) => `New drawing: ${p.name}`,
  'drawing.removed': (p) => `Drawing removed: ${p.name}`,
  'drawing.content': (p) =>
    `${p.name}: ${[
      Number(p.plusN) && `+${plural(p.plusN, 'entity', 'entities')}`,
      Number(p.minusN) && `-${plural(p.minusN, 'entity', 'entities')}`,
      Number(p.plusE) && `+${plural(p.plusE, 'connection', 'connections')}`,
      Number(p.minusE) && `-${plural(p.minusE, 'connection', 'connections')}`,
    ]
      .filter(Boolean)
      .join(', ')}`,
  'drawing.layout': (p) =>
    `${p.name}: ${[
      Number(p.moved) && plural(p.moved, 'box repositioned', 'boxes repositioned'),
      Number(p.reshaped) && plural(p.reshaped, 'connector adjusted', 'connectors adjusted'),
      Number(p.visual) && 'metadata, groups or notes changed',
    ]
      .filter(Boolean)
      .join(', ')}`,
  'flow.added': (p) => `New flow: ${p.name} (${plural(p.steps, 'step', 'steps')})`,
  'flow.removed': (p) => `Flow removed: ${p.name}`,
  'flow.steps': (p) => {
    const parts = [
      Number(p.plus) && plural(p.plus, 'step added', 'steps added'),
      Number(p.minus) && plural(p.minus, 'step removed', 'steps removed'),
      Number(p.reordered) && `${p.reordered} reordered`,
      Number(p.edited) && plural(p.edited, 'step changed', 'steps changed'),
    ].filter(Boolean);
    return `${p.name}: ${parts.length ? parts.join(', ') : 'metadata changed'}`;
  },
};

export function renderMessage(table: Record<string, Template>, key: string | undefined, params: Params | undefined, fallback: string): string {
  const t = key ? table[key] : undefined;
  if (!t) return fallback;
  try {
    return t(params ?? {});
  } catch {
    return fallback;
  }
}

/** Cascade-delete impact lines shown before confirming (core/ops.ts). */
export const IMPACT_EN: Record<string, Template> = {
  children: (p) => `Children block the deletion: ${list(p.ids, 50)}`,
  incoming: (p) => `Connections removed: ${list(p.refs, 50)}`,
  nodes: (p) => `Drawing ${p.drawing}: removes ${list(p.ids, 50)}`,
  edges: (p) => `Drawing ${p.drawing}: removes connectors ${list(p.refs, 50)}`,
  scope: (p) => `Drawing ${p.drawing}: loses scope ${p.scope}`,
  steps: (p) => `Flow ${p.flow}: removes steps over ${list(p.refs, 50)}`,
  via: (p) => `${p.entity}: removes via from ${list(p.ids, 50)}`,
  edge: (p) => `Drawing ${p.drawing}: removes the connector`,
  stepsOn: (p) => `Flow ${p.flow}: removes the steps over ${p.ref}`,
};
