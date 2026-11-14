import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { alternativeBlocks, flowToMermaid } from '@core/flow-text';
import { api, token } from '../api';
import { flowView } from '../flow';
import { useStore } from '../store';
import type { FlowItem, Step } from '../types';
import { AddStepButton } from './Inspector';
import { Button, Icon, IconButton, inputClass, Svg } from './ui';

const SPEEDS = [0.5, 1, 2];

/** Rebuilds the top-level steps array with `fn` and saves it as one flow.update. */
function useSteps(flowId: string) {
  const model = useStore((s) => s.model)!;
  const flow = model.flows.find((f) => f.id === flowId)!;
  const save = (steps: FlowItem[]) => useStore.getState().ops([{ op: 'flow.update', id: flowId, set: { steps } }], [flow.file]);
  return { flow, items: flow.steps ?? [], save };
}

export function FlowPanel() {
  const model = useStore((s) => s.model)!;
  const index = useStore((s) => s.index)!;
  const state = useStore((s) => s.flow)!;
  const selection = useStore((s) => s.selection);
  const setFlow = useStore((s) => s.setFlow);
  const view = useMemo(() => flowView(model, index, state), [model, index, state]);
  const [mermaid, setMermaid] = useState<string>();

  // Playback timer.
  useEffect(() => {
    if (!state.playing || !view) return;
    const t = window.setTimeout(() => {
      if (view.frame >= view.frames.length - 1) setFlow({ playing: false });
      else setFlow({ frame: view.frame + 1 });
    }, 1700 / state.speed);
    return () => clearTimeout(t);
  }, [state.playing, state.speed, view, setFlow]);

  if (!view) return null;
  const { flow, frames, frame, numberOf } = view;
  const problems = new Map<string, { code: string; message: string }[]>();
  for (const p of model.problems) {
    if (p.ref?.startsWith(`${flow.id}#`)) {
      const id = p.ref.slice(flow.id.length + 1);
      problems.set(id, [...(problems.get(id) ?? []), p]);
    }
  }
  const blocks = alternativeBlocks(flow.steps);
  const selectedConn = selection.edges.length === 1 ? selection.edges[0] : undefined;
  const exit = () => {
    setFlow(null);
    history.replaceState(null, '', `#drawing=${flow.drawing}`);
  };
  const exportMermaid = () =>
    setMermaid(
      flowToMermaid(flow, {
        connection: (ref) => {
          const c = index.conns.get(ref);
          return c && { from: c.from, to: c.to, direction: c.conn.direction };
        },
        name: index.name,
        subflow: (id) => model.flows.find((f) => f.id === id)?.steps,
      }),
    );
  const renderStep = async () => {
    const step = frames[frame]?.[0];
    const s = useStore.getState();
    s.toast('Gerando PNG…');
    try {
      const r = await api('POST', '/api/render', { flow: flow.id, step: step?.id });
      if (r.ok) window.open(`${r.url}&token=${encodeURIComponent(token)}`, '_blank');
      else s.toast(r.error, 'error');
    } catch (e) {
      s.toast((e as Error).message, 'error');
    }
  };
  const copyLink = () => {
    const step = frames[frame]?.[0];
    const url = `${location.origin}/#flow=${flow.id}${step ? `&step=${step.id}` : ''}`;
    void navigator.clipboard?.writeText(url).then(() => useStore.getState().toast('Link copiado'));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border)] p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--muted)]">Fluxo · {index.drawings.get(flow.drawing)?.name}</div>
            <div className="text-[16px] font-semibold text-[var(--fg)]">{flow.name}</div>
          </div>
          <IconButton label="Fechar modo fluxo" onClick={exit}>
            <Svg icon={Icon.close} />
          </IconButton>
        </div>
        <div className="mt-3 flex items-center gap-1">
          <IconButton label="Ir para o início" onClick={() => setFlow({ frame: 0, playing: false })}>
            <Svg icon={Icon.first} />
          </IconButton>
          <IconButton label="Anterior (←)" onClick={() => setFlow({ frame: Math.max(0, frame - 1), playing: false })}>
            <Svg icon={Icon.prev} />
          </IconButton>
          <button
            type="button"
            onClick={() => setFlow({ playing: !state.playing, frame: frame >= frames.length - 1 ? 0 : frame })}
            className="grid size-9 place-items-center rounded-full bg-[var(--accent)] text-white hover:bg-[var(--accent-strong)]"
            aria-label={state.playing ? 'Pausar (espaço)' : 'Reproduzir (espaço)'}
            title={state.playing ? 'Pausar (espaço)' : 'Reproduzir (espaço)'}
          >
            <Svg icon={state.playing ? Icon.pause : Icon.play} />
          </button>
          <IconButton label="Próximo (→)" onClick={() => setFlow({ frame: Math.min(frames.length - 1, frame + 1), playing: false })}>
            <Svg icon={Icon.next} />
          </IconButton>
          <span className="ml-2 font-mono text-[12px] text-[var(--muted)]">
            {frames.length ? frame + 1 : 0}/{frames.length}
          </span>
          <div className="flex-1" />
          <select data-keep aria-label="Velocidade" className={`${inputClass} !w-[70px]`} value={state.speed} onChange={(e) => setFlow({ speed: Number(e.target.value) })}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </div>
        {blocks.map((b) => (
          <div key={b.key} className="mt-2 flex flex-wrap gap-1" role="tablist" aria-label="Caminho alternativo">
            {b.names.map((n, i) => (
              <button
                key={n}
                type="button"
                role="tab"
                aria-selected={(state.choice[b.key] ?? 0) === i}
                onClick={() => setFlow({ choice: { ...state.choice, [b.key]: i }, frame: 0 })}
                className={`rounded-full border px-2.5 py-0.5 text-[12px] ${(state.choice[b.key] ?? 0) === i ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]'}`}
              >
                {n}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {selectedConn && <AddStepButton key={selectedConn} refId={selectedConn} flowId={flow.id} />}
        {!selectedConn && <p data-edit className="mb-2 px-1 text-[12px] text-[var(--muted)]">Clique numa conexão do canvas para adicionar um passo sobre ela.</p>}
        <StepList flowId={flow.id} numberOf={numberOf} activeIds={view.activeIds} problems={problems} onJump={(stepId) => {
          const at = frames.findIndex((f) => f.some((s) => s.id === stepId));
          if (at >= 0) setFlow({ frame: at, playing: false });
        }} />
      </div>
      <div className="flex flex-wrap gap-2 border-t border-[var(--border)] p-3">
        <Button safe variant="subtle" onClick={exportMermaid}>
          Mermaid
        </Button>
        <Button variant="subtle" onClick={renderStep}>
          PNG do passo
        </Button>
        <Button safe variant="subtle" onClick={copyLink}>
          Copiar link
        </Button>
      </div>
      {mermaid && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && setMermaid(undefined)}>
          <div role="dialog" aria-label="Mermaid" className="w-[560px] max-w-[92vw] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl">
            <h2 className="mb-2 text-[14px] font-semibold text-[var(--fg)]">Mermaid sequenceDiagram</h2>
            <textarea readOnly className={`${inputClass} h-[320px] font-mono text-[12px]`} value={mermaid} />
            <div className="mt-3 flex justify-end gap-2">
              <Button safe variant="ghost" onClick={() => setMermaid(undefined)}>
                Fechar
              </Button>
              <Button safe onClick={() => void navigator.clipboard?.writeText(mermaid).then(() => useStore.getState().toast('Copiado'))}>Copiar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StepList({
  flowId,
  numberOf,
  activeIds,
  problems,
  onJump,
}: {
  flowId: string;
  numberOf: Map<string, string>;
  activeIds: Set<string>;
  problems: Map<string, { code: string; message: string }[]>;
  onJump: (id: string) => void;
}) {
  const index = useStore((s) => s.index)!;
  const model = useStore((s) => s.model)!;
  const { flow, items, save } = useSteps(flowId);
  const [dragFrom, setDragFrom] = useState<number>();
  const [editing, setEditing] = useState<string>();
  const ops = useStore.getState().ops;
  const drawing = index.drawings.get(flow.drawing);

  const updateStep = (id: string, set: Record<string, unknown>, unset: string[] = []) => ops([{ op: 'flow.update-step', flow: flowId, step: id, set, unset }], [flow.file]);
  const removeStep = (id: string) => ops([{ op: 'flow.remove-steps', flow: flowId, steps: [id] }], [flow.file]);
  const moveTop = (from: number, to: number) => {
    if (from === to) return;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    void save(next);
  };
  const groupWithNext = (i: number, kind: 'parallel' | 'alternatives') => {
    const a = items[i];
    const b = items[i + 1];
    if (!a || !b) return;
    const block: FlowItem = kind === 'parallel' ? { parallel: [[a], [b]] } : { alternatives: [{ name: 'Caminho A', steps: [a] }, { name: 'Caminho B', steps: [b] }] };
    void save([...items.slice(0, i), block, ...items.slice(i + 2)]);
  };
  const ungroup = (i: number) => {
    const it = items[i];
    const flat = 'parallel' in it ? it.parallel.flat() : 'alternatives' in it ? it.alternatives.flatMap((a) => a.steps) : [it];
    void save([...items.slice(0, i), ...flat, ...items.slice(i + 1)]);
  };

  const fixes = (step: Step, codes: string[]): ReactNode => {
    const c = index.conns.get(step.via);
    const out: ReactNode[] = [];
    if (codes.includes('E041') && c) {
      out.push(
        <Button key="rev" variant="subtle" onClick={() => useStore.getState().write('PATCH', `/api/connections/${c.ref}`, { reverse: true }, [c.file])}>
          Inverter a conexão
        </Button>,
        <Button key="reply" variant="subtle" onClick={() => updateStep(step.id, { reply: true }, ['reverse'])}>
          Marcar como resposta
        </Button>,
      );
    }
    if (codes.includes('E042')) out.push(<Button key="unrev" variant="subtle" onClick={() => updateStep(step.id, {}, ['reverse'])}>Remover reverse</Button>);
    if (codes.includes('E044') && drawing) {
      out.push(
        <Button key="draw" variant="subtle" onClick={() => useStore.getState().write('POST', `/api/drawings/${drawing.id}/ops`, { ops: [{ op: 'draw-edges', edges: [{ ref: step.via, shape: 'auto' }] }] }, [drawing.file])}>
          Traçar no desenho
        </Button>,
      );
    }
    return out.length ? <div className="mt-1.5 flex flex-wrap gap-1.5">{out}</div> : null;
  };

  const stepRow = (step: Step, topIndex?: number): ReactNode => {
    const c = index.conns.get(step.via);
    const backwards = !!step.reply !== !!step.reverse;
    const from = c ? (backwards ? c.to : c.from) : '?';
    const to = c ? (backwards ? c.from : c.to) : '?';
    const issues = problems.get(step.id) ?? [];
    const active = activeIds.has(step.id);
    return (
      <div
        className={`group rounded-lg border px-2.5 py-2 ${issues.some((p) => p.code.startsWith('E')) ? 'border-[var(--danger)]/60 bg-[var(--danger-soft)]' : active ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-transparent hover:bg-[var(--hover)]'}`}
      >
        <div className="flex items-start gap-2">
          {topIndex !== undefined && (
            <span className="mt-0.5 cursor-grab text-[var(--subtle)]" aria-hidden="true">
              <Svg icon={Icon.grip} size={14} />
            </span>
          )}
          <button type="button" onClick={() => onJump(step.id)} className="w-9 shrink-0 text-left font-mono text-[12px] font-semibold text-[var(--accent)]">
            {numberOf.get(step.id)}
          </button>
          <div className="min-w-0 flex-1">
            {editing === step.id ? (
              <input
                autoFocus
                className={inputClass}
                defaultValue={step.text}
                aria-label="Texto do passo"
                onBlur={(e) => {
                  setEditing(undefined);
                  if (e.target.value.trim() && e.target.value !== step.text) void updateStep(step.id, { text: e.target.value.trim() });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setEditing(undefined);
                }}
              />
            ) : (
              <button type="button" className="block w-full text-left text-[13px] text-[var(--fg)]" onClick={() => onJump(step.id)} onDoubleClick={() => setEditing(step.id)}>
                {step.text}
                {step.reply && <span className="ml-1 text-[11px] text-[var(--muted)]">(resposta)</span>}
              </button>
            )}
            <div className="truncate text-[11px] text-[var(--muted)]">
              {index.name(from)} → {index.name(to)}
            </div>
            {issues.map((p, i) => (
              <div key={i} className={`mt-1 text-[11.5px] ${p.code.startsWith('E') ? 'text-[var(--danger)]' : 'text-[var(--warn-fg)]'}`}>
                {p.code}: {p.message}
              </div>
            ))}
            {fixes(step, issues.map((p) => p.code))}
            <div data-edit className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px]">
              <button type="button" className="text-[var(--muted)] hover:text-[var(--fg)]" onClick={() => setEditing(step.id)}>
                Editar
              </button>
              <button type="button" className="text-[var(--muted)] hover:text-[var(--fg)]" onClick={() => (step.reply ? updateStep(step.id, {}, ['reply']) : updateStep(step.id, { reply: true }))}>
                {step.reply ? 'Não é resposta' : 'Resposta'}
              </button>
              {c?.conn.direction === 'bidirectional' && (
                <button type="button" className="text-[var(--muted)] hover:text-[var(--fg)]" onClick={() => (step.reverse ? updateStep(step.id, {}, ['reverse']) : updateStep(step.id, { reverse: true }))}>
                  {step.reverse ? 'Sentido normal' : 'Destino inicia'}
                </button>
              )}
              {topIndex !== undefined && topIndex < items.length - 1 && (
                <>
                  <button type="button" className="text-[var(--muted)] hover:text-[var(--fg)]" onClick={() => groupWithNext(topIndex, 'parallel')} title="Agrupa com o próximo item em paralelo">
                    ∥ próximo
                  </button>
                  <button type="button" className="text-[var(--muted)] hover:text-[var(--fg)]" onClick={() => groupWithNext(topIndex, 'alternatives')} title="Agrupa com o próximo item como caminhos alternativos">
                    ou próximo
                  </button>
                </>
              )}
              <button type="button" className="text-[var(--muted)] hover:text-[var(--danger)]" onClick={() => removeStep(step.id)}>
                Excluir
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderItems = (list: FlowItem[], top: boolean): ReactNode[] =>
    list.map((item, i) => {
      const dnd = top
        ? {
            draggable: true,
            onDragStart: () => setDragFrom(i),
            onDragOver: (e: React.DragEvent) => e.preventDefault(),
            onDrop: () => {
              if (dragFrom !== undefined) moveTop(dragFrom, i);
              setDragFrom(undefined);
            },
          }
        : {};
      let body: ReactNode;
      if ('via' in item) body = stepRow(item, top ? i : undefined);
      else if ('parallel' in item)
        body = (
          <Block title="Em paralelo" onUngroup={top ? () => ungroup(i) : undefined}>
            {item.parallel.map((branch, b) => (
              <div key={b} className="border-l-2 border-[var(--accent)]/40 pl-2">
                {renderItems(branch, false)}
              </div>
            ))}
          </Block>
        );
      else if ('alternatives' in item)
        body = (
          <Block title="Alternativas" onUngroup={top ? () => ungroup(i) : undefined}>
            {item.alternatives.map((alt, a) => (
              <div key={a} className="border-l-2 border-dashed border-[var(--border-strong)] pl-2">
                {top ? (
                  <input
                    aria-label="Nome do caminho"
                    defaultValue={alt.name}
                    key={alt.name}
                    className="w-full rounded bg-transparent px-1 pb-0.5 text-[11.5px] font-medium text-[var(--muted)] hover:bg-[var(--hover)] focus:bg-[var(--input)] focus:text-[var(--fg)] focus:outline-none"
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (!name || name === alt.name) return;
                      const alternatives = item.alternatives.map((x, xi) => (xi === a ? { ...x, name } : x));
                      void save(items.map((x, xi) => (xi === i ? { alternatives } : x)));
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <div className="px-1 pb-0.5 text-[11.5px] font-medium text-[var(--muted)]">{alt.name}</div>
                )}
                {renderItems(alt.steps, false)}
              </div>
            ))}
          </Block>
        );
      else if ('subflow' in item) body = <div className="px-2.5 py-2 text-[13px] text-[var(--fg-soft)]">↳ Subfluxo: {model.flows.find((f) => f.id === item.subflow)?.name ?? item.subflow}</div>;
      else body = <div className="px-2.5 py-1.5 text-[12.5px] italic text-[var(--muted)]">{item.note}</div>;
      return (
        <div key={i} {...dnd} className="relative">
          {body}
        </div>
      );
    });

  if (!items.length) return <p className="px-1 py-6 text-center text-[13px] text-[var(--muted)]">Fluxo vazio.</p>;
  return <div className="flex flex-col gap-1">{renderItems(items, true)}</div>;
}

function Block({ title, children, onUngroup }: { title: string; children: ReactNode; onUngroup?: () => void }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-1.5">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{title}</span>
        {onUngroup && (
          <button data-edit type="button" className="text-[11px] text-[var(--muted)] hover:text-[var(--fg)]" onClick={onUngroup}>
            Desagrupar
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}
