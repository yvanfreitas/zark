import { useMemo, useState, type ReactNode } from 'react';
import { freeId, KINDS } from '../model';
import { useT } from '../i18n';
import { rightView } from '../rightPanel';
import { currentDrawing, useStore } from '../store';
import { Inspector } from './Inspector';
import { InlineForm } from './LeftPanel';
import { Button, Icon, inputClass, Svg } from './ui';

/** Entry at the top of the list that opens the current drawing's properties. */
function DrawingEntry() {
  const drawing = useStore(currentDrawing);
  const t = useT();
  if (!drawing) return null;
  return (
    <button
      type="button"
      onClick={() => useStore.getState().set({ drawingDetails: true })}
      className="flex w-full items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-left hover:bg-[var(--hover)]"
    >
      <span className="text-[var(--subtle)]">
        <Svg icon={Icon.drawing} size={12} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--fg)]">
        <span className="text-[var(--muted)]">{t('right.drawingEntry')}</span> {drawing.name}
      </span>
      <span className="text-[var(--subtle)]">
        <Svg icon={Icon.next} size={12} />
      </span>
    </button>
  );
}

function ModelBrowser() {
  const index = useStore((s) => s.index)!;
  const drawing = useStore(currentDrawing);
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
          className="flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left hover:bg-[var(--hover)]"
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
    <div className="flex flex-col gap-2 p-3">
      <DrawingEntry />
      <div className="flex items-center justify-between pt-1">
        <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{t('right.model')}</h2>
        <Button variant="ghost" onClick={() => setCreating(true)}>
          <Svg icon={Icon.plus} size={14} /> {t('left.newEntity')}
        </Button>
      </div>
      <div className="flex gap-1.5">
        <input className={inputClass} placeholder={t('left.searchModel')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('left.searchModel')} />
        <select className={`${inputClass} !w-[100px]`} value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t('left.filterKind')}>
          <option value="">{t('common.kind')}</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kind.${k}`)}
            </option>
          ))}
        </select>
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

/** Right panel outside flow mode: the model list, and the inspector as its detail view. */
export function ModelPanel() {
  const view = useStore((s) => rightView(s.selection, s.drawingDetails, !!currentDrawing(s)));
  const t = useT();
  if (view === 'list') return <ModelBrowser />;
  return (
    <>
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--panel)] px-2 py-1.5">
        <button
          type="button"
          onClick={() => useStore.getState().select([])}
          title={t('right.backToModel')}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[12.5px] font-medium text-[var(--fg-soft)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
        >
          <Svg icon={Icon.prev} size={12} /> {t('right.model')}
        </button>
      </div>
      <Inspector />
    </>
  );
}
