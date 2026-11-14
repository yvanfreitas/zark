// Editing actions shared by keyboard shortcuts, the canvas context menu and
// the inspector, so every entry point does exactly the same thing.
import { freeId } from './model';
import { currentDrawing, useStore } from './store';
import { tr } from './i18n';
import type { MenuItem } from './panels/Menu';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** Shortcut text for the platform: `mod('K')` is ⌘K on macOS and Ctrl+K elsewhere. */
export const mod = (key: string) => (isMac ? `⌘${key}` : `Ctrl+${key}`);

const drawingOps = (ops: unknown[]) => {
  const s = useStore.getState();
  const d = currentDrawing(s);
  return d ? s.write('POST', `/api/drawings/${d.id}/ops`, { ops }, [d.file]) : Promise.resolve(undefined);
};

/** What Enter does on an entity: open its inner drawing, offer to create one, or nothing. */
export function innerDrawing(id: string): 'open' | 'create' | undefined {
  const index = useStore.getState().index;
  const e = index?.entities.get(id);
  if (!e) return undefined;
  if (index!.drawingsByScope.get(id)?.[0]) return 'open';
  return e.kind === 'actor' || e.kind === 'component' ? undefined : 'create';
}

/** Enter on an entity: open its inner drawing, offering to create one. */
export function drillDown(id: string) {
  const s = useStore.getState();
  const index = s.index!;
  const inner = index.drawingsByScope.get(id)?.[0];
  if (inner) return s.openDrawing(inner.id);
  const e = index.entities.get(id);
  if (!e || e.kind === 'actor' || e.kind === 'component') return;
  s.set({
    confirm: {
      title: tr('app.innerTitle', { name: e.name }),
      lines: [index.children.get(id)?.length ? tr('app.innerLineChildren', { id: e.id, n: index.children.get(id)!.length }) : tr('app.innerLine', { id: e.id })],
      confirmLabel: tr('app.createDrawing'),
      onConfirm: async () => {
        const drawingId = freeId(e.id, (x) => index.drawings.has(x));
        const children = index.children.get(id) ?? [];
        const r = await s.ops([
          { op: 'drawing.create', drawing: { id: drawingId, name: e.name, scope: id } },
          ...(children.length ? [{ op: 'drawing.place', drawing: drawingId, nodes: children.map((c) => ({ id: c })) }] : []),
        ]);
        if (r) useStore.getState().openDrawing(drawingId);
      },
    },
  });
}

/** Open a flow in flow mode on its drawing. */
export function openFlow(id: string) {
  const s = useStore.getState();
  const flow = s.model?.flows.find((f) => f.id === id);
  if (!flow) return;
  s.openDrawing(flow.drawing);
  s.set({ flow: { id, frame: 0, playing: false, speed: 1, choice: {} }, right: 'inspector' });
}

export function showDependencies(id: string) {
  useStore.getState().set({ view: 'deps', depsOf: id });
}

/** Remove the selection from the drawing: the model is untouched, and a toast says so. */
export async function removeSelectionFromDrawing() {
  const s = useStore.getState();
  const drawing = currentDrawing(s);
  const sel = s.selection;
  if (!drawing) return;
  const ops: unknown[] = [];
  const entities = sel.nodes.filter((n) => drawing.nodes?.[n]);
  if (entities.length) ops.push({ op: 'remove-nodes', ids: entities });
  if (sel.edges.length) ops.push({ op: 'remove-edges', refs: sel.edges });
  for (const n of sel.nodes) {
    if (n.startsWith('note:')) ops.push({ op: 'remove-note', id: n.slice(5) });
    if (n.startsWith('group:')) ops.push({ op: 'remove-group', id: n.slice(6) });
  }
  if (!ops.length) return;
  const r = await drawingOps(ops);
  if (!r) return;
  s.select([]);
  // Entities and connections live on in the model: say it, since nothing else on screen does.
  if (entities.length || sel.edges.length) s.toast(tr('act.removedKept', { undo: mod('Z') }));
}

