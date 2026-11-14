import { useMemo, useState, type ReactNode } from 'react';
import { numberSteps } from '@core/flow-text';
import { freeId, KIND_LABEL } from '../model';
import { currentDrawing, useStore } from '../store';
import type { Drawing, WithFile } from '../types';
import { Button, Icon, IconButton, inputClass, Svg, Tabs } from './ui';

function InlineForm({ placeholder, onSubmit, onCancel, extra }: { placeholder: string; onSubmit: (v: string) => void; onCancel: () => void; extra?: ReactNode }) {
  const [value, setValue] = useState('');
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <input autoFocus className={inputClass} placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onCancel()} />
      {extra}
      <div className="flex justify-end gap-1">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!value.trim()}>
          Criar
        </Button>
      </div>
    </form>
  );
}

function DrawingsTab() {
  const model = useStore((s) => s.model)!;
  const index = useStore((s) => s.index)!;
  const active = useStore(currentDrawing);
  const { openDrawing, write, ops, set } = useStore.getState();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string>();
  const scopes = [...index.drawingsByScope.keys()].sort((a, b) => (a === null ? -1 : b === null ? 1 : index.name(a).localeCompare(index.name(b))));

  const duplicate = async (d: WithFile<Drawing>) => {
    const id = freeId(`${d.id}-copia`, (x) => index.drawings.has(x));
    const r = await ops([
      { op: 'drawing.create', drawing: { id, name: `${d.name} (cópia)`, description: d.description, scope: d.scope ?? null } },
      { op: 'drawing.place', drawing: id, nodes: Object.entries(d.nodes ?? {}).map(([nid, n]) => ({ id: nid, ...n })) },
      { op: 'drawing.draw-edges', drawing: id, edges: Object.entries(d.edges ?? {}).map(([ref, e]) => ({ ref, ...e })) },
      ...(d.groups ?? []).map((group) => ({ op: 'drawing.set-group', drawing: id, group })),
      ...(d.notes ?? []).map((note) => ({ op: 'drawing.set-note', drawing: id, note })),
    ]);
    if (r) openDrawing(id);
  };
  const remove = (d: WithFile<Drawing>) =>
    set({
      confirm: {
        title: `Excluir o desenho "${d.name}"?`,
        lines: ['Só o desenho é apagado. Entidades e conexões continuam no modelo.'],
        confirmLabel: 'Excluir desenho',
        danger: true,
        onConfirm: async () => {
          await write('DELETE', `/api/drawings/${d.id}`, undefined, [d.file]);
        },
      },
    });

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-end">
        <Button variant="ghost" onClick={() => setCreating(true)}>
          <Svg icon={Icon.plus} size={14} /> Novo desenho
        </Button>
      </div>
      {creating && (
        <InlineForm
          placeholder={`Nome do desenho${active?.scope ? ` (dentro de ${index.name(active.scope)})` : ''}`}
          onCancel={() => setCreating(false)}
          onSubmit={async (name) => {
            const id = freeId(name, (x) => index.drawings.has(x));
            const r = await write('POST', '/api/drawings', { drawing: { id, name, scope: active?.scope ?? null } });
            if (r) {
              setCreating(false);
              openDrawing(id);
            }
          }}
        />
      )}
      {scopes.map((scope) => (
        <div key={scope ?? 'root'}>
          <div className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{scope ? index.name(scope) : 'Raiz'}</div>
          {index.drawingsByScope.get(scope)!.map((d) =>
            renaming === d.id ? (
              <form
                key={d.id}
                className="px-1"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const name = new FormData(e.currentTarget).get('name') as string;
                  if (name.trim()) await write('PATCH', `/api/drawings/${d.id}`, { set: { name: name.trim() } }, [d.file]);
                  setRenaming(undefined);
                }}
              >
                <input name="name" autoFocus defaultValue={d.name} className={inputClass} onBlur={() => setRenaming(undefined)} onKeyDown={(e) => e.key === 'Escape' && setRenaming(undefined)} />
              </form>
            ) : (
              <div key={d.id} className={`group flex items-center rounded-md pr-1 ${active?.id === d.id ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--hover)]'}`}>
                <button type="button" onClick={() => openDrawing(d.id)} className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-1.5 text-left">
                  <span className={`truncate text-[13px] ${active?.id === d.id ? 'font-semibold text-[var(--accent)]' : 'text-[var(--fg)]'}`}>{d.name}</span>
                  <span className="shrink-0 text-[11px] text-[var(--muted)]">{Object.keys(d.nodes ?? {}).length}</span>
                </button>
                <div className="flex text-[var(--subtle)]">
                  <IconButton label={`Renomear ${d.name}`} className="!size-6" onClick={() => setRenaming(d.id)}>
                    <Svg icon={Icon.pencil} size={13} />
                  </IconButton>
                  <IconButton label={`Duplicar ${d.name}`} className="!size-6" onClick={() => duplicate(d)}>
                    <Svg icon={Icon.copy} size={13} />
                  </IconButton>
                  <IconButton label={`Excluir ${d.name}`} className="!size-6 hover:!text-[var(--danger)]" onClick={() => remove(d)}>
                    <Svg icon={Icon.trash} size={13} />
                  </IconButton>
                </div>
              </div>
            ),
          )}
        </div>
      ))}
      {!model.drawings.length && <p className="px-2 py-4 text-[13px] text-[var(--muted)]">Nenhum desenho ainda.</p>}
    </div>
  );
}

