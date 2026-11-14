import { create } from 'zustand';
import { playbackFrames } from '@core/flow-text';
import { api, ApiError, getModel, readOnly, type WriteResult } from './api';
import { buildIndex, type Index } from './model';
import { impactText, initialLang, problemText, tr, type Lang } from './i18n';
import type { Model } from './types';
import type { MenuItem } from './panels/Menu';

export type FilterState = 'highlight' | 'hide';
export type RightPanel = 'inspector' | 'problems' | 'changes';
export type MainView = 'canvas' | 'list' | 'deps';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
  /** Bold first line; `text` then reads as the detail. */
  title?: string;
  /** One line per reason (refused writes list every problem). */
  lines?: string[];
}

export interface ConfirmDialog {
  title: string;
  lines: string[];
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

export interface FlowState {
  id: string;
  frame: number;
  playing: boolean;
  speed: number;
  choice: Record<string, number>;
}

interface State {
  model?: Model;
  index?: Index;
  loadError?: string;
  connected: boolean;
  drawingId?: string;
  trail: string[];
  selection: { nodes: string[]; edges: string[] };
  flow: FlowState | null;
  saving: 'idle' | 'saving' | 'saved';
  toasts: Toast[];
  right: RightPanel;
  /** What the central area shows: the drawing, the model list or a dependency view. */
  view: MainView;
  depsOf?: string;
  depsLevels: number;
  leftTab: 'drawings' | 'model';
  filters: Record<string, FilterState>;
  palette: boolean;
  confirm?: ConfirmDialog;
  prDialog: boolean;
  /** Keyboard shortcuts overlay. */
  help: boolean;
  /** Context menu open at a screen position (canvas right-click, "more actions" buttons). */
  menu?: { x: number; y: number; items: MenuItem[] };
  /** Reasons the last write was refused; cleared by the next write. Forms show it inline. */
  refusal?: string[];
  theme: 'light' | 'dark';
  focusRequest: number;
  readOnly: boolean;
  lang: Lang;
  /** Committed PNGs out of date with the model (server: GET /api/render/status). */
  renderStatus?: { commitMode: 'pr' | 'always' | 'never'; stale: { file: string; reason: 'outdated' | 'missing' }[] };
}

/** `inline`: the caller shows `refusal` next to its own form, so no toast is raised. */
export interface WriteOptions {
  inline?: boolean;
}

interface Actions {
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  setConnected: (v: boolean) => void;
  openDrawing: (id: string, push?: boolean) => void;
  up: () => void;
  select: (nodes: string[], edges?: string[]) => void;
  toast: (text: string, kind?: Toast['kind'], extra?: Pick<Toast, 'title' | 'lines'>) => void;
  dismiss: (id: number) => void;
  /** Sends a write; returns the result, or undefined when it failed (a toast explains why). */
  write: (method: string, path: string, body?: unknown, files?: string[], opts?: WriteOptions) => Promise<WriteResult | undefined>;
  ops: (ops: unknown[], files?: string[], opts?: WriteOptions) => Promise<WriteResult | undefined>;
  /** Delete with cascade: asks first when the core reports impact. */
  deleteWithImpact: (path: string, label: string, files?: string[]) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  set: (patch: Partial<State>) => void;
  setFlow: (patch: Partial<FlowState> | null) => void;
  requestFocus: () => void;
}

let toastId = 0;

const initialTheme = (): 'light' | 'dark' => {
  const fromUrl = new URLSearchParams(location.search).get('theme');
  if (fromUrl === 'dark' || fromUrl === 'light') return fromUrl;
  try {
    const saved = localStorage.getItem('zark-theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* ignore */
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const useStore = create<State & Actions>((set, get) => ({
  connected: false,
  trail: [],
  selection: { nodes: [], edges: [] },
  flow: null,
  saving: 'idle',
  toasts: [],
  right: 'inspector',
  view: 'canvas',
  depsLevels: 1,
  leftTab: 'drawings',
  filters: {},
  palette: false,
  prDialog: false,
  help: false,
  theme: initialTheme(),
  focusRequest: 0,
  readOnly,
  lang: initialLang(),

  async load() {
    try {
      const model = await getModel();
      const index = buildIndex(model);
      const hash = new URLSearchParams(location.hash.slice(1));
      const fromHash = hash.get('drawing');
      const drawingId =
        (fromHash && index.drawings.has(fromHash) && fromHash) ||
        (model.config.defaultDrawing && index.drawings.has(model.config.defaultDrawing) ? model.config.defaultDrawing : model.drawings[0]?.id);
      set({ model, index, drawingId, loadError: undefined });
      const flowId = hash.get('flow');
      if (flowId && model.flows.some((f) => f.id === flowId)) {
        const flow = model.flows.find((f) => f.id === flowId)!;
        const stepId = hash.get('step');
        const frames = playbackFrames(flow.steps, {}, (id) => model.flows.find((f) => f.id === id)?.steps);
        const frame = Math.max(0, frames.findIndex((fr) => fr.some((s) => s.id === stepId)));
        set({ drawingId: flow.drawing, flow: { id: flowId, frame, playing: false, speed: 1, choice: {} } });
      }
    } catch (err) {
      set({ loadError: (err as Error).message });
    }
  },

  async refresh() {
    const model = await getModel();
    const index = buildIndex(model);
    const { drawingId, selection, flow } = get();
    set({
      model,
      index,
      drawingId: drawingId && index.drawings.has(drawingId) ? drawingId : model.drawings[0]?.id,
      selection: {
        nodes: selection.nodes.filter((n) => index.entities.has(n) || n.startsWith('note:') || n.startsWith('group:')),
        edges: selection.edges.filter((e) => index.conns.has(e)),
      },
      flow: flow && model.flows.some((f) => f.id === flow.id) ? flow : null,
    });
  },

  setConnected: (connected) => set({ connected }),

  openDrawing(id, push = true) {
    const { drawingId, trail } = get();
    // Opening a drawing always brings the canvas back from the list/deps views.
    if (get().view !== 'canvas') set({ view: 'canvas' });
    if (id === drawingId) return;
    set({ drawingId: id, trail: push && drawingId ? [...trail, drawingId] : trail, selection: { nodes: [], edges: [] }, flow: null });
    history.replaceState(null, '', `#drawing=${id}`);
  },

  up() {
    const { trail, index, drawingId } = get();
    if (trail.length) {
      const prev = trail[trail.length - 1];
      set({ drawingId: prev, trail: trail.slice(0, -1), selection: { nodes: [], edges: [] }, flow: null });
      return;
    }
    // No history: go to a drawing of the parent scope.
    const scope = drawingId ? index?.drawings.get(drawingId)?.scope : null;
    if (!scope || !index) return;
    const parent = index.entities.get(scope)?.parent ?? null;
    const target = index.drawingsByScope.get(parent)?.[0];
    if (target) get().openDrawing(target.id, false);
  },

  select: (nodes, edges = []) => set({ selection: { nodes, edges }, right: 'inspector' }),

  toast(text, kind = 'info', extra = {}) {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text, kind, ...extra }] });
    // Errors with a list of reasons need reading time; they can also be dismissed by hand.
    setTimeout(() => get().dismiss(id), extra.lines?.length ? 15000 : kind === 'error' ? 8000 : 3500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  async write(method, path, body, files = [], opts = {}) {
    if (get().readOnly) {
      get().toast(tr('store.readOnly'), 'info');
      return undefined;
    }
    const { model } = get();
    const ifMatch = files
      .filter((f) => model?.files[f])
      .map((f) => `${f}=${model!.files[f].hash}`)
      .join(', ');
    set({ saving: 'saving', refusal: undefined });
    try {
      const result = await api<WriteResult>(method, path, body, ifMatch ? { 'if-match': ifMatch } : {});
      if (result.conflict) {
        get().toast(tr('store.conflict', { file: result.conflict.file }), 'error');
        await get().refresh();
        set({ saving: 'idle' });
        return undefined;
      }
      if (result.impact) {
        set({ saving: 'idle' });
        return result;
      }
      if (!result.ok) {
        const lines = result.problems?.length ? result.problems.map((p) => `${p.code}: ${problemText(p)}`) : [result.error ?? tr('store.opRefused')];
        if (!opts.inline) get().toast(tr('store.refusedHint'), 'error', { title: tr('store.refusedTitle'), lines });
        set({ saving: 'idle', refusal: lines });
        return undefined;
      }
      set({ saving: 'saved' });
      await get().refresh();
      return result;
    } catch (err) {
      set({ saving: 'idle' });
      get().toast(err instanceof ApiError ? err.message : tr('store.network', { error: (err as Error).message }), 'error');
      return undefined;
    }
  },

  ops: (ops, files, opts) => get().write('POST', '/api/ops', { ops }, files, opts),

  async deleteWithImpact(path, label, files) {
    const first = await get().write('DELETE', path, undefined, files);
    if (!first?.impact) return;
    set({
      confirm: {
        title: tr('store.deleteTitle', { label }),
        lines: first.impactItems ? first.impactItems.map(impactText) : first.impact,
        confirmLabel: tr('store.cascade'),
        danger: true,
        onConfirm: async () => {
          await get().write('DELETE', `${path}${path.includes('?') ? '&' : '?'}cascade=true`, undefined, files);
        },
      },
    });
  },

  async undo() {
    const r = await api('POST', '/api/undo').catch((e) => ({ ok: false, error: e.message }));
    if (!r.ok) get().toast(r.error === 'Nothing to undo' ? tr('store.nothingUndo') : r.error, 'info');
    else await get().refresh();
  },
  async redo() {
    const r = await api('POST', '/api/redo').catch((e) => ({ ok: false, error: e.message }));
    if (!r.ok) get().toast(r.error === 'Nothing to undo' ? tr('store.nothingRedo') : r.error, 'info');
    else await get().refresh();
  },

  set: (patch) => set(patch),
  setFlow: (patch) => set({ flow: patch === null ? null : { ...(get().flow ?? { id: '', frame: 0, playing: false, speed: 1, choice: {} }), ...patch } }),
  requestFocus: () => set({ focusRequest: get().focusRequest + 1 }),
}));

export const currentDrawing = (s: State) => (s.drawingId ? s.index?.drawings.get(s.drawingId) : undefined);
