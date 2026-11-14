import { useEffect, useState } from 'react';
import { api, readOnly } from '../api';
import { currentDrawing, useStore } from '../store';
import { Button, Icon, IconButton, Svg } from './ui';

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
  if (!drawing) return null;
  const chain = drawing.scope ? index.ancestors(drawing.scope).reverse() : [];
  const crumbs: { label: string; drawing?: string }[] = [{ label: 'Raiz', drawing: index.drawingsByScope.get(null)?.[0]?.id }];
  for (const id of chain.slice(0, -1)) crumbs.push({ label: index.name(id), drawing: index.drawingsByScope.get(id)?.[0]?.id });
  return (
    <nav aria-label="Navegação de desenhos" className="flex min-w-0 items-center gap-1 text-[13px]">
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
  const items: [typeof view, string][] = [
    ['canvas', 'Canvas'],
    ['list', 'Lista'],
    ['deps', 'Dependências'],
  ];
  return (
    <div role="tablist" aria-label="Visão" className="flex gap-0.5 rounded-lg bg-[var(--tabs)] p-0.5">
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
  const errors = model.problems.filter((p) => p.severity === 'error').length;
  const warnings = model.problems.length - errors;
  const changed = git?.changed.length ?? 0;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-3">
      <div className="flex items-center gap-2 pr-2">
        <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
          <rect x="3" y="8" width="12" height="16" rx="3" fill="var(--accent)" />
          <rect x="19" y="8" width="10" height="16" rx="3" fill="var(--accent)" opacity="0.55" />
        </svg>
        <span className="text-[14px] font-semibold text-[var(--fg)]">{model.config.name}</span>
      </div>
      <div className="h-5 w-px bg-[var(--border)]" />
      <ViewSwitch />
      <Breadcrumb />
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => set({ palette: true })}
        className="hidden min-w-[220px] items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-[12.5px] text-[var(--subtle)] hover:border-[var(--accent)] md:flex"
      >
        <Svg icon={Icon.search} size={14} />
        <span className="flex-1 text-left">Buscar entidades, desenhos, ações</span>
        <kbd className="font-mono text-[11px]">⌘K</kbd>
      </button>
      <div className="flex items-center">
        <IconButton data-edit label="Desfazer (⌘Z)" onClick={() => void useStore.getState().undo()}>
          <Svg icon={Icon.undo} />
        </IconButton>
        <IconButton data-edit label="Refazer (⌘⇧Z)" onClick={() => void useStore.getState().redo()}>
          <Svg icon={Icon.redo} />
        </IconButton>
      </div>
      <span className="min-w-[64px] whitespace-nowrap text-[12px] text-[var(--muted)]" aria-live="polite">
        {readOnly ? 'Somente leitura' : !connected ? 'Offline' : saving === 'saving' ? 'Salvando…' : saving === 'saved' ? 'Salvo' : ''}
      </span>
      <button
        type="button"
        onClick={() => set({ right: 'problems' })}
        className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-medium hover:bg-[var(--hover)] ${errors ? 'text-[var(--danger)]' : warnings ? 'text-[var(--warn-fg)]' : 'text-[var(--ok)]'}`}
        title="Problemas de validação"
      >
        <span className={`size-2 rounded-full ${errors ? 'bg-[var(--danger)]' : warnings ? 'bg-[var(--warn)]' : 'bg-[var(--ok)]'}`} />
        {errors ? `${errors} erro${errors > 1 ? 's' : ''}` : warnings ? `${warnings} aviso${warnings > 1 ? 's' : ''}` : 'Válido'}
      </button>
      {git?.isRepo && (
        <button type="button" onClick={() => set({ right: 'changes' })} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] text-[var(--fg-soft)] hover:bg-[var(--hover)]" title="Alterações">
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
      <IconButton label={theme === 'dark' ? 'Tema claro' : 'Tema escuro'} onClick={() => {
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
      <Button data-edit onClick={() => set({ prDialog: true })} disabled={!git?.isRepo}>
        Abrir {git?.provider?.noun ?? 'PR'}
      </Button>
    </header>
  );
}
