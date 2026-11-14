import { useEffect, useState } from 'react';
import { api, readOnly } from '../api';
import { currentDrawing, useStore } from '../store';
import { setLang, tr, useT, type Lang } from '../i18n';
import { Button, Icon, IconButton, Svg } from './ui';
import { mod } from '../actions';

export interface GitStatus {
  isRepo: boolean;
  branch?: string;
  baseBranch: string;
  changed: { path: string; status: string }[];
  remote?: string;
  behind?: number;
  pr?: { url: string; number: number; state: string };
  provider?: { name: 'github' | 'gitlab'; noun: 'PR' | 'MR' };
}

export function useGitStatus() {
  const [status, setStatus] = useState<GitStatus>();
  const model = useStore((s) => s.model);
  useEffect(() => {
    if (readOnly) return;
    let alive = true;
    const t = setTimeout(() => void api<GitStatus>('GET', '/api/git/status').then((s) => alive && setStatus(s)).catch(() => undefined), 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [model]);
  return status;
}

function Breadcrumb() {
  const index = useStore((s) => s.index)!;
  const drawing = useStore(currentDrawing);
  const openDrawing = useStore((s) => s.openDrawing);
  const t = useT();
  if (!drawing) return null;
  const chain = drawing.scope ? index.ancestors(drawing.scope).reverse() : [];
  const crumbs: { label: string; drawing?: string }[] = [{ label: t('top.root'), drawing: index.drawingsByScope.get(null)?.[0]?.id }];
  for (const id of chain.slice(0, -1)) crumbs.push({ label: index.name(id), drawing: index.drawingsByScope.get(id)?.[0]?.id });
  return (
    <nav aria-label={t('top.navDrawings')} className="flex min-w-[96px] items-center gap-1 text-[13px]">
      {drawing.scope &&
        crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            <button type="button" disabled={!c.drawing} onClick={() => c.drawing && openDrawing(c.drawing, false)} className="truncate text-[var(--muted)] hover:text-[var(--fg)] disabled:hover:text-[var(--muted)]">
              {c.label}
            </button>
            <span className="text-[var(--subtle)]">/</span>
          </span>
        ))}
      <span className="truncate font-semibold text-[var(--fg)]">{drawing.name}</span>
    </nav>
  );
}

