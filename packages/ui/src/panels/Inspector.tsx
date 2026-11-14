import { useEffect, useState, type ReactNode } from 'react';
import { ALLOWED_PARENTS, freeId, KINDS } from '../model';
import { tr, useT } from '../i18n';
import { currentDrawing, useStore } from '../store';
import type { Conn, Drawing, Entity, WithFile } from '../types';
import { Button, Field, Icon, IconButton, inputClass, SectionTitle, Svg, Tabs } from './ui';
import { openMenuAt } from './Menu';
import { addNote, autoLayout, groupSelection, openFlow, removeSelectionFromDrawing, selectionMenu } from '../actions';
import { IconField } from './IconPicker';

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
  const t = useT();
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
            <button type="button" aria-label={t('insp.removeItem', { id })} className="text-[var(--muted)] hover:text-[var(--danger)]" onClick={() => onChange(value.filter((v) => v !== id))}>
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
        <input list={`dl-${list}`} aria-label={label} className={inputClass} placeholder={t('insp.add')} value={adding} onChange={(e) => setAdding(e.target.value)} />
        <datalist id={`dl-${list}`}>
          {items.filter((i) => !value.includes(i.id)).map((i) => (
            <option key={i.id} value={i.name} />
          ))}
        </datalist>
      </form>
    </div>
  );
}

/** Kicker + title of the selected item, with the same actions the canvas right-click offers. */
function Header({ kicker, title, small }: { kicker: string; title?: string; small?: boolean }) {
  const t = useT();
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--muted)]">{kicker}</div>
        {title && <div className={`${small ? 'text-[15px]' : 'text-[16px]'} font-semibold text-[var(--fg)]`}>{title}</div>}
      </div>
      <IconButton data-edit className="-mr-1 -mt-1 shrink-0" label={t('menu.more')} aria-haspopup="menu" onClick={(e) => openMenuAt(e.currentTarget, selectionMenu())}>
        <Svg icon={Icon.more} />
      </IconButton>
    </div>
  );
}

/** Flow names that open the flow: a list of dead text gave no way to get there. */
function FlowLinks({ ids, empty }: { ids: string[]; empty: string }) {
  const flows = useStore((s) => s.model!.flows);
  return (
    <ul>
      {ids.map((f) => (
        <li key={f}>
          <button type="button" className="w-full rounded-md px-1 py-1 text-left text-[13px] text-[var(--accent)] hover:bg-[var(--hover)]" onClick={() => openFlow(f)}>
            {flows.find((x) => x.id === f)?.name ?? f}
          </button>
        </li>
      ))}
      {!ids.length && <li className="px-1 text-[12px] text-[var(--muted)]">{empty}</li>}
    </ul>
  );
}

