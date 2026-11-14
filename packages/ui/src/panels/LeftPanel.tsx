import { useMemo, useState, type ReactNode } from 'react';
import { numberSteps } from '@core/flow-text';
import { freeId, KINDS } from '../model';
import { tr, useT } from '../i18n';
import { currentDrawing, useStore } from '../store';
import type { Drawing, WithFile } from '../types';
import { Button, Icon, IconButton, inputClass, Svg, Tabs } from './ui';

function InlineForm({ placeholder, onSubmit, onCancel, extra }: { placeholder: string; onSubmit: (v: string) => void; onCancel: () => void; extra?: ReactNode }) {
  const [value, setValue] = useState('');
  const t = useT();
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
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={!value.trim()}>
          {t('common.create')}
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
  const t = useT();
  const scopes = [...index.drawingsByScope.keys()].sort((a, b) => (a === null ? -1 : b === null ? 1 : index.name(a).localeCompare(index.name(b))));

  const duplicate = async (d: WithFile<Drawing>) => {
    const id = freeId(`${d.id}-copy`, (x) => index.drawings.has(x));
    const r = await ops([
      { op: 'drawing.create', drawing: { id, name: tr('common.copyName', { name: d.name }), description: d.description, scope: d.scope ?? null } },
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
        title: tr('left.deleteDrawingTitle', { name: d.name }),
        lines: [tr('left.deleteDrawingLine')],
        confirmLabel: tr('left.deleteDrawing'),
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
          <Svg icon={Icon.plus} size={14} /> {t('left.newDrawing')}
        </Button>
      </div>
      {creating && (
        <InlineForm
          placeholder={active?.scope ? t('left.drawingNameIn', { scope: index.name(active.scope) }) : t('left.drawingName')}
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
          <div className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{scope ? index.name(scope) : t('left.root')}</div>
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
                <div data-edit className="flex text-[var(--subtle)]">
                  <IconButton label={t('left.rename', { name: d.name })} className="!size-6" onClick={() => setRenaming(d.id)}>
                    <Svg icon={Icon.pencil} size={13} />
                  </IconButton>
                  <IconButton label={t('left.duplicate', { name: d.name })} className="!size-6" onClick={() => duplicate(d)}>
                    <Svg icon={Icon.copy} size={13} />
                  </IconButton>
                  <IconButton label={t('left.delete', { name: d.name })} className="!size-6 hover:!text-[var(--danger)]" onClick={() => remove(d)}>
                    <Svg icon={Icon.trash} size={13} />
                  </IconButton>
                </div>
              </div>
            ),
          )}
        </div>
      ))}
      {!model.drawings.length && <p className="px-2 py-4 text-[13px] text-[var(--muted)]">{t('left.noDrawings')}</p>}
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
  const t = useT();
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
          title={present ? t('left.inDrawing') : t('left.dragHint')}
        >
          <span className={`size-1.5 shrink-0 rounded-full ${present ? 'bg-[var(--accent)]' : 'bg-transparent ring-1 ring-[var(--subtle)]'}`} aria-label={present ? t('left.placed') : t('left.notPlaced')} />
          <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--fg)]">{e.name}</span>
          <span className="font-mono text-[10px] uppercase text-[var(--subtle)]">{t(`kind.${e.kind}`)}</span>
          <span className="w-4 text-right text-[11px] text-[var(--muted)]" title={t('left.appearsIn', { n: count })}>
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
        <input className={inputClass} placeholder={t('left.searchModel')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('left.searchModel')} />
        <select className={`${inputClass} !w-[92px]`} value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t('left.filterKind')}>
          <option value="">{t('common.kind')}</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kind.${k}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex justify-end">
        <Button variant="ghost" onClick={() => setCreating(true)}>
          <Svg icon={Icon.plus} size={14} /> {t('left.newEntity')}
        </Button>
      </div>
      {creating && (
        <InlineForm
          placeholder={t('quick.name')}
          onCancel={() => setCreating(false)}
          extra={
            <select className={inputClass} value={newKind} onChange={(e) => setNewKind(e.target.value)} aria-label={t('common.kind')}>
              {['actor', 'system'].map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
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
      {!index.entities.size && <p className="px-2 py-4 text-[13px] text-[var(--muted)]">{t('left.emptyModel')}</p>}
    </div>
  );
}

function FlowsTab() {
  const model = useStore((s) => s.model)!;
  const index = useStore((s) => s.index)!;
  const drawing = useStore(currentDrawing);
  const flow = useStore((s) => s.flow);
  const [creating, setCreating] = useState(false);
  const t = useT();
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
          <Svg icon={Icon.plus} size={14} /> {t('left.newFlow')}
        </Button>
      </div>
      {creating && drawing && (
        <InlineForm
          placeholder={t('left.flowName', { drawing: drawing.name })}
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
            {index.drawings.get(f.drawing)?.name ?? f.drawing} · {t('left.steps', { n: numberSteps(f.steps).length })}
          </span>
        </button>
      ))}
      {!model.flows.length && <p className="px-2 py-4 text-[13px] text-[var(--muted)]">{t('left.noFlows')}</p>}
    </div>
  );
}

export function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  const set = useStore((s) => s.set);
  const t = useT();
  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)]" aria-label={t('left.panel')}>
      <div className="p-2">
        <Tabs value={tab} onChange={(v) => set({ leftTab: v })} items={[['drawings', t('left.tabDrawings')], ['model', t('left.tabModel')], ['flows', t('left.tabFlows')]]} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {tab === 'drawings' && <DrawingsTab />}
        {tab === 'model' && <ModelTab />}
        {tab === 'flows' && <FlowsTab />}
      </div>
    </aside>
  );
}

