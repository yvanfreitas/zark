import { useEffect, useMemo, useState } from 'react';
import { KIND_LABEL } from '../model';
import { currentDrawing, useStore } from '../store';
import { Button, inputClass } from './ui';

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
        hint: `${KIND_LABEL[e.kind]}${drawing?.nodes?.[e.id] ? ' · neste desenho' : ''}`,
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
    for (const e of index.entities.values()) out.push({ label: `Dependências de ${e.name}`, hint: 'Dependências', run: () => (close(), s.set({ view: 'deps', depsOf: e.id })) });
    for (const d of model.drawings) out.push({ label: d.name, hint: 'Desenho', run: () => (close(), s.openDrawing(d.id)) });
    for (const f of model.flows)
      out.push({
        label: f.name,
        hint: 'Fluxo',
        run: () => {
          close();
          s.openDrawing(f.drawing);
          s.set({ flow: { id: f.id, frame: 0, playing: false, speed: 1, choice: {} } });
        },
      });
    const actions: [string, () => void][] = [
      ['Organizar desenho automaticamente', () => drawing && s.write('POST', `/api/drawings/${drawing.id}/layout`, {}, [drawing.file])],
      ['Lista do modelo', () => s.set({ view: 'list' })],
      ['Dependências', () => s.set({ view: 'deps' })],
      ['Mostrar problemas', () => s.set({ right: 'problems' })],
      ['Mostrar alterações', () => s.set({ right: 'changes' })],
      ['Abrir PR', () => s.set({ prDialog: true })],
      ['Desfazer', () => void s.undo()],
      ['Refazer', () => void s.redo()],
      ['Enquadrar o desenho', () => (s.select([]), s.requestFocus())],
    ];
    for (const [label, run] of actions) out.push({ label, hint: 'Ação', run: () => (close(), run()) });
    return out;
  }, [model, index, drawing]);

  const q = query.trim().toLowerCase();
  const filtered = (q ? items.filter((i) => i.label.toLowerCase().includes(q) || i.hint.toLowerCase().includes(q)) : items).slice(0, 40);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/25 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && useStore.getState().set({ palette: false })}>
      <div role="dialog" aria-label="Paleta de comandos" className="h-fit w-[560px] max-w-[92vw] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <input
          autoFocus
          className={`${inputClass} !rounded-none !border-0 !border-b !border-[var(--border)] !px-4 !py-3 !text-[14px] focus:!ring-0`}
          placeholder="Buscar entidades, desenhos, fluxos e ações"
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
          aria-label="Buscar"
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
          {!filtered.length && <li className="px-3 py-6 text-center text-[13px] text-[var(--muted)]">Nada encontrado.</li>}
        </ul>
      </div>
    </div>
  );
}

export function ConfirmDialogView() {
  const confirm = useStore((s) => s.confirm);
  const set = useStore((s) => s.set);
  const [busy, setBusy] = useState(false);
  if (!confirm) return null;
  const close = () => set({ confirm: undefined });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="alertdialog" aria-label={confirm.title} className="w-[460px] max-w-[92vw] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl">
        <h2 className="text-[15px] font-semibold text-[var(--fg)]">{confirm.title}</h2>
        <ul className="mt-3 flex max-h-[40vh] flex-col gap-1 overflow-y-auto text-[13px] text-[var(--fg-soft)]">
          {confirm.lines.map((l) => (
            <li key={l}>• {l}</li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button
            autoFocus
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
  return (
    <div className="pointer-events-none fixed bottom-14 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      {toasts.map((t) => (
        <button
          type="button"
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto max-w-[560px] rounded-lg px-3.5 py-2 text-left text-[13px] shadow-lg ${t.kind === 'error' ? 'bg-[var(--danger)] text-white' : 'bg-[var(--toast)] text-[var(--toast-fg)]'}`}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