function ViewSwitch() {
  const view = useStore((s) => s.view);
  const set = useStore((s) => s.set);
  const t = useT();
  const items: [typeof view, string][] = [
    ['canvas', t('top.viewCanvas')],
    ['list', t('top.viewList')],
    ['deps', t('top.viewDeps')],
  ];
  return (
    <div role="tablist" aria-label={t('top.view')} className="flex gap-0.5 rounded-lg bg-[var(--tabs)] p-0.5">
      {items.map(([id, label]) => (
        <button
          key={id}
          role="tab"
          type="button"
          aria-selected={view === id}
          onClick={() => {
            const s = useStore.getState();
            // Dependencies start from the selected entity when there is one.
            const selected = s.selection.nodes.find((n) => s.index?.entities.has(n));
            set(id === 'deps' && selected ? { view: id, depsOf: selected } : { view: id });
          }}
          className={`rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors ${view === id ? 'bg-[var(--surface)] text-[var(--fg)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--fg)]'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function TopBar({ git }: { git?: GitStatus }) {
  const model = useStore((s) => s.model)!;
  const saving = useStore((s) => s.saving);
  const connected = useStore((s) => s.connected);
  const theme = useStore((s) => s.theme);
  const set = useStore((s) => s.set);
  const t = useT();
  const errors = model.problems.filter((p) => p.severity === 'error').length;
  const warnings = model.problems.length - errors;
  const changed = git?.changed.length ?? 0;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap border-b border-[var(--border)] bg-[var(--surface)] px-3">
      <div className="flex items-center gap-2 pr-2">
        <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
          <rect x="3" y="8" width="12" height="16" rx="3" fill="var(--accent)" />
          <rect x="19" y="8" width="10" height="16" rx="3" fill="var(--accent)" opacity="0.55" />
        </svg>
        <span className="max-w-[160px] truncate text-[14px] font-semibold text-[var(--fg)]">{model.config.name}</span>
      </div>
      <div className="h-5 w-px bg-[var(--border)]" />
      <ViewSwitch />
      <Breadcrumb />
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => set({ palette: true })}
        aria-label={t('top.search')}
        className="hidden min-w-[72px] shrink-[4] basis-[260px] items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-[12.5px] text-[var(--muted)] hover:border-[var(--accent)] md:flex"
      >
        <Svg icon={Icon.search} size={14} />
        <span className="min-w-0 flex-1 truncate text-left">{t('top.search')}</span>
        <kbd className="shrink-0 font-mono text-[11px]">{mod('K')}</kbd>
      </button>
      <div className="flex items-center">
        <IconButton data-edit label={t('top.undo', { keys: mod('Z') })} onClick={() => void useStore.getState().undo()}>
          <Svg icon={Icon.undo} />
        </IconButton>
        <IconButton data-edit label={t('top.redo', { keys: mod('Shift+Z') })} onClick={() => void useStore.getState().redo()}>
          <Svg icon={Icon.redo} />
        </IconButton>
      </div>
      <span className="min-w-[64px] whitespace-nowrap text-[12px] text-[var(--muted)]" aria-live="polite">
        {readOnly ? t('top.readOnly') : !connected ? t('top.offline') : saving === 'saving' ? t('top.saving') : saving === 'saved' ? t('top.saved') : ''}
      </span>
      <button
        type="button"
        onClick={() => set({ right: 'problems' })}
        className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-medium hover:bg-[var(--hover)] ${errors ? 'text-[var(--danger)]' : warnings ? 'text-[var(--warn-fg)]' : 'text-[var(--ok)]'}`}
        title={t('top.problems')}
      >
        <span className={`size-2 rounded-full ${errors ? 'bg-[var(--danger)]' : warnings ? 'bg-[var(--warn)]' : 'bg-[var(--ok)]'}`} />
        {errors ? (errors > 1 ? t('top.errors', { n: errors }) : t('top.error')) : warnings ? (warnings > 1 ? t('top.warnings', { n: warnings }) : t('top.warning')) : t('top.valid')}
      </button>
      {git?.isRepo && (
        <button type="button" onClick={() => set({ right: 'changes' })} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] text-[var(--fg-soft)] hover:bg-[var(--hover)]" title={t('top.changes')}>
          <Svg icon={Icon.branch} size={14} />
          <span className="max-w-[160px] truncate font-mono">{git.branch}</span>
          {changed > 0 && <span className="rounded-full bg-[var(--accent-soft)] px-1.5 text-[11px] font-semibold text-[var(--accent)]">{changed}</span>}
          {!!git.behind && <span className="text-[11px] text-[var(--warn-fg)]">↓{git.behind}</span>}
        </button>
      )}
      {git?.pr && (
        <a href={git.pr.url} target="_blank" rel="noreferrer" className="text-[12.5px] font-medium text-[var(--accent)] hover:underline">
          {git.provider?.noun ?? 'PR'} {git.provider?.name === 'gitlab' ? '!' : '#'}
          {git.pr.number}
        </a>
      )}
      <LangSwitch />
      <IconButton label={t('help.title')} aria-keyshortcuts="?" onClick={() => set({ help: true })}>
        <span aria-hidden="true" className="text-[14px] font-semibold">
          ?
        </span>
      </IconButton>
      <IconButton label={theme === 'dark' ? t('top.themeLight') : t('top.themeDark')} onClick={() => {
        const next = theme === 'dark' ? 'light' : 'dark';
        try {
          localStorage.setItem('zark-theme', next);
        } catch {
          /* ignore */
        }
        set({ theme: next });
      }}>
        <Svg icon={theme === 'dark' ? Icon.sun : Icon.moon} />
      </IconButton>
      <RegenerateButton />
      <Button data-edit onClick={() => set({ prDialog: true })} disabled={!git?.isRepo}>
        {t('top.openPr', { noun: git?.provider?.noun ?? 'PR' })}
      </Button>
    </header>
  );
}

/** Re-renders committed PNGs; enabled only while some are out of date with the model. */
function RegenerateButton() {
  const status = useStore((s) => s.renderStatus);
  const [busy, setBusy] = useState(false);
  const t = useT();
  if (!status || status.commitMode === 'never') return null;
  const count = status.stale.length;
  const title = busy
    ? t('regen.busyTitle')
    : count
      ? t('regen.stale', { files: status.stale.map((s) => `${s.file}${s.reason === 'missing' ? ` ${t('regen.missing')}` : ''}`).join(', ') })
      : t('regen.upToDate');
  const run = async () => {
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; error?: string; written: string[]; status: NonNullable<typeof status> }>('POST', '/api/render/all');
      if (!r.ok) throw new Error(r.error ?? tr('regen.failed'));
      useStore.getState().set({ renderStatus: r.status });
      useStore.getState().toast(tr('regen.done', { n: r.written.length }), 'success');
    } catch (err) {
      useStore.getState().toast(tr('regen.error', { error: (err as Error).message }), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button data-edit variant="subtle" onClick={run} disabled={busy || !count} title={title} aria-label={busy ? t('regen.busyLabel') : count ? t('regen.label', { n: count }) : t('regen.upToDate')}>
      {busy ? t('regen.busy') : t('regen.button')}
      {!busy && count > 0 && <span className="rounded-full bg-[var(--warn-soft)] px-1.5 text-[11px] font-semibold text-[var(--warn-fg)]">{count}</span>}
    </Button>
  );
}

/** EN | PT segmented control; the choice is kept per browser (localStorage). */
function LangSwitch() {
  const lang = useStore((s) => s.lang);
  const t = useT();
  const items: [Lang, string][] = [
    ['en', 'EN'],
    ['pt', 'PT'],
  ];
  return (
    <div role="radiogroup" aria-label={t('top.language')} className="flex gap-0.5 rounded-md bg-[var(--tabs)] p-0.5">
      {items.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={lang === id}
          onClick={() => setLang(id)}
          className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${lang === id ? 'bg-[var(--surface)] text-[var(--fg)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--fg)]'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
