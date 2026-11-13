import { useEffect, useMemo, useRef, useState } from 'react';
import { ALLOWED_PARENTS, freeId, KIND_LABEL, kindsForScope } from '../model';
import { currentDrawing, useStore } from '../store';
import { Button, Field, inputClass } from './ui';

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose());
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
}

/** Lists model connections between the two boxes (children included) and offers a new one. */
export function ConnectionPicker({ source, target, onClose }: { source: string; target: string; onClose: () => void }) {
  const index = useStore((s) => s.index)!;
  const drawing = useStore(currentDrawing)!;
  const write = useStore((s) => s.write);
  useEscape(onClose);
  const existing = useMemo(() => {
    const a = new Set([source, ...index.descendants(source)]);
    const b = new Set([target, ...index.descendants(target)]);
    return [...index.conns.values()].filter((c) => (a.has(c.from) && b.has(c.to)) || (b.has(c.from) && a.has(c.to)));
  }, [index, source, target]);
  const [label, setLabel] = useState('');
  const [direction, setDirection] = useState<'outgoing' | 'bidirectional'>('outgoing');

  const draw = async (ref: string) => {
    const r = await write('POST', `/api/drawings/${drawing.id}/ops`, { ops: [{ op: 'draw-edges', edges: [{ ref, shape: 'straight' }] }] }, [drawing.file]);
    if (r) onClose();
  };
  const create = async () => {
    const from = index.entities.get(source)!;
    const id = freeId(label || 'conexao', (x) => !!from.connections?.some((c) => c.id === x));
    const r = await useStore.getState().ops(
      [
        { op: 'connection.create', from: source, connection: { id, to: target, label: label.trim(), ...(direction === 'bidirectional' ? { direction } : {}) } },
        { op: 'drawing.draw-edges', drawing: drawing.id, edges: [{ ref: `${source}.${id}`, shape: 'straight' }] },
      ],
      [from.file, drawing.file],
    );
    if (r) onClose();
  };

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-black/10" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Seletor de conexão" className="w-[400px] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl">
        <h2 className="text-[14px] font-semibold text-[var(--fg)]">
          {index.name(source)} → {index.name(target)}
        </h2>
        {existing.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">Já existem no modelo</div>
            <ul className="flex flex-col gap-1">
              {existing.map((c) => {
                const drawn = !!drawing.edges?.[c.ref];
                return (
                  <li key={c.ref}>
                    <button
                      type="button"
                      disabled={drawn}
                      onClick={() => draw(c.ref)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-[var(--hover)] disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[var(--fg)]">{c.conn.label || '(sem rótulo)'}</span>
                        <span className="block truncate font-mono text-[11px] text-[var(--muted)]">
                          {index.name(c.from)} → {index.name(c.to)}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-[var(--muted)]">{drawn ? 'já traçada' : 'traçar'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <form
          className="mt-4 flex flex-col gap-3 border-t border-[var(--border)] pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">Nova conexão</div>
          <Field label="Rótulo">
            <input autoFocus className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: Cria o pedido" />
          </Field>
          <Field label="Direção">
            <select className={inputClass} value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
              <option value="outgoing">Saída ({index.name(source)} → {index.name(target)})</option>
              <option value="bidirectional">Bidirecional</option>
            </select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!label.trim()}>
              Criar e traçar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Double click on the canvas: add an existing entity or create a new one in place. */
export function QuickCreate({ x, y, left, top, onClose }: { x: number; y: number; left: number; top: number; onClose: () => void }) {
  const index = useStore((s) => s.index)!;
  const drawing = useStore(currentDrawing)!;
  const write = useStore((s) => s.write);
  useEscape(onClose);
  const [query, setQuery] = useState('');
  const kinds = kindsForScope(index, drawing.scope);
  const [kind, setKind] = useState(kinds.includes('app') && drawing.scope ? 'app' : 'system');
  const inputRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const matches = q
    ? [...index.entities.values()].filter((e) => !drawing.nodes?.[e.id] && (e.name.toLowerCase().includes(q) || e.id.includes(q))).slice(0, 6)
    : [];
  const exact = [...index.entities.values()].some((e) => e.name.toLowerCase() === q);

  const place = async (id: string) => {
    const r = await write('POST', `/api/drawings/${drawing.id}/ops`, { ops: [{ op: 'place', nodes: [{ id, x, y }] }] }, [drawing.file]);
    if (r) onClose();
  };
  const create = async () => {
    const name = query.trim();
    if (!name) return;
    const scopeKind = drawing.scope ? index.entities.get(drawing.scope)?.kind ?? null : null;
    const parent = drawing.scope && ALLOWED_PARENTS[kind].includes(scopeKind) ? drawing.scope : undefined;
    const id = freeId(name, (s) => index.entities.has(s));
    const r = await write('POST', '/api/entities', { entity: { id, name, kind, ...(parent ? { parent } : {}) }, place: { drawing: drawing.id, x, y } }, [drawing.file]);
    if (r) {
      useStore.getState().select([id]);
      onClose();
    }
  };

  return (
    <div className="absolute inset-0 z-40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-label="Adicionar entidade"
        className="absolute w-[300px] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-xl"
        style={{ left: Math.max(8, left - 150), top: Math.max(8, top - 20) }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (matches.length === 1 && exact) void place(matches[0].id);
            else void create();
          }}
        >
          <input
            ref={inputRef}
            autoFocus
            className={inputClass}
            placeholder="Buscar ou criar entidade"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Nome da entidade"
          />
        </form>
        {matches.length > 0 && (
          <ul className="mt-1 flex flex-col">
            {matches.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => place(e.id)} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[var(--hover)]">
                  <span className="truncate text-[var(--fg)]">{e.name}</span>
                  <span className="font-mono text-[10.5px] uppercase text-[var(--muted)]">{KIND_LABEL[e.kind]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {q && !exact && (
          <div className="mt-1 flex items-center gap-2 border-t border-[var(--border)] px-1 pt-2">
            <select className={`${inputClass} !w-auto`} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo">
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <Button type="button" onClick={create} className="flex-1">
              Criar “{query.trim()}”
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
