import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { changeText, problemText, tr, useT } from '../i18n';
import type { Problem } from '../types';
import type { GitStatus } from './TopBar';
import { Button, Icon, IconButton, inputClass, SectionTitle, Svg } from './ui';

/** Focuses the model item a problem is about: drawing, entity, connection or flow step. */
function focusProblem(p: Problem) {
  const s = useStore.getState();
  const index = s.index!;
  const model = s.model!;
  const ref = p.ref ?? '';
  if (ref.includes('#')) {
    const flowId = ref.split('#')[0];
    const flow = model.flows.find((f) => f.id === flowId);
    if (flow) {
      s.openDrawing(flow.drawing);
      s.set({ flow: { id: flowId, frame: 0, playing: false, speed: 1, choice: {} } });
      return;
    }
  }
  const drawingFromFile = p.file.startsWith('drawings/') ? p.file.slice(9, -5) : undefined;
  if (drawingFromFile && index.drawings.has(drawingFromFile)) s.openDrawing(drawingFromFile);
  if (index.conns.has(ref)) {
    const where = index.connDrawings.get(ref)?.[0];
    if (where && !drawingFromFile) s.openDrawing(where);
    s.select([], [ref]);
  } else if (index.entities.has(ref)) {
    const current = s.drawingId ? index.drawings.get(s.drawingId) : undefined;
    if (!current?.nodes?.[ref]) {
      const where = index.entityDrawings.get(ref)?.[0];
      if (where) s.openDrawing(where);
    }
    s.select([ref]);
    s.requestFocus();
  }
  s.set({ right: 'inspector' });
}

