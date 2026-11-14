import { useEffect, useMemo, useState } from 'react';
import { tr, useT } from '../i18n';
import { currentDrawing, useStore } from '../store';
import { Button, Icon, IconButton, inputClass, Svg } from './ui';
import { mod } from '../actions';
import { pickAndImport } from '../importFile';

interface Item {
  label: string;
  hint: string;
  run: () => void;
}

export function CommandPalette() {
  const open = useStore((s) => s.palette);
  const model = useStore((s) => s.model);
  const index = useStore((s) => s.index);
  const drawing = useStore(currentDrawing);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const lang = useStore((s) => s.lang);
  const t = useT();
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    if (!model || !index) return [];
    const s = useStore.getState();
    const close = () => s.set({ palette: false });
    const out: Item[] = [];
    for (const e of index.entities.values()) {
      out.push({
        label: e.name,
        hint: `${tr(`kind.${e.kind}`)}${drawing?.nodes?.[e.id] ? tr('palette.inDrawing') : ''}`,
        run: () => {
          close();
          if (!drawing?.nodes?.[e.id]) {
            const where = index.entityDrawings.get(e.id)?.[0];
            if (where) s.openDrawing(where);
          }
          s.select([e.id]);
          s.requestFocus();
        },
      });
    }
    for (const e of index.entities.values()) out.push({ label: tr('palette.depsOf', { name: e.name }), hint: tr('palette.hintDeps'), run: () => (close(), s.set({ view: 'deps', depsOf: e.id })) });
    for (const d of model.drawings) out.push({ label: d.name, hint: tr('palette.hintDrawing'), run: () => (close(), s.openDrawing(d.id)) });
    for (const f of model.flows)
      out.push({
        label: f.name,
        hint: tr('palette.hintFlow'),
        run: () => {
          close();
          s.openDrawing(f.drawing);
          s.set({ flow: { id: f.id, frame: 0, playing: false, speed: 1, choice: {} } });
        },
      });
    const actions: [string, () => void][] = [
      [tr('palette.layout'), () => drawing && s.write('POST', `/api/drawings/${drawing.id}/layout`, {}, [drawing.file])],
      [tr('palette.modelList'), () => s.set({ view: 'list' })],
      [tr('palette.deps'), () => s.set({ view: 'deps' })],
      [tr('palette.problems'), () => s.set({ right: 'problems' })],
      [tr('palette.changes'), () => s.set({ right: 'changes' })],
      [tr('palette.openPr'), () => s.set({ prDialog: true })],
      [tr('palette.import'), pickAndImport],
      [tr('palette.undo'), () => void s.undo()],
      [tr('palette.redo'), () => void s.redo()],
      [tr('palette.fit'), () => (s.select([]), s.requestFocus())],
      [tr('help.title'), () => s.set({ help: true })],
    ];
    for (const [label, run] of actions) out.push({ label, hint: tr('palette.hintAction'), run: () => (close(), run()) });
    return out;
  }, [model, index, drawing, lang]);

  const q = query.trim().toLowerCase();
  const filtered = (q ? items.filter((i) => i.label.toLowerCase().includes(q) || i.hint.toLowerCase().includes(q)) : items).slice(0, 40);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/25 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && useStore.getState().set({ palette: false })}>
      <div role="dialog" aria-modal="true" aria-label={t('palette.title')} className="h-fit w-[560px] max-w-[92vw] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <input
          autoFocus
          className={`${inputClass} !rounded-none !border-0 !border-b !border-[var(--border)] !px-4 !py-3 !text-[14px] focus:!ring-0`}
          placeholder={t('palette.placeholder')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(filtered.length - 1, a + 1)));
            if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
            if (e.key === 'Enter') filtered[active]?.run();
            if (e.key === 'Escape') useStore.getState().set({ palette: false });
          }}
          aria-label={t('palette.search')}
        />
        <ul className="max-h-[50vh] overflow-y-auto p-1.5" role="listbox">
          {filtered.map((item, i) => (
            <li key={`${item.hint}-${item.label}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={item.run}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-[13px] ${i === active ? 'bg-[var(--accent-soft)] text-[var(--fg)]' : 'text-[var(--fg-soft)]'}`}
              >
                <span className="truncate">{item.label}</span>
                <span className="shrink-0 text-[11.5px] text-[var(--muted)]">{item.hint}</span>
              </button>
            </li>
          ))}
          {!filtered.length && <li className="px-3 py-6 text-center text-[13px] text-[var(--muted)]">{t('palette.none')}</li>}
        </ul>
      </div>
    </div>
  );
}

