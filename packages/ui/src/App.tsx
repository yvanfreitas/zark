import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { api, readOnly, subscribe } from './api';
import { Canvas } from './canvas/Canvas';
import { currentDrawing, useStore } from './store';
import { flowView } from './flow';
import { FlowPanel } from './panels/FlowPanel';
import { Inspector } from './panels/Inspector';
import { LeftPanel } from './panels/LeftPanel';
import { CommandPalette, ConfirmDialogView, ShortcutsDialog, Toasts } from './panels/Overlays';
import { MenuHost } from './panels/Menu';
import { deleteSelectionFromModel, drillDown, duplicateDrawing, groupSelection, removeSelectionFromDrawing } from './actions';
import { BottomBar, ChangesPanel, PrDialog, ProblemsPanel } from './panels/Side';
import { TopBar, useGitStatus } from './panels/TopBar';
import { Button } from './panels/ui';
import { ModelList } from './panels/ModelList';
import { DepsView } from './deps/DepsView';
import { pickAndImport } from './importFile';
import { changeText, tr, useT } from './i18n';

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'k') return e.preventDefault(), s.set({ palette: !s.palette });
      if (isTyping(e.target) || s.palette || s.confirm || s.prDialog || s.menu) return;
      if (s.help) {
        if (e.key === 'Escape' || e.key === '?') s.set({ help: false });
        return;
      }
      if (e.key === '?') return e.preventDefault(), s.set({ help: true });
      if (s.view !== 'canvas') {
        if (e.key === 'Escape') s.set({ view: 'canvas' });
        return;
      }
      const drawing = currentDrawing(s);
      const sel = s.selection;
      const view = s.model && s.index ? flowView(s.model, s.index, s.flow) : undefined;

      if (mod && key === 'z') return e.preventDefault(), void (e.shiftKey ? s.redo() : s.undo());
      if (mod && key === 'f') return e.preventDefault(), s.set({ palette: true });
      if (mod && e.shiftKey && key === 'c') return e.preventDefault(), s.select([]), s.requestFocus();
      if (!mod && e.shiftKey && key === 'c') return e.preventDefault(), s.requestFocus();
      if (!mod && e.shiftKey && key === 'n') return e.preventDefault(), window.dispatchEvent(new CustomEvent('zark:quick-create'));
      if (mod && key === 'g') return e.preventDefault(), window.dispatchEvent(new CustomEvent('zark:group'));
      if (mod && key === 'd' && drawing) return e.preventDefault(), duplicateDrawing();
      // The menu key (or Shift+F10) opens the canvas menu for the selection.
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) return e.preventDefault(), window.dispatchEvent(new CustomEvent('zark:context-menu'));

      if (view) {
        if (e.key === 'ArrowRight') return e.preventDefault(), s.setFlow({ frame: Math.min(view.frames.length - 1, view.frame + 1), playing: false });
        if (e.key === 'ArrowLeft') return e.preventDefault(), s.setFlow({ frame: Math.max(0, view.frame - 1), playing: false });
        if (e.key === ' ') return e.preventDefault(), s.setFlow({ playing: !s.flow!.playing });
        if (e.key === 'Escape' && !sel.nodes.length && !sel.edges.length) return s.setFlow(null);
      }

      if (e.key.startsWith('Arrow') && sel.nodes.length && !view) {
        e.preventDefault();
        const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        window.dispatchEvent(new CustomEvent('zark:nudge', { detail: { dx, dy } }));
        return;
      }
      if (e.key === 'Enter' && sel.nodes.length === 1 && s.index?.entities.has(sel.nodes[0])) return e.preventDefault(), drillDown(sel.nodes[0]);
      if (e.key === 'Escape') {
        if (sel.nodes.length || sel.edges.length) return s.select([]);
        return s.up();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && drawing && (sel.nodes.length || sel.edges.length)) {
        e.preventDefault();
        if (e.shiftKey) deleteSelectionFromModel();
        else void removeSelectionFromDrawing();
      }
    };
    const onGroup = () => groupSelection();
    window.addEventListener('keydown', onKey);
    window.addEventListener('zark:group', onGroup);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('zark:group', onGroup);
    };
  }, []);
}