/** Delete the selected entity or connection from the model: always confirmed, impact shown by the core. */
export function deleteSelectionFromModel() {
  const s = useStore.getState();
  const sel = s.selection;
  const index = s.index;
  if (!index) return;
  if (sel.nodes.length === 1 && !sel.edges.length && index.entities.has(sel.nodes[0])) {
    const ent = index.entities.get(sel.nodes[0])!;
    return void s.deleteWithImpact(`/api/entities/${ent.id}`, ent.name, [ent.file]);
  }
  if (sel.edges.length === 1 && !sel.nodes.length && index.conns.has(sel.edges[0])) {
    const c = index.conns.get(sel.edges[0])!;
    return void s.deleteWithImpact(`/api/connections/${c.ref}`, tr('common.theConnection', { label: c.conn.label }), [c.file]);
  }
  s.toast(tr('act.deleteOne'));
}

/** Wrap the selected boxes in a visual group (a frame of this drawing only). */
export function groupSelection() {
  const s = useStore.getState();
  const drawing = currentDrawing(s);
  const members = s.selection.nodes.filter((n) => drawing?.nodes?.[n]);
  if (!drawing || !members.length) return;
  const id = freeId('grupo', (x) => !!drawing.groups?.some((g) => g.id === x));
  void drawingOps([{ op: 'set-group', group: { id, label: tr('common.group'), members, style: 'dashed' } }]).then((r) => r && s.select([`group:${id}`]));
}

export function duplicateDrawing() {
  const s = useStore.getState();
  const drawing = currentDrawing(s);
  if (!drawing) return;
  const id = freeId(`${drawing.id}-copia`, (x) => !!s.index?.drawings.has(x));
  void s
    .ops([
      { op: 'drawing.create', drawing: { id, name: tr('common.copyName', { name: drawing.name }), description: drawing.description, scope: drawing.scope ?? null } },
      { op: 'drawing.place', drawing: id, nodes: Object.entries(drawing.nodes ?? {}).map(([nid, n]) => ({ id: nid, ...n })) },
      { op: 'drawing.draw-edges', drawing: id, edges: Object.entries(drawing.edges ?? {}).map(([ref, ed]) => ({ ref, ...ed })) },
    ])
    .then((r) => r && s.openDrawing(id));
}

/** New note at a canvas position, or above the top-left box when none is given. */
export function addNote(at?: { x: number; y: number }) {
  const s = useStore.getState();
  const drawing = currentDrawing(s);
  if (!drawing) return;
  const id = freeId(tr('insp.noteId'), (x) => !!drawing.notes?.some((n) => n.id === x));
  const xs = Object.values(drawing.nodes ?? {}).map((n) => n.x);
  const ys = Object.values(drawing.nodes ?? {}).map((n) => n.y);
  const pos = at ?? { x: xs.length ? Math.min(...xs) : 0, y: ys.length ? Math.min(...ys) - 120 : 0 };
  void drawingOps([{ op: 'set-note', note: { id, text: tr('insp.newNoteText'), ...pos, w: 200 } }]).then((r) => r && s.select([`note:${id}`]));
}

export function autoLayout(ids?: string[]) {
  const s = useStore.getState();
  const drawing = currentDrawing(s);
  if (drawing) void s.write('POST', `/api/drawings/${drawing.id}/layout`, ids ? { ids } : {}, [drawing.file]);
}

const SHAPES = [
  ['straight', 'insp.shapeStraight'],
  ['step', 'insp.shapeStep'],
  ['curved', 'insp.shapeCurved'],
  ['auto', 'insp.shapeAuto'],
] as const;

/**
 * Actions for what is selected, in the order the canvas menu and the
 * inspector's "more actions" button show them.
 */
