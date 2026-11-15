import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { numberSteps } from '@core/flow-text';
import { buildDrawingTree, type DrawingTreeNode } from '../drawingTree';
import { freeId } from '../model';
import { tr, useT } from '../i18n';
import { currentDrawing, useStore } from '../store';
import type { Drawing, Flow, WithFile } from '../types';
import { Button, Icon, IconButton, inputClass, Svg } from './ui';

export function InlineForm({ placeholder, onSubmit, onCancel, extra }: { placeholder: string; onSubmit: (v: string) => void; onCancel: () => void; extra?: ReactNode }) {
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

const ROW = 'group flex items-center rounded-md pr-1';
const INDENT = 14;

function Chevron({ open, label, onToggle }: { open: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" aria-expanded={open} aria-label={label} title={label} onClick={onToggle} className="grid size-5 shrink-0 place-items-center rounded text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]">
      <Svg icon={open ? Icon.down : Icon.next} size={12} />
    </button>
  );
}

function RenameForm({ value, onSubmit, onDone }: { value: string; onSubmit: (name: string) => Promise<unknown>; onDone: () => void }) {
  return (
    <form
      className="px-1"
      onSubmit={async (e) => {
        e.preventDefault();
        const name = (new FormData(e.currentTarget).get('name') as string).trim();
        if (name && name !== value) await onSubmit(name);
        onDone();
      }}
    >
      <input name="name" autoFocus defaultValue={value} className={inputClass} onBlur={onDone} onKeyDown={(e) => e.key === 'Escape' && onDone()} />
    </form>
  );
}

function openFlowMode(id: string) {
  const s = useStore.getState();
  const f = s.model!.flows.find((x) => x.id === id)!;
  s.openDrawing(f.drawing);
  s.set({ flow: { id, frame: 0, playing: false, speed: 1, choice: {} }, selection: { nodes: [], edges: [] } });
  history.replaceState(null, '', `#flow=${id}`);
}