function useLiveUpdates() {
  useEffect(() => {
    // `zark build` site: a snapshot, no server to listen to.
    if (readOnly) return;
    let timer: number | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => void useStore.getState().refresh().catch(() => undefined), 80);
    };
    return subscribe(
      {
        'model.changed': (e: { origin: string; changes: string[]; items?: { key: string; params: Record<string, string | number | string[]>; text: string }[] }) => {
          refresh();
          if (e.origin === 'mcp' || e.origin === 'external') {
            const who = e.origin === 'mcp' ? tr('app.updatedMcp') : tr('app.updatedDisk');
            const texts = e.items ? e.items.map(changeText) : e.changes;
            useStore.getState().toast(texts.length ? `${who}: ${texts.slice(0, 2).join('; ')}${texts.length > 2 ? '…' : ''}` : who);
          }
        },
        'problems.changed': refresh,
        'render.status': (renderStatus) => useStore.getState().set({ renderStatus }),
      },
      (connected) => {
        useStore.getState().setConnected(connected);
        if (connected) {
          refresh();
          void api('GET', '/api/render/status').then((renderStatus) => useStore.getState().set({ renderStatus }), () => undefined);
        }
      },
    );
  }, []);
}

function InvalidFilesBanner() {
  const files = useStore((s) => s.model!.files);
  const invalid = Object.entries(files).filter(([, f]) => f.error);
  const t = useT();
  if (!invalid.length) return null;
  return (
    <div role="alert" className="absolute left-3 right-3 top-3 z-10 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger-soft)] px-3 py-2 text-[12.5px] text-[var(--danger)]">
      {invalid.map(([path, f]) => (
        <div key={path}>
          <span className="font-mono">
            {path}
            {f.error!.line ? `:${f.error!.line}` : ''}
          </span>{' '}
          — {t('app.invalidFile', { message: f.error!.message })}
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  const empty = useStore((s) => !s.model!.entities.length);
  const t = useT();
  if (!empty) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center shadow-sm">
        <div className="text-[15px] font-semibold text-[var(--fg)]">{t('app.emptyTitle')}</div>
        <p className="max-w-[300px] text-[13px] text-[var(--muted)]">{t('app.emptyHint')}</p>
        <div className="flex gap-2">
          <Button onClick={() => window.dispatchEvent(new CustomEvent('zark:quick-create'))}>{t('app.createFirst')}</Button>
          <Button variant="subtle" onClick={pickAndImport} title={t('app.importTitle')}>
            {t('app.import')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const model = useStore((s) => s.model);
  const loadError = useStore((s) => s.loadError);
  const right = useStore((s) => s.right);
  const flow = useStore((s) => s.flow);
  const theme = useStore((s) => s.theme);
  const view = useStore((s) => s.view);
  const git = useGitStatus();
  const hasSelection = useStore((s) => s.selection.nodes.length + s.selection.edges.length > 0);
  const lang = useStore((s) => s.lang);
  const t = useT();
  useShortcuts();
  useLiveUpdates();
  useEffect(() => {
    void useStore.getState().load();
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
  }, [lang]);

  if (loadError)
    return (
      <div className="grid h-screen place-items-center bg-[var(--canvas)] p-6">
        <div className="max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-[14px] text-[var(--fg)]">
          <div className="mb-2 font-semibold">{t('app.openFailed')}</div>
          <p className="text-[var(--muted)]">{loadError}</p>
        </div>
      </div>
    );
  if (!model) return <div className="grid h-screen place-items-center bg-[var(--canvas)] text-[var(--muted)]">{t('app.loading')}</div>;

  return (
    <ReactFlowProvider>
      <div className="flex h-screen flex-col bg-[var(--canvas)] text-[var(--fg)]" data-readonly={readOnly || undefined}>
        <TopBar git={git} />
        <div className="flex min-h-0 flex-1">
          <LeftPanel />
          <main className="relative min-w-0 flex-1" aria-label={view === 'list' ? t('app.mainList') : view === 'deps' ? t('app.mainDeps') : t('app.mainCanvas')}>
            {view === 'list' ? (
              <ModelList />
            ) : view === 'deps' ? (
              <DepsView />
            ) : (
              <>
                <InvalidFilesBanner />
                <EmptyState />
                <Canvas />
              </>
            )}
          </main>
          {/* Outside the canvas the drawing inspector has nothing on screen to describe: show the panel only for a selection or a side view. */}
          {(view === 'canvas' || right !== 'inspector' || hasSelection) && (
            <aside className="w-[340px] shrink-0 overflow-y-auto border-l border-[var(--border)] bg-[var(--panel)]" aria-label={t('app.rightPanel')}>
              {right === 'problems' ? <ProblemsPanel /> : right === 'changes' ? <ChangesPanel git={git} /> : flow && view === 'canvas' ? <FlowPanel /> : <Inspector />}
            </aside>
          )}
        </div>
        <BottomBar />
      </div>
      <CommandPalette />
      <ConfirmDialogView />
      <PrDialog />
      <ShortcutsDialog />
      <MenuHost />
      <Toasts />
    </ReactFlowProvider>
  );
}