export function selectionMenu(): MenuItem[] {
  const s = useStore.getState();
  const index = s.index;
  const drawing = currentDrawing(s);
  const { nodes, edges } = s.selection;
  if (!index || !drawing) return [];
  const remove: MenuItem = { label: tr('insp.removeFromDrawing'), shortcut: 'Del', run: () => void removeSelectionFromDrawing() };
  const del: MenuItem = { label: tr('menu.deleteFromModel'), shortcut: 'Shift+Del', danger: true, run: deleteSelectionFromModel };
  const zoom: MenuItem = { label: tr('menu.zoomSelection'), shortcut: 'Shift+C', run: s.requestFocus };

  if (edges.length === 1 && !nodes.length) {
    const conn = index.conns.get(edges[0]);
    const edge = drawing.edges?.[edges[0]];
    if (!conn) return [];
    const edgeOp = (set: Record<string, unknown>, unset: string[] = []) => void drawingOps([{ op: 'update-edge', ref: conn.ref, set, unset }]);
    return [
      { label: tr('menu.reverse'), run: () => void s.write('PATCH', `/api/connections/${conn.ref}`, { reverse: true }, [conn.file]) },
      ...(edge
        ? [
            { heading: tr('menu.shape') },
            ...SHAPES.map(([shape, key]): MenuItem => ({ label: tr(key), checked: (edge.shape ?? 'straight') === shape, radio: true, run: () => edgeOp({ shape }) })),
            ...(edge.points?.length ? [{ label: tr('insp.clearPoints'), run: () => edgeOp({}, ['points']) }] : []),
            { separator: true } as MenuItem,
            remove,
          ]
        : [{ separator: true } as MenuItem]),
      del,
    ];
  }

  const placed = nodes.filter((n) => drawing.nodes?.[n]);
  if (nodes.length > 1) {
    return [
      { label: tr('insp.groupSel'), shortcut: mod('G'), disabled: !placed.length, run: groupSelection },
      { label: tr('insp.layoutSel'), disabled: placed.length < 2, run: () => autoLayout(placed) },
      zoom,
      { separator: true },
      { ...remove, label: tr('menu.removeN', { n: nodes.length + edges.length }) },
    ];
  }
  if (nodes.length !== 1) return [];
  const id = nodes[0];

  if (id.startsWith('group:')) {
    const g = drawing.groups?.find((x) => x.id === id.slice(6));
    if (!g) return [];
    const style = (v: 'dashed' | 'solid'): MenuItem => ({ label: tr(v === 'dashed' ? 'insp.dashed' : 'insp.solid'), checked: (g.style ?? 'dashed') === v, radio: true, run: () => void drawingOps([{ op: 'set-group', group: { ...g, style: v } }]) });
    return [{ heading: tr('insp.frame') }, style('dashed'), style('solid'), { separator: true }, { label: tr('insp.removeGroup'), shortcut: 'Del', danger: true, run: () => void removeSelectionFromDrawing() }];
  }
  if (id.startsWith('note:')) return [{ label: tr('insp.removeNote'), shortcut: 'Del', danger: true, run: () => void removeSelectionFromDrawing() }];

  const inner = innerDrawing(id);
  return [
    ...(inner ? [{ label: tr(inner === 'open' ? 'menu.openInner' : 'menu.createInner'), shortcut: 'Enter', run: () => drillDown(id) }] : []),
    { label: tr('insp.viewDeps'), run: () => showDependencies(id) },
    ...(placed.length ? [zoom, { separator: true } as MenuItem, remove] : [{ separator: true } as MenuItem]),
    del,
  ];
}

/** Actions for the empty canvas: `at` is the clicked point in drawing coordinates. */
export function canvasMenu(at: { x: number; y: number }, newEntity: () => void): MenuItem[] {
  const s = useStore.getState();
  return [
    { label: tr('menu.newEntity'), shortcut: 'Shift+N', run: newEntity },
    { label: tr('menu.newNote'), run: () => addNote(at) },
    { separator: true },
    { label: tr('insp.autoLayout'), run: () => autoLayout() },
    { label: tr('palette.fit'), shortcut: mod('Shift+C'), run: () => (s.select([]), s.requestFocus()) },
    { separator: true },
    { label: tr('palette.undo'), shortcut: mod('Z'), run: () => void s.undo() },
    { label: tr('palette.redo'), shortcut: mod('Shift+Z'), run: () => void s.redo() },
    { separator: true },
    { label: tr('help.title'), shortcut: '?', run: () => s.set({ help: true }) },
  ];
}