function ModelTab() {
  const index = useStore((s) => s.index)!;
  const drawing = useStore(currentDrawing);
  const selection = useStore((s) => s.selection);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKind, setNewKind] = useState('system');
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const match = (id: string) => {
      const e = index.entities.get(id)!;
      return (!q || e.name.toLowerCase().includes(q) || id.includes(q)) && (!kind || e.kind === kind);
    };
    const keep = new Set<string>();
    for (const id of index.entities.keys()) if (match(id)) index.ancestors(id).forEach((a) => keep.add(a));
    return keep;
  }, [index, q, kind]);
  const roots = [...index.entities.values()].filter((e) => !e.parent || !index.entities.has(e.parent)).map((e) => e.id);

  const renderItem = (id: string, depth: number): ReactNode => {
    if (!visible.has(id)) return null;
    const e = index.entities.get(id)!;
    const count = index.entityDrawings.get(id)?.length ?? 0;
    const present = !!drawing?.nodes?.[id];
    const kids = (index.children.get(id) ?? []).slice().sort((a, b) => index.name(a).localeCompare(index.name(b)));
    return (
      <li key={id}>
        <button
          type="button"
          draggable
          onDragStart={(ev) => {
            ev.dataTransfer.setData('application/zark-entity', id);
            ev.dataTransfer.effectAllowed = 'copy';
          }}
          onClick={() => useStore.getState().select([id])}
          className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left ${selection.nodes.includes(id) ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--hover)]'}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          title={present ? 'Já está neste desenho' : 'Arraste para o canvas para posicionar'}
        >
          <span className={`size-1.5 shrink-0 rounded-full ${present ? 'bg-[var(--accent)]' : 'bg-transparent ring-1 ring-[var(--subtle)]'}`} aria-label={present ? 'no desenho' : 'fora do desenho'} />
          <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--fg)]">{e.name}</span>
          <span className="font-mono text-[10px] uppercase text-[var(--subtle)]">{KIND_LABEL[e.kind]}</span>
          <span className="w-4 text-right text-[11px] text-[var(--muted)]" title={`Aparece em ${count} desenho(s)`}>
            {count}
          </span>
        </button>
        {kids.length > 0 && <ul>{kids.map((k) => renderItem(k, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <input className={inputClass} placeholder="Buscar no modelo" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar no modelo" />
        <select className={`${inputClass} !w-[92px]`} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filtrar por tipo">
          <option value="">Tipo</option>
          {Object.entries(KIND_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="flex justify-end">
        <Button variant="ghost" onClick={() => setCreating(true)}>
          <Svg icon={Icon.plus} size={14} /> Nova entidade
        </Button>
      </div>
      {creating && (
        <InlineForm
          placeholder="Nome da entidade"
          onCancel={() => setCreating(false)}
          extra={
            <select className={inputClass} value={newKind} onChange={(e) => setNewKind(e.target.value)} aria-label="Tipo">
              {['actor', 'system'].map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          }
          onSubmit={async (name) => {
            const id = freeId(name, (x) => index.entities.has(x));
            const r = await useStore.getState().write('POST', '/api/entities', { entity: { id, name, kind: newKind } });
            if (r) {
              setCreating(false);
              useStore.getState().select([id]);
            }
          }}
        />
      )}
      <ul>{roots.sort((a, b) => index.name(a).localeCompare(index.name(b))).map((id) => renderItem(id, 0))}</ul>
      {!index.entities.size && <p className="px-2 py-4 text-[13px] text-[var(--muted)]">O modelo está vazio.</p>}
    </div>
  );
}

function FlowsTab() {
  const model = useStore((s) => s.model)!;
  const index = useStore((s) => s.index)!;
  const drawing = useStore(currentDrawing);
  const flow = useStore((s) => s.flow);
  const [creating, setCreating] = useState(false);
  const open = (id: string) => {
    const f = useStore.getState().model!.flows.find((x) => x.id === id)!;
    const s = useStore.getState();
    s.openDrawing(f.drawing);
    s.set({ flow: { id, frame: 0, playing: false, speed: 1, choice: {} }, selection: { nodes: [], edges: [] } });
    history.replaceState(null, '', `#flow=${id}`);
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-end">
        <Button variant="ghost" onClick={() => setCreating(true)} disabled={!drawing}>
          <Svg icon={Icon.plus} size={14} /> Novo fluxo
        </Button>
      </div>
      {creating && drawing && (
        <InlineForm
          placeholder={`Nome do fluxo (sobre ${drawing.name})`}
          onCancel={() => setCreating(false)}
          onSubmit={async (name) => {
            const id = freeId(name, (x) => model.flows.some((f) => f.id === x));
            const r = await useStore.getState().write('POST', '/api/flows', { flow: { id, name, drawing: drawing.id, steps: [] } });
            if (r) {
              setCreating(false);
              open(id);
            }
          }}
        />
      )}
      {model.flows.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => open(f.id)}
          className={`flex flex-col rounded-md px-2 py-1.5 text-left ${flow?.id === f.id ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--hover)]'}`}
        >
          <span className={`truncate text-[13px] ${flow?.id === f.id ? 'font-semibold text-[var(--accent)]' : 'text-[var(--fg)]'}`}>{f.name}</span>
          <span className="text-[11px] text-[var(--muted)]">
            {index.drawings.get(f.drawing)?.name ?? f.drawing} · {numberSteps(f.steps).length} passos
          </span>
        </button>
      ))}
      {!model.flows.length && <p className="px-2 py-4 text-[13px] text-[var(--muted)]">Nenhum fluxo ainda.</p>}
    </div>
  );
}

export function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  const set = useStore((s) => s.set);
  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)]" aria-label="Painel esquerdo">
      <div className="p-2">
        <Tabs value={tab} onChange={(v) => set({ leftTab: v })} items={[['drawings', 'Desenhos'], ['model', 'Modelo'], ['flows', 'Fluxos']]} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {tab === 'drawings' && <DrawingsTab />}
        {tab === 'model' && <ModelTab />}
        {tab === 'flows' && <FlowsTab />}
      </div>
    </aside>
  );
}