export function ProblemsPanel() {
  const problems = useStore((s) => s.model!.problems);
  const t = useT();
  const byFile = new Map<string, Problem[]>();
  for (const p of problems) byFile.set(p.file, [...(byFile.get(p.file) ?? []), p]);
  return (
    <div className="p-4">
      <PanelHeader title={t('problems.title', { n: problems.length })} />
      {!problems.length && <p className="py-8 text-center text-[13px] text-[var(--ok)]">{t('problems.none')}</p>}
      {[...byFile].map(([file, list]) => (
        <div key={file} className="mb-3">
          <SectionTitle>{file}</SectionTitle>
          <ul className="flex flex-col gap-0.5">
            {list.map((p, i) => (
              <li key={i}>
                <button type="button" onClick={() => focusProblem(p)} className="flex w-full gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-[var(--hover)]">
                  <span className={`mt-0.5 shrink-0 font-mono text-[11px] font-semibold ${p.severity === 'error' ? 'text-[var(--danger)]' : 'text-[var(--warn-fg)]'}`}>{p.code}</span>
                  <span className="min-w-0 text-[12.5px] text-[var(--fg-soft)]">
                    {problemText(p)}
                    {p.line && <span className="ml-1 font-mono text-[11px] text-[var(--muted)]">:{p.line}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function PanelHeader({ title }: { title: string }) {
  const t = useT();
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="text-[15px] font-semibold text-[var(--fg)]">{title}</h2>
      <IconButton label={t('common.close')} onClick={() => useStore.getState().set({ right: 'inspector' })}>
        <Svg icon={Icon.close} />
      </IconButton>
    </div>
  );
}

export function ChangesPanel({ git }: { git?: GitStatus }) {
  const model = useStore((s) => s.model);
  const t = useT();
  const [diff, setDiff] = useState<{ base: string; changes: { type: string; text: string; key?: string; params?: Record<string, string | number | string[]> }[]; error?: string }>();
  useEffect(() => {
    void api('GET', '/api/diff')
      .then(setDiff)
      .catch((e) => setDiff({ base: '', changes: [], error: e.message }));
  }, [model]);
  const discard = (path: string) =>
    useStore.getState().set({
      confirm: {
        title: tr('changes.discardTitle', { path }),
        lines: [tr('changes.discardLine')],
        confirmLabel: tr('changes.discard'),
        danger: true,
        onConfirm: async () => {
          try {
            await api('POST', '/api/git/discard', { files: [path] });
            await useStore.getState().refresh();
          } catch (e) {
            useStore.getState().toast((e as Error).message, 'error');
          }
        },
      },
    });
  return (
    <div className="p-4">
      <PanelHeader title={t('changes.title')} />
      {!git?.isRepo && <p className="text-[13px] text-[var(--muted)]">{t('changes.noRepo')}</p>}
      {diff && (
        <>
          <SectionTitle>{t('changes.semantic')} {diff.base && <span className="font-mono normal-case">vs {diff.base}</span>}</SectionTitle>
          {diff.error && <p className="text-[12.5px] text-[var(--danger)]">{diff.error}</p>}
          <ul className="flex flex-col gap-1">
            {diff.changes.map((c, i) => (
              <li key={i} className="rounded-md px-1.5 py-1 text-[13px] text-[var(--fg)]">
                {changeText(c)}
              </li>
            ))}
            {!diff.changes.length && !diff.error && <li className="px-1.5 text-[12.5px] text-[var(--muted)]">{t('changes.none')}</li>}
          </ul>
        </>
      )}
      {git?.isRepo && (
        <>
          <SectionTitle>{t('changes.files', { n: git.changed.length })}</SectionTitle>
          <ul>
            {git.changed.map((f) => (
              <li key={f.path} className="flex items-center gap-2 px-1.5 py-1 text-[12.5px]">
                <span className="w-5 font-mono text-[11px] text-[var(--muted)]">{f.status}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[var(--fg-soft)]">{f.path}</span>
                <button type="button" className="text-[11.5px] text-[var(--muted)] hover:text-[var(--danger)]" onClick={() => discard(f.path)}>
                  {t('changes.discard')}
                </button>
              </li>
            ))}
          </ul>
          <Button className="mt-4 w-full" onClick={() => useStore.getState().set({ prDialog: true })}>
            {t('top.openPr', { noun: git.provider?.noun ?? 'PR' })}
          </Button>
        </>
      )}
    </div>
  );
}

interface Preview {
  ok: boolean;
  blockers: string[];
  branch: string;
  base: string;
  title: string;
  body: string;
  files: string[];
  images: { drawing: string; name: string; hasBefore: boolean }[];
  existingPr?: { url: string; number: number; state: string };
  provider?: { name: 'github' | 'gitlab'; noun: 'PR' | 'MR' };
}

/** Preview, then explicit confirmation; nothing leaves the machine before "Create PR". */
export function PrDialog() {
  const open = useStore((s) => s.prDialog);
  const set = useStore((s) => s.set);
  const [preview, setPreview] = useState<Preview>();
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url: string; updated: boolean }>();
  const [error, setError] = useState<string>();
  const t = useT();

  useEffect(() => {
    if (!open) return;
    setPreview(undefined);
    setResult(undefined);
    setError(undefined);
    void api<Preview>('POST', '/api/pr/preview', {})
      .then((p) => {
        setPreview(p);
        setTitle(p.title);
      })
      .catch((e) => setError(e.message));
  }, [open]);
  if (!open) return null;
  const noun = preview?.provider?.noun ?? 'PR';
  const close = () => set({ prDialog: false });
  const create = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api('POST', '/api/pr', { title, context });
      if (r.ok) setResult(r);
      else setError(r.error);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div role="dialog" aria-label={t('pr.dialog')} className="flex max-h-[88vh] w-[640px] max-w-[94vw] flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="border-b border-[var(--border)] p-4">
          <h2 className="text-[15px] font-semibold text-[var(--fg)]">{preview?.existingPr ? t('pr.update', { noun, number: `${noun === 'MR' ? '!' : '#'}${preview.existingPr.number}` }) : noun === 'MR' ? t('pr.openMr') : t('pr.openPr')}</h2>
          {preview && (
            <p className="mt-0.5 font-mono text-[12px] text-[var(--muted)]">
              {preview.branch} → {preview.base}
            </p>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!preview && !error && <p className="text-[13px] text-[var(--muted)]">{t('pr.loading')}</p>}
          {error && <p className="whitespace-pre-wrap rounded-md bg-[var(--danger-soft)] p-3 text-[13px] text-[var(--danger)]">{error}</p>}
          {result && (
            <p className="rounded-md bg-[var(--accent-soft)] p-3 text-[13px] text-[var(--fg)]">
              {result.updated ? t('pr.updated', { noun }) : t('pr.created', { noun })}{' '}
              <a className="font-medium text-[var(--accent)] underline" href={result.url} target="_blank" rel="noreferrer">
                {result.url}
              </a>
            </p>
          )}
          {preview && !result && (
            <div className="flex flex-col gap-3">
              {preview.blockers.length > 0 && (
                <ul className="flex flex-col gap-1 rounded-md bg-[var(--warn-soft)] p-3 text-[12.5px] text-[var(--warn-fg)]">
                  {preview.blockers.map((b) => (
                    <li key={b}>• {b}</li>
                  ))}
                </ul>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] font-medium text-[var(--muted)]">{t('pr.titleField')}</span>
                <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] font-medium text-[var(--muted)]">{t('pr.context')}</span>
                <textarea className={`${inputClass} min-h-[64px]`} value={context} onChange={(e) => setContext(e.target.value)} />
              </label>
              <div>
                <span className="text-[11.5px] font-medium text-[var(--muted)]">{t('pr.body')}</span>
                <pre className="mt-1 max-h-[220px] overflow-auto whitespace-pre-wrap rounded-md bg-[var(--panel)] p-3 font-mono text-[11.5px] text-[var(--fg-soft)]">{preview.body}</pre>
              </div>
              {preview.images.length > 0 && <p className="text-[12.5px] text-[var(--muted)]">{t('pr.images', { names: preview.images.map((i) => i.name).join(', ') })}</p>}
              <p className="text-[12.5px] text-[var(--muted)]">{t('pr.files', { files: preview.files.length ? preview.files.join(', ') : t('common.none') })}</p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] p-3">
          <Button variant="ghost" onClick={close} disabled={busy}>
            {result ? t('common.close') : t('common.cancel')}
          </Button>
          {!result && (
            <Button onClick={create} disabled={!preview?.ok || busy || !title.trim()}>
              {busy ? t('pr.creating') : preview?.existingPr ? t('pr.updateBtn', { noun }) : t('pr.createBtn', { noun })}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

const CHIP_GROUPS = [
  ['tag', 'tags'],
  ['tech', 'technologies'],
  ['team', 'teams'],
] as const;

export function BottomBar() {
  const model = useStore((s) => s.model)!;
  const filters = useStore((s) => s.filters);
  const set = useStore((s) => s.set);
  const t = useT();
  const errors = model.problems.filter((p) => p.severity === 'error').length;
  const warnings = model.problems.length - errors;
  const cycle = (key: string) => {
    const next = { ...filters };
    if (!next[key]) next[key] = 'highlight';
    else if (next[key] === 'highlight') next[key] = 'hide';
    else delete next[key];
    set({ filters: next });
  };
  const chip = (key: string, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => cycle(key)}
      title={t('filters.cycle')}
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11.5px] transition-colors ${
        filters[key] === 'highlight' ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]' : filters[key] === 'hide' ? 'border-[var(--border)] text-[var(--subtle)] line-through' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]'
      }`}
    >
      {label}
    </button>
  );
  return (
    <footer className="flex h-10 shrink-0 items-center gap-2 overflow-x-auto border-t border-[var(--border)] bg-[var(--surface)] px-3">
      {CHIP_GROUPS.map(([prefix, list]) => (model.catalog[list] ?? []).map((i) => chip(`${prefix}:${i.id}`, i.name)))}
      {['future', 'deprecated', 'removed'].map((s) => chip(`status:${s}`, s))}
      {Object.keys(filters).length > 0 && (
        <button type="button" className="shrink-0 text-[11.5px] text-[var(--muted)] underline" onClick={() => set({ filters: {} })}>
          {t('filters.clear')}
        </button>
      )}
      <div className="flex-1" />
      <button type="button" onClick={() => set({ right: 'problems' })} className="flex shrink-0 items-center gap-3 text-[12px]">
        <span className={errors ? 'text-[var(--danger)]' : 'text-[var(--muted)]'}>{t('bottom.errors', { n: errors })}</span>
        <span className={warnings ? 'text-[var(--warn-fg)]' : 'text-[var(--muted)]'}>{t('bottom.warnings', { n: warnings })}</span>
      </button>
    </footer>
  );
}