function DrawingsTree() {
  const model = useStore((s) => s.model)!;
  const index = useStore((s) => s.index)!;
  const active = useStore(currentDrawing);
  const flow = useStore((s) => s.flow);
  const { openDrawing, write, ops, set } = useStore.getState();
  const [creating, setCreating] = useState<'drawing' | 'flow'>();
  const [renaming, setRenaming] = useState<string>();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const t = useT();
  const tree = useMemo(() => buildDrawingTree(index, model.flows), [index, model.flows]);

  // Reveal the active drawing (and, in flow mode, the drawing holding the active flow).
  useEffect(() => {
    if (!active) return;
    const reveal: string[] = flow ? [active.id] : [];
    for (let p = tree.parentOf.get(active.id); p && !reveal.includes(p); p = tree.parentOf.get(p)) reveal.push(p);
    setCollapsed((prev) => (reveal.some((id) => prev.has(id)) ? new Set([...prev].filter((id) => !reveal.includes(id))) : prev));
  }, [active?.id, flow?.id, tree]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

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
  const removeDrawing = (d: WithFile<Drawing>) =>
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
  const removeFlow = (f: WithFile<Flow>) =>
    set({
      confirm: {
        title: tr('left.deleteFlowTitle', { name: f.name }),
        lines: [tr('left.deleteFlowLine')],
        confirmLabel: tr('left.deleteFlow'),
        danger: true,
        onConfirm: async () => {
          // Flow mode reads the flow from the model: leave it before the flow disappears.
          if (useStore.getState().flow?.id === f.id) {
            set({ flow: null });
            history.replaceState(null, '', location.pathname + location.search);
          }
          await write('DELETE', `/api/flows/${f.id}`, undefined, [f.file]);
        },
      },
    });

  const flowRow = (f: WithFile<Flow>, depth: number): ReactNode => {
    const key = `flow:${f.id}`;
    const isActive = flow?.id === f.id;
    return (
      <li key={key}>
        {renaming === key ? (
          <RenameForm value={f.name} onSubmit={(name) => write('PATCH', `/api/flows/${f.id}`, { set: { name } }, [f.file])} onDone={() => setRenaming(undefined)} />
        ) : (
          <div className={`${ROW} ${isActive ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--hover)]'}`} style={{ paddingLeft: depth * INDENT }}>
            <span className="size-5 shrink-0" />
            <button type="button" onClick={() => openFlowMode(f.id)} aria-current={isActive || undefined} className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1 pr-2 text-left">
              <span className={isActive ? 'text-[var(--accent)]' : 'text-[var(--subtle)]'}>
                <Svg icon={Icon.play} size={11} />
              </span>
              <span className={`min-w-0 flex-1 truncate text-[12.5px] italic ${isActive ? 'font-semibold text-[var(--accent)]' : 'text-[var(--fg-soft)]'}`}>{f.name}</span>
              <span className="shrink-0 text-[11px] text-[var(--muted)]" title={t('left.steps', { n: numberSteps(f.steps).length })}>
                {numberSteps(f.steps).length}
              </span>
            </button>
            <div data-edit className="flex text-[var(--subtle)]">
              <IconButton label={t('left.rename', { name: f.name })} className="!size-6" onClick={() => setRenaming(key)}>
                <Svg icon={Icon.pencil} size={13} />
              </IconButton>
              <IconButton label={t('left.delete', { name: f.name })} className="!size-6 hover:!text-[var(--danger)]" onClick={() => removeFlow(f)}>
                <Svg icon={Icon.trash} size={13} />
              </IconButton>
            </div>
          </div>
        )}
      </li>
    );
  };

  const drawingRow = (node: DrawingTreeNode, depth: number): ReactNode => {
    const d = node.drawing;
    const isActive = active?.id === d.id;
    const hasChildren = node.children.length + node.flows.length > 0;
    const open = !collapsed.has(d.id);
    return (
      <li key={d.id}>
        {renaming === d.id ? (
          <RenameForm value={d.name} onSubmit={(name) => write('PATCH', `/api/drawings/${d.id}`, { set: { name } }, [d.file])} onDone={() => setRenaming(undefined)} />
        ) : (
          <div className={`${ROW} ${isActive && !flow ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--hover)]'}`} style={{ paddingLeft: depth * INDENT }}>
            {hasChildren ? <Chevron open={open} label={t(open ? 'left.collapse' : 'left.expand', { name: d.name })} onToggle={() => toggle(d.id)} /> : <span className="size-5 shrink-0" />}
            <button
              type="button"
              // Clicking the drawing already open shows its properties in the right panel.
              onClick={() => (isActive && !flow ? set({ drawingDetails: true, selection: { nodes: [], edges: [] }, right: 'inspector' }) : openDrawing(d.id))}
              aria-current={(isActive && !flow) || undefined}
              className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1 pr-2 text-left"
            >
              <span className={isActive ? 'text-[var(--accent)]' : 'text-[var(--subtle)]'}>
                <Svg icon={Icon.drawing} size={12} />
              </span>
              <span className={`min-w-0 flex-1 truncate text-[13px] ${isActive ? 'font-semibold text-[var(--accent)]' : 'text-[var(--fg)]'}`}>{d.name}</span>
              <span className="shrink-0 text-[11px] text-[var(--muted)]">{Object.keys(d.nodes ?? {}).length}</span>
            </button>
            <div data-edit className="flex text-[var(--subtle)]">
              <IconButton label={t('left.rename', { name: d.name })} className="!size-6" onClick={() => setRenaming(d.id)}>
                <Svg icon={Icon.pencil} size={13} />
              </IconButton>
              <IconButton label={t('left.duplicate', { name: d.name })} className="!size-6" onClick={() => duplicate(d)}>
                <Svg icon={Icon.copy} size={13} />
              </IconButton>
              <IconButton label={t('left.delete', { name: d.name })} className="!size-6 hover:!text-[var(--danger)]" onClick={() => removeDrawing(d)}>
                <Svg icon={Icon.trash} size={13} />
              </IconButton>
            </div>
          </div>
        )}
        {hasChildren && open && (
          <ul>
            {node.children.map((c) => drawingRow(c, depth + 1))}
            {node.flows.map((f) => flowRow(f, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-end gap-1">
        <Button variant="ghost" onClick={() => setCreating('flow')} disabled={!active}>
          <Svg icon={Icon.plus} size={14} /> {t('left.newFlow')}
        </Button>
        <Button variant="ghost" onClick={() => setCreating('drawing')}>
          <Svg icon={Icon.plus} size={14} /> {t('left.newDrawing')}
        </Button>
      </div>
      {creating === 'drawing' && (
        <InlineForm
          placeholder={active?.scope ? t('left.drawingNameIn', { scope: index.name(active.scope) }) : t('left.drawingName')}
          onCancel={() => setCreating(undefined)}
          onSubmit={async (name) => {
            const id = freeId(name, (x) => index.drawings.has(x));
            const r = await write('POST', '/api/drawings', { drawing: { id, name, scope: active?.scope ?? null } });
            if (r) {
              setCreating(undefined);
              openDrawing(id);
            }
          }}
        />
      )}
      {creating === 'flow' && active && (
        <InlineForm
          placeholder={t('left.flowName', { drawing: active.name })}
          onCancel={() => setCreating(undefined)}
          onSubmit={async (name) => {
            const id = freeId(name, (x) => model.flows.some((f) => f.id === x));
            const r = await write('POST', '/api/flows', { flow: { id, name, drawing: active.id, steps: [] } });
            if (r) {
              setCreating(undefined);
              openFlowMode(id);
            }
          }}
        />
      )}
      <ul>{tree.roots.map((n) => drawingRow(n, 0))}</ul>
      {!model.drawings.length && <p className="px-2 py-4 text-[13px] text-[var(--muted)]">{t('left.noDrawings')}</p>}
      {tree.unassignedFlows.length > 0 && (
        <div>
          <div className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{t('left.unassignedFlows')}</div>
          <ul>{tree.unassignedFlows.map((f) => flowRow(f, 0))}</ul>
        </div>
      )}
    </div>
  );
}

export function LeftPanel() {
  const t = useT();
  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)]" aria-label={t('left.panel')}>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-2">
        <DrawingsTree />
      </div>
    </aside>
  );
}
