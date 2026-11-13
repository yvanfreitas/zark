import { useEffect, useState, type ReactNode } from 'react';
import { ALLOWED_PARENTS, freeId, KIND_LABEL } from '../model';
import { currentDrawing, useStore } from '../store';
import type { Conn, Drawing, Entity, WithFile } from '../types';
import { Button, Field, inputClass, SectionTitle, Tabs } from './ui';

/** Text input that commits on blur or Enter, not on every keystroke. */
function CommitInput({ value, onCommit, multiline, placeholder, label }: { value: string; onCommit: (v: string) => void; multiline?: boolean; placeholder?: string; label: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  return multiline ? (
    <textarea aria-label={label} className={`${inputClass} min-h-[88px] resize-y font-mono text-[12px]`} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
  ) : (
    <input
      aria-label={label}
      className={inputClass}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}

/** Multi-select of catalog ids; typing a new name creates the catalog item. */
function CatalogPicker({ list, value, onChange, label }: { list: 'technologies' | 'tags' | 'teams'; value: string[]; onChange: (ids: string[]) => void; label: string }) {
  const catalog = useStore((s) => s.model!.catalog);
  const items = catalog[list] ?? [];
  const [adding, setAdding] = useState('');
  const add = async () => {
    const name = adding.trim();
    if (!name) return;
    const found = items.find((i) => i.name.toLowerCase() === name.toLowerCase() || i.id === name);
    let id = found?.id;
    if (!id) {
      id = freeId(name, (x) => items.some((i) => i.id === x));
      const r = await useStore.getState().ops([{ op: 'catalog.set', list, item: { id, name } }], ['catalog.yaml']);
      if (!r) return;
    }
    if (!value.includes(id)) onChange([...value, id]);
    setAdding('');
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1">
        {value.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-full bg-[var(--chip)] px-2 py-0.5 text-[12px] text-[var(--fg-soft)]">
            {items.find((i) => i.id === id)?.name ?? id}
            <button type="button" aria-label={`Remover ${id}`} className="text-[var(--muted)] hover:text-[var(--danger)]" onClick={() => onChange(value.filter((v) => v !== id))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input list={`dl-${list}`} aria-label={label} className={inputClass} placeholder="Adicionar…" value={adding} onChange={(e) => setAdding(e.target.value)} />
        <datalist id={`dl-${list}`}>
          {items.filter((i) => !value.includes(i.id)).map((i) => (
            <option key={i.id} value={i.name} />
          ))}
        </datalist>
      </form>
    </div>
  );
}

function FileFooter({ file }: { file: string }) {
  const root = useStore((s) => s.model?.root);
  const abs = root ? `${root.replace(/\\/g, '/')}/${file}` : undefined;
  return (
    <div className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
      <code className="truncate text-[11px] text-[var(--muted)]">{file}</code>
      {abs && (
        <a className="shrink-0 text-[12px] font-medium text-[var(--accent)] hover:underline" href={`vscode://file/${abs}`}>
          Abrir no editor
        </a>
      )}
    </div>
  );
}

function EntityInspector({ entity }: { entity: WithFile<Entity> }) {
  const index = useStore((s) => s.index)!;
  const model = useStore((s) => s.model)!;
  const drawing = useStore(currentDrawing);
  const { write, deleteWithImpact, select, openDrawing } = useStore.getState();
  const [tab, setTab] = useState<'details' | 'connections' | 'usage'>('details');
  const patch = (body: unknown) => write('PATCH', `/api/entities/${entity.id}`, body, [entity.file]);
  const setField = (key: string, v: unknown) => patch(v === '' || v === undefined || (Array.isArray(v) && !v.length) ? { unset: [key] } : { set: { [key]: v } });
  const parents = [...index.entities.values()].filter((e) => ALLOWED_PARENTS[entity.kind].includes(e.kind) && e.id !== entity.id);
  const placed = !!drawing?.nodes?.[entity.id];

  const outgoing = (entity.connections ?? []).map((c) => index.conns.get(`${entity.id}.${c.id}`)!);
  const incoming = [...index.conns.values()].filter((c) => c.to === entity.id);
  const toggle = async (c: Conn, on: boolean) => {
    if (!drawing) return;
    const ops = on ? [{ op: 'draw-edges', edges: [{ ref: c.ref, shape: 'straight' }] }] : [{ op: 'remove-edges', refs: [c.ref] }];
    await write('POST', `/api/drawings/${drawing.id}/ops`, { ops }, [drawing.file]);
  };
  const drawable = (c: Conn) => !!drawing && !!index.resolve(drawing, c.from) && !!index.resolve(drawing, c.to) && index.resolve(drawing, c.from) !== index.resolve(drawing, c.to);

  const connRow = (c: Conn, dir: 'out' | 'in') => (
    <li key={c.ref} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-[var(--hover)]">
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => select([], [c.ref])}>
        <span className="block truncate text-[13px] text-[var(--fg)]">{c.conn.label || '(sem rótulo)'}</span>
        <span className="block truncate text-[11px] text-[var(--muted)]">{dir === 'out' ? `→ ${index.name(c.to)}` : `← ${index.name(c.from)}`}</span>
      </button>
      <label className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--muted)]" title={drawable(c) ? 'Mostrar neste desenho' : 'As pontas não estão neste desenho'}>
        <input type="checkbox" disabled={!drawable(c)} checked={!!drawing?.edges?.[c.ref]} onChange={(e) => toggle(c, e.target.checked)} className="accent-[var(--accent)]" />
        neste desenho
      </label>
    </li>
  );

  return (
    <div>
      <div className="mb-3">
        <div className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--muted)]">
          {entity.external ? 'Externo · ' : ''}
          {KIND_LABEL[entity.kind]}
        </div>
        <div className="text-[16px] font-semibold text-[var(--fg)]">{entity.name}</div>
      </div>
      <Tabs value={tab} onChange={setTab} items={[['details', 'Detalhes'], ['connections', `Conexões (${outgoing.length + incoming.length})`], ['usage', 'Uso']]} />
      {tab === 'details' && (
        <div className="mt-3 flex flex-col gap-3">
          <Field label="Nome">
            <CommitInput label="Nome" value={entity.name} onCommit={(v) => v.trim() && setField('name', v.trim())} />
          </Field>
          <Field label="Caption">
            <CommitInput label="Caption" value={entity.caption ?? ''} onCommit={(v) => setField('caption', v.trim())} placeholder="Uma linha sob o nome" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Tipo">
              <select className={inputClass} value={entity.kind} onChange={(e) => setField('kind', e.target.value)}>
                {Object.entries(KIND_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select className={inputClass} value={entity.status ?? 'live'} onChange={(e) => setField('status', e.target.value === 'live' ? '' : e.target.value)}>
                {['live', 'future', 'deprecated', 'removed'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Pai">
            <select className={inputClass} value={entity.parent ?? ''} onChange={(e) => patch({ parent: e.target.value || null })}>
              {ALLOWED_PARENTS[entity.kind].includes(null) && <option value="">(raiz)</option>}
              {!ALLOWED_PARENTS[entity.kind].includes(null) && !entity.parent && <option value="">Escolha um pai</option>}
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-[var(--fg-soft)]">
            <input type="checkbox" checked={!!entity.external} onChange={(e) => setField('external', e.target.checked || undefined)} className="accent-[var(--accent)]" />
            Externo (fora do controle do time)
          </label>
          <Field label="Tecnologias">
            <CatalogPicker label="Tecnologias" list="technologies" value={entity.technologies ?? []} onChange={(v) => setField('technologies', v)} />
          </Field>
          <Field label="Tags">
            <CatalogPicker label="Tags" list="tags" value={entity.tags ?? []} onChange={(v) => setField('tags', v)} />
          </Field>
          <Field label="Time">
            <select className={inputClass} value={entity.owner ?? ''} onChange={(e) => setField('owner', e.target.value)}>
              <option value="">(nenhum)</option>
              {(model.catalog.teams ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Links">
            <LinksEditor value={entity.links ?? []} onChange={(v) => setField('links', v)} />
          </Field>
          <Field label="Descrição (markdown)">
            <CommitInput label="Descrição" multiline value={entity.description ?? ''} onCommit={(v) => setField('description', v.trim() ? v.replace(/\s+$/, '') + '\n' : '')} />
          </Field>
          <div className="flex flex-wrap gap-2 pt-1">
            {placed && drawing && (
              <Button variant="subtle" onClick={() => write('POST', `/api/drawings/${drawing.id}/ops`, { ops: [{ op: 'remove-nodes', ids: [entity.id] }] }, [drawing.file])}>
                Remover do desenho
              </Button>
            )}
            <Button variant="ghost" className="!text-[var(--danger)]" onClick={() => deleteWithImpact(`/api/entities/${entity.id}`, entity.name, [entity.file])}>
              Excluir do modelo
            </Button>
          </div>
        </div>
      )}
      {tab === 'connections' && (
        <div className="mt-2">
          <SectionTitle>Saída</SectionTitle>
          <ul>{outgoing.map((c) => connRow(c, 'out'))}</ul>
          {!outgoing.length && <p className="px-1 text-[12px] text-[var(--muted)]">Nenhuma. Arraste da borda da caixa até outra para criar.</p>}
          <SectionTitle>Entrada</SectionTitle>
          <ul>{incoming.map((c) => connRow(c, 'in'))}</ul>
          {!incoming.length && <p className="px-1 text-[12px] text-[var(--muted)]">Nenhuma.</p>}
        </div>
      )}
      {tab === 'usage' && (
        <div className="mt-2">
          <SectionTitle>Desenhos</SectionTitle>
          <ul>
            {(index.entityDrawings.get(entity.id) ?? []).map((d) => (
              <li key={d}>
                <button type="button" className="w-full rounded-md px-1 py-1 text-left text-[13px] text-[var(--accent)] hover:bg-[var(--hover)]" onClick={() => openDrawing(d)}>
                  {index.drawings.get(d)?.name}
                </button>
              </li>
            ))}
          </ul>
          <SectionTitle>Fluxos</SectionTitle>
          <ul>
            {[...new Set([...outgoing, ...incoming].flatMap((c) => index.connFlows.get(c.ref) ?? []))].map((f) => (
              <li key={f} className="px-1 py-1 text-[13px] text-[var(--fg)]">
                {model.flows.find((x) => x.id === f)?.name}
              </li>
            ))}
          </ul>
        </div>
      )}
      <FileFooter file={entity.file} />
    </div>
  );
}

function LinksEditor({ value, onChange }: { value: { label: string; url: string }[]; onChange: (v: { label: string; url: string }[]) => void }) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  return (
    <div className="flex flex-col gap-1">
      {value.map((l, i) => (
        <div key={i} className="flex items-center gap-2 text-[12.5px]">
          <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[var(--accent)] hover:underline">
            {l.label}
          </a>
          <button type="button" aria-label={`Remover link ${l.label}`} className="text-[var(--muted)] hover:text-[var(--danger)]" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim() || !url.trim()) return;
          onChange([...value, { label: label.trim(), url: url.trim() }]);
          setLabel('');
          setUrl('');
        }}
      >
        <input className={inputClass} placeholder="Rótulo" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Rótulo do link" />
        <input className={inputClass} placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="URL do link" />
        <Button type="submit" variant="subtle" disabled={!label.trim() || !url.trim()}>
          +
        </Button>
      </form>
    </div>
  );
}

function ConnectionInspector({ conn }: { conn: Conn }) {
  const index = useStore((s) => s.index)!;
  const model = useStore((s) => s.model)!;
  const drawing = useStore(currentDrawing);
  const flowState = useStore((s) => s.flow);
  const { write, deleteWithImpact } = useStore.getState();
  const c = conn.conn;
  const patch = (body: unknown) => write('PATCH', `/api/connections/${conn.ref}`, body, [conn.file]);
  const setField = (key: string, v: unknown) => patch(v === '' || v === undefined || (Array.isArray(v) && !v.length) ? { unset: [key] } : { set: { [key]: v } });
  const edge = drawing?.edges?.[conn.ref];
  const edgeOp = (set: Record<string, unknown>, unset: string[] = []) =>
    drawing && write('POST', `/api/drawings/${drawing.id}/ops`, { ops: [{ op: 'update-edge', ref: conn.ref, set, unset }] }, [drawing.file]);
  const flow = flowState ? model.flows.find((f) => f.id === flowState.id) : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--muted)]">Conexão · {conn.ref}</div>
        <div className="text-[15px] font-semibold text-[var(--fg)]">
          {index.name(conn.from)} {c.direction === 'bidirectional' ? '↔' : '→'} {index.name(conn.to)}
        </div>
      </div>
      {flow && <AddStepButton refId={conn.ref} flowId={flow.id} />}
      <Field label="Rótulo">
        <CommitInput label="Rótulo" value={c.label} onCommit={(v) => setField('label', v.trim())} />
      </Field>
      <div className="flex items-end gap-2">
        <Field label="Direção">
          <select className={inputClass} value={c.direction ?? 'outgoing'} onChange={(e) => setField('direction', e.target.value === 'outgoing' ? '' : e.target.value)}>
            <option value="outgoing">Saída</option>
            <option value="bidirectional">Bidirecional</option>
          </select>
        </Field>
        <Button variant="subtle" onClick={() => patch({ reverse: true })} title="Move a conexão para o arquivo da outra ponta">
          Inverter
        </Button>
      </div>
      <Field label="Via (fila, tópico)">
        <select className={inputClass} value={c.via ?? ''} onChange={(e) => setField('via', e.target.value)}>
          <option value="">(direto)</option>
          {[...index.entities.values()].filter((e) => e.id !== conn.from && e.id !== conn.to).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Tecnologias">
        <CatalogPicker label="Tecnologias" list="technologies" value={c.technologies ?? []} onChange={(v) => setField('technologies', v)} />
      </Field>
      <Field label="Status">
        <select className={inputClass} value={c.status ?? 'live'} onChange={(e) => setField('status', e.target.value === 'live' ? '' : e.target.value)}>
          {['live', 'future', 'deprecated', 'removed'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
      <Field label="Descrição">
        <CommitInput label="Descrição" multiline value={c.description ?? ''} onCommit={(v) => setField('description', v.trim() ? v.replace(/\s+$/, '') + '\n' : '')} />
      </Field>
      {edge && drawing && (
        <>
          <SectionTitle>Conector neste desenho</SectionTitle>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Formato">
              <select className={inputClass} value={edge.shape ?? 'straight'} onChange={(e) => edgeOp({ shape: e.target.value })}>
                <option value="straight">Reto</option>
                <option value="step">Degrau</option>
                <option value="curved">Curvo</option>
              </select>
            </Field>
            {(['from', 'to'] as const).map((k) => (
              <Field key={k} label={k === 'from' ? 'Sai por' : 'Chega por'}>
                <select className={inputClass} value={edge[k] ?? ''} onChange={(e) => (e.target.value ? edgeOp({ [k]: e.target.value }) : edgeOp({}, [k]))}>
                  <option value="">auto</option>
                  {['top', 'right', 'bottom', 'left'].map((s) => (
                    <option key={s} value={s}>
                      {{ top: 'cima', right: 'direita', bottom: 'baixo', left: 'esquerda' }[s]}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <Field label={`Posição do rótulo (${Math.round((edge.labelAt ?? 0.5) * 100)}%)`}>
            <input
              type="range"
              min={0.05}
              max={0.95}
              step={0.05}
              defaultValue={edge.labelAt ?? 0.5}
              key={`${conn.ref}-${edge.labelAt}`}
              onPointerUp={(e) => {
                const v = Number((e.target as HTMLInputElement).value);
                void (v === 0.5 ? edgeOp({}, ['labelAt']) : edgeOp({ labelAt: v }));
              }}
              onKeyUp={(e) => {
                const v = Number((e.target as HTMLInputElement).value);
                void (v === 0.5 ? edgeOp({}, ['labelAt']) : edgeOp({ labelAt: v }));
              }}
              className="accent-[var(--accent)]"
            />
          </Field>
          {edge.points?.length ? (
            <Button variant="subtle" onClick={() => edgeOp({}, ['points'])}>
              Limpar pontos intermediários
            </Button>
          ) : null}
        </>
      )}
      <SectionTitle>Fluxos que usam</SectionTitle>
      <ul>
        {(index.connFlows.get(conn.ref) ?? []).map((f) => (
          <li key={f} className="px-1 text-[13px] text-[var(--fg)]">
            {model.flows.find((x) => x.id === f)?.name}
          </li>
        ))}
        {!(index.connFlows.get(conn.ref) ?? []).length && <li className="px-1 text-[12px] text-[var(--muted)]">Nenhum.</li>}
      </ul>
      <div className="flex flex-wrap gap-2 pt-1">
        {edge && drawing && (
          <Button variant="subtle" onClick={() => write('POST', `/api/drawings/${drawing.id}/ops`, { ops: [{ op: 'remove-edges', refs: [conn.ref] }] }, [drawing.file])}>
            Remover do desenho
          </Button>
        )}
        <Button variant="ghost" className="!text-[var(--danger)]" onClick={() => deleteWithImpact(`/api/connections/${conn.ref}`, `a conexão "${c.label}"`, [conn.file])}>
          Excluir do modelo
        </Button>
      </div>
      <FileFooter file={conn.file} />
    </div>
  );
}

/** Flow mode: creates a step pointing at this connection, focused on its text. */
export function AddStepButton({ refId, flowId }: { refId: string; flowId: string }) {
  const model = useStore((s) => s.model)!;
  const [text, setText] = useState('');
  const flow = model.flows.find((f) => f.id === flowId)!;
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-soft)] p-2.5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        const taken = (id: string) => JSON.stringify(flow.steps ?? []).includes(`"id":"${id}"`);
        const id = freeId(text, taken);
        const r = await useStore.getState().ops([{ op: 'flow.add-steps', flow: flowId, steps: [{ id, via: refId, text: text.trim() }] }], [flow.file]);
        if (r) setText('');
      }}
    >
      <span className="text-[12px] font-medium text-[var(--accent)]">Adicionar passo em “{flow.name}”</span>
      <input autoFocus className={inputClass} placeholder="O que acontece neste passo" value={text} onChange={(e) => setText(e.target.value)} aria-label="Texto do passo" />
      <Button type="submit" disabled={!text.trim()}>
        Adicionar passo
      </Button>
    </form>
  );
}

function DrawingInspector({ drawing }: { drawing: WithFile<Drawing> }) {
  const index = useStore((s) => s.index)!;
  const model = useStore((s) => s.model)!;
  const { write } = useStore.getState();
  const patch = (set: Record<string, unknown>, unset: string[] = []) => write('PATCH', `/api/drawings/${drawing.id}`, { set, unset }, [drawing.file]);
  const placed = new Set(Object.keys(drawing.nodes ?? {}));
  const available = [...index.conns.values()].filter((c) => {
    if (drawing.edges?.[c.ref]) return false;
    const a = index.resolve(drawing, c.from);
    const b = index.resolve(drawing, c.to);
    return a && b && a !== b;
  });
  const ops = (o: unknown[]) => write('POST', `/api/drawings/${drawing.id}/ops`, { ops: o }, [drawing.file]);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--muted)]">Desenho · {drawing.id}</div>
        <div className="text-[16px] font-semibold text-[var(--fg)]">{drawing.name}</div>
      </div>
      <Field label="Nome">
        <CommitInput label="Nome" value={drawing.name} onCommit={(v) => v.trim() && patch({ name: v.trim() })} />
      </Field>
      <Field label="Descrição">
        <CommitInput label="Descrição" multiline value={drawing.description ?? ''} onCommit={(v) => (v.trim() ? patch({ description: v.trim() }) : patch({}, ['description']))} />
      </Field>
      <Field label="Escopo (drill-down)" hint="A entidade cujo interior este desenho detalha">
        <select className={inputClass} value={drawing.scope ?? ''} onChange={(e) => patch({ scope: e.target.value || null })}>
          <option value="">(raiz)</option>
          {[...index.entities.values()].filter((e) => e.kind !== 'actor').map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex gap-2">
        <Button variant="subtle" onClick={() => write('POST', `/api/drawings/${drawing.id}/layout`, {}, [drawing.file])}>
          Organizar automaticamente
        </Button>
        <Button
          variant="subtle"
          onClick={() => {
            const id = freeId('nota', (x) => !!drawing.notes?.some((n) => n.id === x));
            const xs = Object.values(drawing.nodes ?? {}).map((n) => n.x);
            const ys = Object.values(drawing.nodes ?? {}).map((n) => n.y);
            void ops([{ op: 'set-note', note: { id, text: 'Nova nota', x: xs.length ? Math.min(...xs) : 0, y: ys.length ? Math.min(...ys) - 120 : 0, w: 200 } }]);
          }}
        >
          Nova nota
        </Button>
      </div>
      <SectionTitle>Conexões disponíveis ({available.length})</SectionTitle>
      <ul className="flex flex-col">
        {available.map((c) => (
          <li key={c.ref} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-[var(--hover)]">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-[var(--fg)]">{c.conn.label || '(sem rótulo)'}</span>
              <span className="block truncate text-[11px] text-[var(--muted)]">
                {index.name(c.from)} → {index.name(c.to)}
              </span>
            </span>
            <Button variant="subtle" onClick={() => ops([{ op: 'draw-edges', edges: [{ ref: c.ref, shape: 'straight' }] }])}>
              Traçar
            </Button>
          </li>
        ))}
        {!available.length && <li className="px-1 text-[12px] text-[var(--muted)]">Todas as conexões entre as {placed.size} entidades já estão traçadas.</li>}
      </ul>
      <SectionTitle>Fluxos sobre este desenho</SectionTitle>
      <ul>
        {model.flows.filter((f) => f.drawing === drawing.id).map((f) => (
          <li key={f.id} className="px-1 text-[13px] text-[var(--fg)]">
            {f.name}
          </li>
        ))}
      </ul>
      {(drawing.groups ?? []).length > 0 && (
        <>
          <SectionTitle>Grupos</SectionTitle>
          <ul>
            {drawing.groups!.map((g) => (
              <li key={g.id} className="flex items-center justify-between px-1 py-0.5 text-[13px]">
                <span className="text-[var(--fg)]">{g.label}</span>
                <button type="button" className="text-[12px] text-[var(--muted)] hover:text-[var(--danger)]" onClick={() => ops([{ op: 'remove-group', id: g.id }])}>
                  Remover
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <FileFooter file={drawing.file} />
    </div>
  );
}

function GroupInspector({ drawing, id }: { drawing: WithFile<Drawing>; id: string }) {
  const g = drawing.groups?.find((x) => x.id === id);
  const index = useStore((s) => s.index)!;
  if (!g) return null;
  const ops = (o: unknown[]) => useStore.getState().write('POST', `/api/drawings/${drawing.id}/ops`, { ops: o }, [drawing.file]);
  return (
    <div className="flex flex-col gap-3">
      <div className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--muted)]">Grupo visual</div>
      <Field label="Rótulo">
        <CommitInput label="Rótulo" value={g.label} onCommit={(v) => v.trim() && ops([{ op: 'set-group', group: { ...g, label: v.trim() } }])} />
      </Field>
      <Field label="Moldura">
        <select className={inputClass} value={g.style ?? 'dashed'} onChange={(e) => ops([{ op: 'set-group', group: { ...g, style: e.target.value } }])}>
          <option value="dashed">Tracejada</option>
          <option value="solid">Sólida</option>
        </select>
      </Field>
      <p className="text-[12.5px] text-[var(--muted)]">Membros: {g.members.map((m) => index.name(m)).join(', ')}</p>
      <Button variant="ghost" className="!text-[var(--danger)]" onClick={() => ops([{ op: 'remove-group', id: g.id }])}>
        Remover grupo
      </Button>
    </div>
  );
}

function NoteInspector({ drawing, id }: { drawing: WithFile<Drawing>; id: string }) {
  const n = drawing.notes?.find((x) => x.id === id);
  if (!n) return null;
  const ops = (o: unknown[]) => useStore.getState().write('POST', `/api/drawings/${drawing.id}/ops`, { ops: o }, [drawing.file]);
  return (
    <div className="flex flex-col gap-3">
      <div className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--muted)]">Nota</div>
      <Field label="Texto">
        <CommitInput label="Texto" multiline value={n.text} onCommit={(v) => v.trim() && ops([{ op: 'set-note', note: { ...n, text: v.trim() } }])} />
      </Field>
      <Button variant="ghost" className="!text-[var(--danger)]" onClick={() => ops([{ op: 'remove-note', id: n.id }])}>
        Remover nota
      </Button>
    </div>
  );
}

function MultiInspector({ ids }: { ids: string[] }) {
  const drawing = useStore(currentDrawing)!;
  const index = useStore((s) => s.index)!;
  const entities = ids.filter((id) => drawing.nodes?.[id]);
  const ops = (o: unknown[]) => useStore.getState().write('POST', `/api/drawings/${drawing.id}/ops`, { ops: o }, [drawing.file]);
  const rects = entities.map((id) => ({ id, ...drawing.nodes![id], ...index.size(id, drawing.nodes![id]) }));
  const g = useStore.getState().model!.config.grid;
  const snap = (v: number) => Math.round(v / g) * g;
  const align = (how: 'left' | 'top' | 'hcenter' | 'vcenter') => {
    const minX = Math.min(...rects.map((r) => r.x));
    const minY = Math.min(...rects.map((r) => r.y));
    const cx = rects.reduce((a, r) => a + r.x + r.w / 2, 0) / rects.length;
    const cy = rects.reduce((a, r) => a + r.y + r.h / 2, 0) / rects.length;
    const nodes = rects.map((r) => ({
      id: r.id,
      x: how === 'left' ? minX : how === 'hcenter' ? snap(cx - r.w / 2) : r.x,
      y: how === 'top' ? minY : how === 'vcenter' ? snap(cy - r.h / 2) : r.y,
    }));
    return ops([{ op: 'move-nodes', nodes }]);
  };
  const distribute = (axis: 'x' | 'y') => {
    const sorted = [...rects].sort((a, b) => a[axis] - b[axis]);
    const first = sorted[0][axis];
    const last = sorted[sorted.length - 1][axis];
    const step = (last - first) / Math.max(1, sorted.length - 1);
    return ops([{ op: 'move-nodes', nodes: sorted.map((r, i) => ({ id: r.id, x: axis === 'x' ? snap(first + step * i) : r.x, y: axis === 'y' ? snap(first + step * i) : r.y })) }]);
  };
  const action = (label: string, fn: () => void, disabled = false): ReactNode => (
    <Button variant="subtle" onClick={fn} disabled={disabled}>
      {label}
    </Button>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[15px] font-semibold text-[var(--fg)]">{entities.length} entidades selecionadas</div>
      <SectionTitle>Alinhar</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {action('Esquerda', () => align('left'))}
        {action('Topo', () => align('top'))}
        {action('Centro H', () => align('hcenter'))}
        {action('Centro V', () => align('vcenter'))}
      </div>
      <SectionTitle>Distribuir</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {action('Horizontal', () => distribute('x'), entities.length < 3)}
        {action('Vertical', () => distribute('y'), entities.length < 3)}
      </div>
      <SectionTitle>Seleção</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {action('Agrupar (⌘G)', () => window.dispatchEvent(new CustomEvent('zark:group')))}
        {action('Organizar seleção', () => useStore.getState().write('POST', `/api/drawings/${drawing.id}/layout`, { ids: entities }, [drawing.file]))}
        {action('Remover do desenho', () => ops([{ op: 'remove-nodes', ids: entities }]))}
      </div>
    </div>
  );
}

export function Inspector() {
  const selection = useStore((s) => s.selection);
  const index = useStore((s) => s.index)!;
  const drawing = useStore(currentDrawing);
  let content: ReactNode = null;
  if (selection.edges.length === 1 && !selection.nodes.length) {
    const conn = index.conns.get(selection.edges[0]);
    if (conn) content = <ConnectionInspector conn={conn} />;
  } else if (selection.nodes.length > 1) content = <MultiInspector ids={selection.nodes} />;
  else if (selection.nodes.length === 1) {
    const id = selection.nodes[0];
    if (id.startsWith('group:') && drawing) content = <GroupInspector drawing={drawing} id={id.slice(6)} />;
    else if (id.startsWith('note:') && drawing) content = <NoteInspector drawing={drawing} id={id.slice(5)} />;
    else {
      const e = index.entities.get(id);
      if (e) content = <EntityInspector key={id} entity={e} />;
    }
  }
  if (!content && drawing) content = <DrawingInspector drawing={drawing} />;
  return <div className="p-4">{content}</div>;
}