export function ConfirmDialogView() {
  const confirm = useStore((s) => s.confirm);
  const set = useStore((s) => s.set);
  const [busy, setBusy] = useState(false);
  const t = useT();
  if (!confirm) return null;
  const close = () => set({ confirm: undefined });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="alertdialog" aria-modal="true" aria-label={confirm.title} className="w-[460px] max-w-[92vw] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl">
        <h2 className="text-[15px] font-semibold text-[var(--fg)]">{confirm.title}</h2>
        <ul className="mt-3 flex max-h-[40vh] flex-col gap-1 overflow-y-auto text-[13px] text-[var(--fg-soft)]">
          {confirm.lines.map((l) => (
            <li key={l}>• {l}</li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" autoFocus={confirm.danger} onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            autoFocus={!confirm.danger}
            variant={confirm.danger ? 'danger' : 'primary'}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await confirm.onConfirm();
              } finally {
                setBusy(false);
                close();
              }
            }}
          >
            {confirm.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismiss);
  const t = useT();
  return (
    <div className="pointer-events-none fixed bottom-14 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex max-w-[560px] items-start gap-2 rounded-lg py-2 pl-3.5 pr-1.5 text-left text-[13px] shadow-lg ${toast.kind === 'error' ? 'bg-[var(--danger-solid)] text-white' : 'bg-[var(--toast)] text-[var(--toast-fg)]'}`}
        >
          <div className="min-w-0 flex-1 py-0.5">
            {toast.title && <div className="font-semibold">{toast.title}</div>}
            {toast.lines?.length ? (
              <ul className="mt-1 flex flex-col gap-1">
                {toast.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
            <div className={toast.title ? 'mt-1 text-[12px] opacity-85' : ''}>{toast.text}</div>
          </div>
          <button type="button" aria-label={t('toast.dismiss')} title={t('toast.dismiss')} onClick={() => dismiss(toast.id)} className="grid size-6 shrink-0 place-items-center rounded-md opacity-80 hover:bg-[color-mix(in_srgb,currentColor_18%,transparent)] hover:opacity-100">
            <Svg icon={Icon.close} size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Every keyboard shortcut and canvas gesture, opened with "?" or from the top bar. */
export function ShortcutsDialog() {
  const open = useStore((s) => s.help);
  const t = useT();
  if (!open) return null;
  const close = () => useStore.getState().set({ help: false });
  const groups: [string, [string, string][]][] = [
    [
      t('help.canvas'),
      [
        [t('help.dblClick'), t('help.newEntity')],
        ['Shift+N', t('help.newEntityCenter')],
        [t('help.dragSide'), t('help.connect')],
        [t('help.rightClick'), t('help.menu')],
        ['Enter', t('help.drill')],
        ['Esc', t('help.escape')],
        [t('help.arrows'), t('help.nudge')],
        [t('help.shiftDrag'), t('help.boxSelect')],
        [mod('G'), t('help.group')],
        ['Shift+C', t('help.zoomSelection')],
        [mod('Shift+C'), t('help.fit')],
        [mod('D'), t('help.duplicate')],
      ],
    ],
    [
      t('help.editing'),
      [
        ['Del', t('help.remove')],
        ['Shift+Del', t('help.delete')],
        [mod('Z'), t('palette.undo')],
        [mod('Shift+Z'), t('palette.redo')],
        [`${mod('K')} / ${mod('F')}`, t('help.palette')],
        ['?', t('help.title')],
      ],
    ],
    [
      t('help.flow'),
      [
        [t('help.clickConn'), t('help.addStep')],
        [t('help.space'), t('help.playPause')],
        ['← / →', t('help.prevNext')],
        ['Esc', t('help.exitFlow')],
      ],
    ],
  ];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label={t('help.title')} className="flex max-h-[86vh] w-[720px] max-w-[94vw] flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] py-2.5 pl-5 pr-3">
          <h2 className="text-[15px] font-semibold text-[var(--fg)]">{t('help.title')}</h2>
          <IconButton autoFocus label={t('common.close')} onClick={close}>
            <Svg icon={Icon.close} />
          </IconButton>
        </div>
        <div className="grid gap-x-8 gap-y-4 overflow-y-auto p-5 sm:grid-cols-2">
          {groups.map(([title, rows], g) => (
            <section key={title} className={g === 0 ? 'sm:row-span-2' : ''}>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{title}</h3>
              <dl className="flex flex-col">
                {rows.map(([keys, what]) => (
                  <div key={keys + what} className="flex items-baseline justify-between gap-3 border-b border-[var(--border)]/60 py-1.5 last:border-0">
                    <dd className="text-[13px] text-[var(--fg-soft)]">{what}</dd>
                    <dt className="shrink-0 rounded bg-[var(--chip)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--fg-soft)]">{keys}</dt>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