function FileFooter({ file }: { file: string }) {
  const root = useStore((s) => s.model?.root);
  const abs = root ? `${root.replace(/\\/g, '/')}/${file}` : undefined;
  const t = useT();
  return (
    <div className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
      <code className="truncate text-[11px] text-[var(--muted)]">{file}</code>
      {abs && (
        <a className="shrink-0 text-[12px] font-medium text-[var(--accent)] hover:underline" href={`vscode://file/${abs}`}>
          {t('insp.openEditor')}
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
  const t = useT();
  const patch = (body: unknown) => write('PATCH', `/api/entities/${entity.id}`, body, [entity.file]);
  const setField = (key: string, v: unknown) => patch(v === '' || v === undefined || (Array.isArray(v) && !v.length) ? { unset: [key] } : { set: { [key]: v } });
  const parents = [...index.entities.values()].filter((e) => ALLOWED_PARENTS[entity.kind].includes(e.kind) && e.id !== entity.id);
  const placed = !!drawing?.nodes?.[entity.id];

  const outgoing = (entity.connections ?? []).map((c) => index.conns.get(`${entity.id}.${c.id}`)!);
  const incoming = [...index.conns.values()].filter((c) => c.to === entity.id);
  const toggle = async (c: Conn, on: boolean) => {
    if (!drawing) return;
    const ops = on ? [{ op: 'draw-edges', edges: [{ ref: c.ref, shape: 'auto' }] }] : [{ op: 'remove-edges', refs: [c.ref] }];
    await write('POST', `/api/drawings/${drawing.id}/ops`, { ops }, [drawing.file]);
  };
  const drawable = (c: Conn) => !!drawing && !!index.resolve(drawing, c.from) && !!index.resolve(drawing, c.to) && index.resolve(drawing, c.from) !== index.resolve(drawing, c.to);

  const connRow = (c: Conn, dir: 'out' | 'in') => (
    <li key={c.ref} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-[var(--hover)]">
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => select([], [c.ref])}>
        <span className="block truncate text-[13px] text-[var(--fg)]">{c.conn.label || t('common.noLabel')}</span>
        <span className="block truncate text-[11px] text-[var(--muted)]">{dir === 'out' ? `→ ${index.name(c.to)}` : `← ${index.name(c.from)}`}</span>
      </button>
      <label className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--muted)]" title={drawable(c) ? t('insp.showHere') : t('insp.endsMissing')}>
        <input type="checkbox" disabled={!drawable(c)} checked={!!drawing?.edges?.[c.ref]} onChange={(e) => toggle(c, e.target.checked)} className="accent-[var(--accent)]" />
        {t('insp.inThisDrawing')}
      </label>
    </li>
  );

  return (
    <div>
      <div className="mb-3">
        <Header kicker={`${entity.external ? t('insp.external') : ''}${t(`kind.${entity.kind}`)}`} title={entity.name} />
      </div>
      <Tabs value={tab} onChange={setTab} items={[['details', t('insp.tabDetails')], ['connections', t('insp.tabConnections', { n: outgoing.length + incoming.length })], ['usage', t('insp.tabUsage')]]} />
      {tab === 'details' && (
        <div className="mt-3 flex flex-col gap-3">
          <Field label={t('insp.name')}>
            <CommitInput label={t('insp.name')} value={entity.name} onCommit={(v) => v.trim() && setField('name', v.trim())} />
          </Field>
          <Field label={t('insp.caption')}>
            <CommitInput label={t('insp.caption')} value={entity.caption ?? ''} onCommit={(v) => setField('caption', v.trim())} placeholder={t('insp.captionPlaceholder')} />
          </Field>
          {/* Not a <label>: it would hijack clicks and the accessible name of the buttons inside. */}
          <div role="group" aria-labelledby="icon-field-label" className="flex flex-col gap-1">
            <span id="icon-field-label" className="text-[11.5px] font-medium text-[var(--muted)]">
              {t('icon.field')}
            </span>
            <IconField entity={entity} onChange={(v) => setField('icon', v)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('common.kind')}>
              <select className={inputClass} value={entity.kind} onChange={(e) => setField('kind', e.target.value)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kind.${k}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('insp.status')}>
              <select className={inputClass} value={entity.status ?? 'live'} onChange={(e) => setField('status', e.target.value === 'live' ? '' : e.target.value)}>
                {['live', 'future', 'deprecated', 'removed'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t('insp.parent')}>
            <select className={inputClass} value={entity.parent ?? ''} onChange={(e) => patch({ parent: e.target.value || null })}>
              {ALLOWED_PARENTS[entity.kind].includes(null) && <option value="">{t('insp.rootOption')}</option>}
              {!ALLOWED_PARENTS[entity.kind].includes(null) && !entity.parent && <option value="">{t('insp.chooseParent')}</option>}
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-[var(--fg-soft)]">
            <input type="checkbox" checked={!!entity.external} onChange={(e) => setField('external', e.target.checked || undefined)} className="accent-[var(--accent)]" />
            {t('insp.externalCheck')}
          </label>
          <Field label={t('insp.technologies')}>
            <CatalogPicker label={t('insp.technologies')} list="technologies" value={entity.technologies ?? []} onChange={(v) => setField('technologies', v)} />
          </Field>
          <Field label={t('insp.tags')}>
            <CatalogPicker label={t('insp.tags')} list="tags" value={entity.tags ?? []} onChange={(v) => setField('tags', v)} />
          </Field>
          <Field label={t('insp.team')}>
            <select className={inputClass} value={entity.owner ?? ''} onChange={(e) => setField('owner', e.target.value)}>
              <option value="">{t('common.none')}</option>
              {(model.catalog.teams ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('insp.links')}>
            <LinksEditor value={entity.links ?? []} onChange={(v) => setField('links', v)} />
          </Field>
          <Field label={t('insp.descriptionMd')}>
            <CommitInput label={t('insp.description')} multiline value={entity.description ?? ''} onCommit={(v) => setField('description', v.trim() ? v.replace(/\s+$/, '') + '\n' : '')} />
          </Field>
          <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
            {placed && drawing && (
              <Button variant="subtle" title={t('insp.removeTitle')} onClick={() => void removeSelectionFromDrawing()}>
                {t('insp.removeFromDrawing')}
              </Button>
            )}
            <Button variant="subtle" onClick={() => useStore.getState().set({ view: 'deps', depsOf: entity.id })}>
              {t('insp.viewDeps')}
            </Button>
            <Button variant="ghost" className="!text-[var(--danger)]" title={t('insp.deleteTitle')} onClick={() => deleteWithImpact(`/api/entities/${entity.id}`, entity.name, [entity.file])}>
              {t('insp.deleteFromModel')}
            </Button>
          </div>
          <p data-edit className="text-[11.5px] leading-snug text-[var(--muted)]">{t('insp.removeVsDelete')}</p>
        </div>
      )}
      {tab === 'connections' && (
        <div className="mt-2">
          <SectionTitle>{t('insp.outgoing')}</SectionTitle>
          <ul>{outgoing.map((c) => connRow(c, 'out'))}</ul>
          {!outgoing.length && <p className="px-1 text-[12px] text-[var(--muted)]">{t('insp.noneOutgoing')}</p>}
          <SectionTitle>{t('insp.incoming')}</SectionTitle>
          <ul>{incoming.map((c) => connRow(c, 'in'))}</ul>
          {!incoming.length && <p className="px-1 text-[12px] text-[var(--muted)]">{t('insp.noneFem')}</p>}
        </div>
      )}
      {tab === 'usage' && (
        <div className="mt-2">
          <SectionTitle>{t('insp.drawings')}</SectionTitle>
          <ul>
            {(index.entityDrawings.get(entity.id) ?? []).map((d) => (
              <li key={d}>
                <button type="button" className="w-full rounded-md px-1 py-1 text-left text-[13px] text-[var(--accent)] hover:bg-[var(--hover)]" onClick={() => openDrawing(d)}>
                  {index.drawings.get(d)?.name}
                </button>
              </li>
            ))}
          </ul>
          <SectionTitle>{t('insp.flows')}</SectionTitle>
          <FlowLinks ids={[...new Set([...outgoing, ...incoming].flatMap((c) => index.connFlows.get(c.ref) ?? []))]} empty={t('insp.noneMasc')} />
        </div>
      )}
      <FileFooter file={entity.file} />
    </div>
  );
}

function LinksEditor({ value, onChange }: { value: { label: string; url: string }[]; onChange: (v: { label: string; url: string }[]) => void }) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const t = useT();
  return (
    <div className="flex flex-col gap-1">
      {value.map((l, i) => (
        <div key={i} className="flex items-center gap-2 text-[12.5px]">
          <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[var(--accent)] hover:underline">
            {l.label}
          </a>
          <button type="button" aria-label={t('insp.removeLink', { label: l.label })} className="text-[var(--muted)] hover:text-[var(--danger)]" onClick={() => onChange(value.filter((_, j) => j !== i))}>
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
        <input className={inputClass} placeholder={t('common.label')} value={label} onChange={(e) => setLabel(e.target.value)} aria-label={t('insp.linkLabel')} />
        <input className={inputClass} placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} aria-label={t('insp.linkUrl')} />
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
  const t = useT();

  return (
    <div className="flex flex-col gap-3">
      <Header small kicker={t('insp.connectionHeader', { ref: conn.ref })} title={`${index.name(conn.from)} ${c.direction === 'bidirectional' ? '↔' : '→'} ${index.name(conn.to)}`} />
      {flow && <AddStepButton refId={conn.ref} flowId={flow.id} />}
      <Field label={t('common.label')}>
        <CommitInput label={t('common.label')} value={c.label} onCommit={(v) => setField('label', v.trim())} />
      </Field>
      <div className="flex items-end gap-2">
        <Field label={t('common.direction')}>
          <select className={inputClass} value={c.direction ?? 'outgoing'} onChange={(e) => setField('direction', e.target.value === 'outgoing' ? '' : e.target.value)}>
            <option value="outgoing">{t('insp.outgoing')}</option>
            <option value="bidirectional">{t('common.bidirectional')}</option>
          </select>
        </Field>
        <Button variant="subtle" onClick={() => patch({ reverse: true })} title={t('insp.reverseTitle')}>
          {t('insp.reverse')}
        </Button>
      </div>
      <Field label={t('insp.via')}>
        <select className={inputClass} value={c.via ?? ''} onChange={(e) => setField('via', e.target.value)}>
          <option value="">{t('insp.direct')}</option>
          {[...index.entities.values()].filter((e) => e.id !== conn.from && e.id !== conn.to).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('insp.technologies')}>
        <CatalogPicker label={t('insp.technologies')} list="technologies" value={c.technologies ?? []} onChange={(v) => setField('technologies', v)} />
      </Field>
      <Field label={t('insp.status')}>
        <select className={inputClass} value={c.status ?? 'live'} onChange={(e) => setField('status', e.target.value === 'live' ? '' : e.target.value)}>
          {['live', 'future', 'deprecated', 'removed'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
      <Field label={t('insp.description')}>
        <CommitInput label={t('insp.description')} multiline value={c.description ?? ''} onCommit={(v) => setField('description', v.trim() ? v.replace(/\s+$/, '') + '\n' : '')} />
      </Field>
      {edge && drawing && (
        <>
          <SectionTitle>{t('insp.connectorHere')}</SectionTitle>
          <div className="grid grid-cols-3 gap-2">
            <Field label={t('insp.shape')}>
              <select className={inputClass} value={edge.shape ?? 'straight'} onChange={(e) => edgeOp({ shape: e.target.value })}>
                <option value="straight">{t('insp.shapeStraight')}</option>
                <option value="step">{t('insp.shapeStep')}</option>
                <option value="curved">{t('insp.shapeCurved')}</option>
                <option value="auto">{t('insp.shapeAuto')}</option>
              </select>
            </Field>
            {(['from', 'to'] as const).map((k) => (
              <Field key={k} label={k === 'from' ? t('insp.exitsBy') : t('insp.entersBy')}>
                <select className={inputClass} value={edge[k] ?? ''} onChange={(e) => (e.target.value ? edgeOp({ [k]: e.target.value }) : edgeOp({}, [k]))}>
                  <option value="">auto</option>
                  {['top', 'right', 'bottom', 'left'].map((s) => (
                    <option key={s} value={s}>
                      {{ top: t('insp.sideTop'), right: t('insp.sideRight'), bottom: t('insp.sideBottom'), left: t('insp.sideLeft') }[s]}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <Field label={t('insp.labelPosition', { pct: Math.round((edge.labelAt ?? 0.5) * 100) })}>
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
              {t('insp.clearPoints')}
            </Button>
          ) : null}
        </>
      )}
      <SectionTitle>{t('insp.flowsUsing')}</SectionTitle>
      <FlowLinks ids={index.connFlows.get(conn.ref) ?? []} empty={t('insp.noneMasc')} />
      <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
        {edge && drawing && (
          <Button variant="subtle" title={t('insp.removeTitle')} onClick={() => void removeSelectionFromDrawing()}>
            {t('insp.removeFromDrawing')}
          </Button>
        )}
        <Button variant="ghost" className="!text-[var(--danger)]" title={t('insp.deleteTitle')} onClick={() => deleteWithImpact(`/api/connections/${conn.ref}`, tr('common.theConnection', { label: c.label }), [conn.file])}>
          {t('insp.deleteFromModel')}
        </Button>
      </div>
      <p data-edit className="text-[11.5px] leading-snug text-[var(--muted)]">{t('insp.removeVsDelete')}</p>
      <FileFooter file={conn.file} />
    </div>
  );
}

/** Flow mode: creates a step pointing at this connection, focused on its text. */
export function AddStepButton({ refId, flowId }: { refId: string; flowId: string }) {
  const model = useStore((s) => s.model)!;
  const index = useStore((s) => s.index)!;
  const [text, setText] = useState('');
  const [sense, setSense] = useState<'forward' | 'reply' | 'reverse'>('forward');
  // The refusal is shown here, next to the fields that caused it, until they change.
  const [refused, setRefused] = useState<string[]>();
  const flow = model.flows.find((f) => f.id === flowId)!;
  const conn = index.conns.get(refId);
  const t = useT();
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-soft)] p-2.5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        const taken = (id: string) => JSON.stringify(flow.steps ?? []).includes(`"id":"${id}"`);
        const id = freeId(text, taken);
        const extra = sense === 'reply' ? { reply: true } : sense === 'reverse' ? { reverse: true } : {};
        const r = await useStore.getState().ops([{ op: 'flow.add-steps', flow: flowId, steps: [{ id, via: refId, text: text.trim(), ...extra }] }], [flow.file], { inline: true });
        if (r) {
          setText('');
          setSense('forward');
          setRefused(undefined);
        } else setRefused(useStore.getState().refusal ?? [tr('store.opRefused')]);
      }}
    >
      <span className="text-[12px] font-medium text-[var(--accent)]">{t('step.addIn', { flow: flow.name })}</span>
      <input autoFocus className={inputClass} placeholder={t('step.placeholder')} value={text} onChange={(e) => setText(e.target.value)} aria-label={t('flow.stepText')} />
      {conn && (
        <select
          aria-label={t('step.sense')}
          className={inputClass}
          value={sense}
          onChange={(e) => {
            setSense(e.target.value as typeof sense);
            setRefused(undefined);
          }}
        >
          <option value="forward">
            {index.name(conn.from)} → {index.name(conn.to)}
          </option>
          <option value="reply">
            {index.name(conn.to)} → {index.name(conn.from)} {t('step.reply')}
          </option>
          <option value="reverse">
            {index.name(conn.to)} → {index.name(conn.from)} ({conn.conn.direction === 'bidirectional' ? t('step.targetStarts') : t('step.against')})
          </option>
        </select>
      )}
      {refused && (
        <div role="alert" className="rounded-md border border-[var(--danger)]/50 bg-[var(--surface)] px-2.5 py-2 text-[12px] leading-snug text-[var(--danger)]">
          <div className="font-semibold">{t('step.refused')}</div>
          <ul className="mt-1 flex flex-col gap-1">
            {refused.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {sense === 'reverse' && conn?.conn.direction !== 'bidirectional' && (
            <Button variant="subtle" className="mt-2" onClick={() => (setSense('reply'), setRefused(undefined))}>
              {t('step.useReply')}
            </Button>
          )}
        </div>
      )}
      <Button type="submit" disabled={!text.trim()}>
        {t('step.add')}
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
  const labelOverlaps = model.problems.filter((p) => p.code === 'W013' && p.file === drawing.file).length;
  const ops = (o: unknown[]) => write('POST', `/api/drawings/${drawing.id}/ops`, { ops: o }, [drawing.file]);
  const t = useT();

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--muted)]">{t('insp.drawingHeader', { id: drawing.id })}</div>
        <div className="text-[16px] font-semibold text-[var(--fg)]">{drawing.name}</div>
      </div>
      <Field label={t('insp.name')}>
        <CommitInput label={t('insp.name')} value={drawing.name} onCommit={(v) => v.trim() && patch({ name: v.trim() })} />
      </Field>
      <Field label={t('insp.description')}>
        <CommitInput label={t('insp.description')} multiline value={drawing.description ?? ''} onCommit={(v) => (v.trim() ? patch({ description: v.trim() }) : patch({}, ['description']))} />
      </Field>
      <Field label={t('insp.scope')} hint={t('insp.scopeHint')}>
        <select className={inputClass} value={drawing.scope ?? ''} onChange={(e) => patch({ scope: e.target.value || null })}>
          <option value="">{t('insp.rootOption')}</option>
          {[...index.entities.values()].filter((e) => e.kind !== 'actor').map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex gap-2">
        <Button variant="subtle" onClick={() => autoLayout()}>
          {t('insp.autoLayout')}
        </Button>
        <Button variant="subtle" onClick={() => addNote()}>
          {t('insp.newNote')}
        </Button>
      </div>
      {labelOverlaps > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-[var(--warn-soft)] px-2.5 py-2 text-[12.5px] text-[var(--warn-fg)]">
          <span>{t(labelOverlaps === 1 ? 'insp.labelOverlap' : 'insp.labelOverlaps', { n: labelOverlaps })}</span>
          <Button variant="subtle" onClick={() => ops([{ op: 'auto-place-labels' }])}>
            {t('insp.fixLabels')}
          </Button>
        </div>
      )}
      <SectionTitle>{t('insp.available', { n: available.length })}</SectionTitle>
      <ul className="flex flex-col">
        {available.map((c) => (
          <li key={c.ref} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-[var(--hover)]">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-[var(--fg)]">{c.conn.label || t('common.noLabel')}</span>
              <span className="block truncate text-[11px] text-[var(--muted)]">
                {index.name(c.from)} → {index.name(c.to)}
              </span>
            </span>
            <Button variant="subtle" onClick={() => ops([{ op: 'draw-edges', edges: [{ ref: c.ref, shape: 'auto' }] }])}>
              {t('insp.draw')}
            </Button>
          </li>
        ))}
        {!available.length && <li className="px-1 text-[12px] text-[var(--muted)]">{t('insp.allDrawn', { n: placed.size })}</li>}
      </ul>
      <SectionTitle>{t('insp.flowsOnDrawing')}</SectionTitle>
      <FlowLinks ids={model.flows.filter((f) => f.drawing === drawing.id).map((f) => f.id)} empty={t('insp.noFlowsHere')} />
      {(drawing.groups ?? []).length > 0 && (
        <>
          <SectionTitle>{t('insp.groups')}</SectionTitle>
          <ul>
            {drawing.groups!.map((g) => (
              <li key={g.id} className="flex items-center justify-between px-1 py-0.5 text-[13px]">
                <span className="text-[var(--fg)]">{g.label}</span>
                <button type="button" className="text-[12px] text-[var(--muted)] hover:text-[var(--danger)]" onClick={() => ops([{ op: 'remove-group', id: g.id }])}>
                  {t('insp.remove')}
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
  const t = useT();
  if (!g) return null;
  const ops = (o: unknown[]) => useStore.getState().write('POST', `/api/drawings/${drawing.id}/ops`, { ops: o }, [drawing.file]);
  return (
    <div className="flex flex-col gap-3">
      <Header kicker={t('insp.visualGroup')} />
      <Field label={t('common.label')}>
        <CommitInput label={t('common.label')} value={g.label} onCommit={(v) => v.trim() && ops([{ op: 'set-group', group: { ...g, label: v.trim() } }])} />
      </Field>
      <Field label={t('insp.frame')}>
        <select className={inputClass} value={g.style ?? 'dashed'} onChange={(e) => ops([{ op: 'set-group', group: { ...g, style: e.target.value } }])}>
          <option value="dashed">{t('insp.dashed')}</option>
          <option value="solid">{t('insp.solid')}</option>
        </select>
      </Field>
      <p className="text-[12.5px] text-[var(--muted)]">{t('insp.members', { names: g.members.map((m) => index.name(m)).join(', ') })}</p>
      <Button variant="ghost" className="!text-[var(--danger)]" onClick={() => ops([{ op: 'remove-group', id: g.id }])}>
        {t('insp.removeGroup')}
      </Button>
    </div>
  );
}

function NoteInspector({ drawing, id }: { drawing: WithFile<Drawing>; id: string }) {
  const n = drawing.notes?.find((x) => x.id === id);
  const t = useT();
  if (!n) return null;
  const ops = (o: unknown[]) => useStore.getState().write('POST', `/api/drawings/${drawing.id}/ops`, { ops: o }, [drawing.file]);
  return (
    <div className="flex flex-col gap-3">
      <Header kicker={t('insp.note')} />
      <Field label={t('insp.text')}>
        <CommitInput label={t('insp.text')} multiline value={n.text} onCommit={(v) => v.trim() && ops([{ op: 'set-note', note: { ...n, text: v.trim() } }])} />
      </Field>
      <Button variant="ghost" className="!text-[var(--danger)]" onClick={() => ops([{ op: 'remove-note', id: n.id }])}>
        {t('insp.removeNote')}
      </Button>
    </div>
  );
}

function MultiInspector({ ids }: { ids: string[] }) {
  const drawing = useStore(currentDrawing)!;
  const index = useStore((s) => s.index)!;
  const entities = ids.filter((id) => drawing.nodes?.[id]);
  const t = useT();
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
      <Header small kicker={t('insp.selection')} title={t('insp.selected', { n: entities.length })} />
      <SectionTitle>{t('insp.align')}</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {action(t('insp.alignLeft'), () => align('left'))}
        {action(t('insp.alignTop'), () => align('top'))}
        {action(t('insp.alignHCenter'), () => align('hcenter'))}
        {action(t('insp.alignVCenter'), () => align('vcenter'))}
      </div>
      <SectionTitle>{t('insp.distribute')}</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {action(t('insp.horizontal'), () => distribute('x'), entities.length < 3)}
        {action(t('insp.vertical'), () => distribute('y'), entities.length < 3)}
      </div>
      <SectionTitle>{t('insp.selection')}</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {action(t('insp.groupSel'), groupSelection)}
        {action(t('insp.layoutSel'), () => autoLayout(entities), entities.length < 2)}
        {action(t('insp.removeFromDrawing'), () => void removeSelectionFromDrawing())}
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
