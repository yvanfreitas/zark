import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { KINDS } from '../model';
import { tr, useT } from '../i18n';
import { useStore } from '../store';
import type { Conn, Entity, WithFile } from '../types';
import { inputClass, Tabs } from './ui';

type SortDir = 1 | -1;

/** Cell input that saves on blur/Enter; Escape restores. */
function InlineText({ value, label, onCommit, placeholder }: { value: string; label: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(value);
      }}
      className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-[13px] text-[var(--fg)] placeholder:text-[var(--subtle)] hover:border-[var(--border)] focus:border-[var(--accent)] focus:bg-[var(--input)] focus:outline-none"
    />
  );
}

function SortHeader<K extends string>({ k, sort, onSort, children, className = '' }: { k: K; sort: [K, SortDir]; onSort: (k: K) => void; children: ReactNode; className?: string }) {
  const active = sort[0] === k;
  return (
    <th scope="col" className={`px-2 py-2 text-left font-medium ${className}`} aria-sort={active ? (sort[1] === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(k)} className={`flex items-center gap-1 ${active ? 'text-[var(--fg)]' : 'hover:text-[var(--fg)]'}`}>
        {children}
        <span aria-hidden="true" className="text-[10px]">{active ? (sort[1] === 1 ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );
}

const cmp = (a: string | number, b: string | number) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));

function openOnCanvas(id: string, edge = false) {
  const s = useStore.getState();
  const where = edge ? s.index?.connDrawings.get(id)?.[0] : s.index?.entityDrawings.get(id)?.[0];
  if (!where) return s.toast(tr('list.notDrawn'));
  s.openDrawing(where);
  if (edge) s.select([], [id]);
  else {
    s.select([id]);
    s.requestFocus();
  }
}

function EntitiesTable() {
  const model = useStore((s) => s.model)!;
  const index = useStore((s) => s.index)!;
  const write = useStore((s) => s.write);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [team, setTeam] = useState('');
  const [noDrawing, setNoDrawing] = useState(false);
  const [noDescription, setNoDescription] = useState(false);
  const t = useT();
  type Key = 'name' | 'kind' | 'parent' | 'status' | 'owner' | 'drawings';
  const [sort, setSort] = useState<[Key, SortDir]>(['name', 1]);
  const onSort = (k: Key) => setSort(([sk, d]) => [k, sk === k ? ((-d) as SortDir) : 1]);
  const teams = model.catalog.teams ?? [];

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const value = (e: WithFile<Entity>, k: Key): string | number =>
      k === 'drawings' ? index.entityDrawings.get(e.id)?.length ?? 0 : k === 'parent' ? (e.parent ? index.name(e.parent) : '') : k === 'status' ? e.status ?? 'live' : k === 'owner' ? e.owner ?? '' : e[k];
    return model.entities
      .filter((e) => !q || e.name.toLowerCase().includes(q) || e.id.includes(q) || (e.caption ?? '').toLowerCase().includes(q))
      .filter((e) => !kind || e.kind === kind)
      .filter((e) => !team || (team === '-' ? !e.owner : e.owner === team))
      .filter((e) => !noDrawing || !index.entityDrawings.get(e.id)?.length)
      .filter((e) => !noDescription || !e.description?.trim())
      .sort((a, b) => cmp(value(a, sort[0]), value(b, sort[0])) * sort[1] || a.name.localeCompare(b.name));
  }, [model, index, query, kind, team, noDrawing, noDescription, sort]);

  // Empty caption and the default status ("live") are removed from the YAML, not written.
  const patch = (e: WithFile<Entity>, key: 'name' | 'caption' | 'status', v: string) => {
    const value = v.trim();
    const remove = !value || (key === 'status' && value === 'live');
    return write('PATCH', `/api/entities/${e.id}`, remove ? { unset: [key] } : { set: { [key]: value } }, [e.file]);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <input className={`${inputClass} !w-[220px]`} placeholder={t('list.search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('list.searchEntities')} />
        <select className={`${inputClass} !w-auto`} value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t('left.filterKind')}>
          <option value="">{t('list.allKinds')}</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kind.${k}`)}
            </option>
          ))}
        </select>
        <select className={`${inputClass} !w-auto`} value={team} onChange={(e) => setTeam(e.target.value)} aria-label={t('list.filterTeam')}>
          <option value="">{t('list.allTeams')}</option>
          <option value="-">{t('list.noTeam')}</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[12.5px] text-[var(--fg-soft)]">
          <input type="checkbox" className="accent-[var(--accent)]" checked={noDrawing} onChange={(e) => setNoDrawing(e.target.checked)} />
          {t('list.noDrawing')}
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px] text-[var(--fg-soft)]">
          <input type="checkbox" className="accent-[var(--accent)]" checked={noDescription} onChange={(e) => setNoDescription(e.target.checked)} />
          {t('list.noDescription')}
        </label>
        <span className="ml-auto text-[12px] text-[var(--muted)]">
          {t('list.count', { n: rows.length, total: model.entities.length })}
        </span>
      </div>
      <table className="w-full table-fixed border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-[var(--surface)] text-[11.5px] uppercase tracking-wide text-[var(--muted)] shadow-[0_1px_0_var(--border)]">
          <tr>
            <SortHeader k="name" sort={sort} onSort={onSort} className="w-[20%]">{t('list.colName')}</SortHeader>
            <th scope="col" className="w-[26%] px-2 py-2 text-left font-medium">{t('list.colCaption')}</th>
            <SortHeader k="kind" sort={sort} onSort={onSort} className="w-[10%]">{t('list.colKind')}</SortHeader>
            <SortHeader k="parent" sort={sort} onSort={onSort} className="w-[12%]">{t('list.colParent')}</SortHeader>
            <SortHeader k="status" sort={sort} onSort={onSort} className="w-[12%]">{t('list.colStatus')}</SortHeader>
            <SortHeader k="owner" sort={sort} onSort={onSort} className="w-[12%]">{t('list.colTeam')}</SortHeader>
            <SortHeader k="drawings" sort={sort} onSort={onSort} className="w-[8%]">{t('list.colDrawings')}</SortHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const drawings = index.entityDrawings.get(e.id)?.length ?? 0;
            return (
              <tr key={e.id} className="border-b border-[var(--border)] hover:bg-[var(--hover)]">
                <td className="px-1 py-0.5">
                  <InlineText label={t('list.nameOf', { name: e.name })} value={e.name} onCommit={(v) => v.trim() && patch(e, 'name', v)} />
                </td>
                <td className="px-1 py-0.5">
                  <InlineText label={t('list.captionOf', { name: e.name })} value={e.caption ?? ''} placeholder="—" onCommit={(v) => patch(e, 'caption', v)} />
                </td>
                <td className="truncate whitespace-nowrap px-2 font-mono text-[11px] uppercase text-[var(--muted)]">
                  {e.external ? t('list.ext') : ''}
                  {t(`kind.${e.kind}`)}
                </td>
                <td className="truncate px-2 text-[var(--fg-soft)]">{e.parent ? index.name(e.parent) : <span className="text-[var(--subtle)]">{t('list.root')}</span>}</td>
                <td className="px-1">
                  <select
                    aria-label={t('list.statusOf', { name: e.name })}
                    value={e.status ?? 'live'}
                    onChange={(ev) => patch(e, 'status', ev.target.value)}
                    className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-[13px] text-[var(--fg)] hover:border-[var(--border)] focus:border-[var(--accent)] focus:outline-none"
                  >
                    {['live', 'future', 'deprecated', 'removed'].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </td>
                <td className="truncate px-2 text-[var(--fg-soft)]">{e.owner ? teams.find((t) => t.id === e.owner)?.name ?? e.owner : <span className="text-[var(--subtle)]">—</span>}</td>
                <td className="px-2">
                  <button type="button" onClick={() => openOnCanvas(e.id)} disabled={!drawings} className="text-[var(--accent)] hover:underline disabled:text-[var(--subtle)] disabled:no-underline" title={drawings ? t('list.openInDrawing') : t('list.outsideDrawings')}>
                    {drawings}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && <p className="py-10 text-center text-[13px] text-[var(--muted)]">{t('list.noEntities')}</p>}
    </>
  );
}

function ConnectionsTable() {
  const index = useStore((s) => s.index)!;
  const write = useStore((s) => s.write);
  const [query, setQuery] = useState('');
  const [noDrawing, setNoDrawing] = useState(false);
  const [noDescription, setNoDescription] = useState(false);
  const t = useT();
  type Key = 'from' | 'to' | 'label' | 'direction' | 'drawings' | 'flows';
  const [sort, setSort] = useState<[Key, SortDir]>(['from', 1]);
  const onSort = (k: Key) => setSort(([sk, d]) => [k, sk === k ? ((-d) as SortDir) : 1]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const value = (c: Conn, k: Key): string | number =>
      k === 'from' ? index.name(c.from) : k === 'to' ? index.name(c.to) : k === 'label' ? c.conn.label : k === 'direction' ? c.conn.direction ?? 'outgoing' : k === 'drawings' ? index.connDrawings.get(c.ref)?.length ?? 0 : index.connFlows.get(c.ref)?.length ?? 0;
    return [...index.conns.values()]
      .filter((c) => !q || c.conn.label.toLowerCase().includes(q) || c.ref.includes(q) || index.name(c.from).toLowerCase().includes(q) || index.name(c.to).toLowerCase().includes(q))
      .filter((c) => !noDrawing || !index.connDrawings.get(c.ref)?.length)
      .filter((c) => !noDescription || !c.conn.description?.trim())
      .sort((a, b) => cmp(value(a, sort[0]), value(b, sort[0])) * sort[1] || a.ref.localeCompare(b.ref));
  }, [index, query, noDrawing, noDescription, sort]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <input className={`${inputClass} !w-[220px]`} placeholder={t('list.search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('list.searchConnections')} />
        <label className="flex items-center gap-1.5 text-[12.5px] text-[var(--fg-soft)]">
          <input type="checkbox" className="accent-[var(--accent)]" checked={noDrawing} onChange={(e) => setNoDrawing(e.target.checked)} />
          {t('list.noDrawing')}
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px] text-[var(--fg-soft)]">
          <input type="checkbox" className="accent-[var(--accent)]" checked={noDescription} onChange={(e) => setNoDescription(e.target.checked)} />
          {t('list.noDescription')}
        </label>
        <span className="ml-auto text-[12px] text-[var(--muted)]">
          {t('list.count', { n: rows.length, total: index.conns.size })}
        </span>
      </div>
      <table className="w-full table-fixed border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-[var(--surface)] text-[11.5px] uppercase tracking-wide text-[var(--muted)] shadow-[0_1px_0_var(--border)]">
          <tr>
            <SortHeader k="from" sort={sort} onSort={onSort} className="w-[16%]">{t('list.colFrom')}</SortHeader>
            <SortHeader k="to" sort={sort} onSort={onSort} className="w-[16%]">{t('list.colTo')}</SortHeader>
            <SortHeader k="label" sort={sort} onSort={onSort} className="w-[34%]">{t('list.colLabel')}</SortHeader>
            <SortHeader k="direction" sort={sort} onSort={onSort} className="w-[14%]">{t('list.colDirection')}</SortHeader>
            <SortHeader k="drawings" sort={sort} onSort={onSort} className="w-[10%]">{t('list.colDrawings')}</SortHeader>
            <SortHeader k="flows" sort={sort} onSort={onSort} className="w-[10%]">{t('list.colFlows')}</SortHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const drawings = index.connDrawings.get(c.ref)?.length ?? 0;
            return (
              <tr key={c.ref} className="border-b border-[var(--border)] hover:bg-[var(--hover)]">
                <td className="truncate px-2 py-1.5 text-[var(--fg)]">{index.name(c.from)}</td>
                <td className="truncate px-2 text-[var(--fg)]">{index.name(c.to)}</td>
                <td className="px-1 py-0.5">
                  <InlineText label={t('list.labelOf', { ref: c.ref })} value={c.conn.label} onCommit={(v) => write('PATCH', `/api/connections/${c.ref}`, { set: { label: v.trim() } }, [c.file])} />
                </td>
                <td className="px-2 text-[var(--fg-soft)]">{c.conn.direction === 'bidirectional' ? t('common.bidirectional') : t('list.outgoing')}</td>
                <td className="px-2">
                  <button type="button" onClick={() => openOnCanvas(c.ref, true)} disabled={!drawings} className="text-[var(--accent)] hover:underline disabled:text-[var(--subtle)] disabled:no-underline" title={drawings ? t('list.openInDrawing') : t('list.outsideDrawings')}>
                    {drawings}
                  </button>
                </td>
                <td className="px-2 text-[var(--fg-soft)]">{index.connFlows.get(c.ref)?.length ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && <p className="py-10 text-center text-[13px] text-[var(--muted)]">{t('list.noConnections')}</p>}
    </>
  );
}

export function ModelList() {
  const [tab, setTab] = useState<'entities' | 'connections'>('entities');
  const t = useT();
  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <div className="flex shrink-0 items-center gap-4 border-b border-[var(--border)] px-4 py-2.5">
        <h2 className="text-[14px] font-semibold text-[var(--fg)]">{t('list.title')}</h2>
        <div className="w-[260px]">
          <Tabs value={tab} onChange={setTab} items={[['entities', t('list.tabEntities')], ['connections', t('list.tabConnections')]]} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 pt-3 pb-6">{tab === 'entities' ? <EntitiesTable /> : <ConnectionsTable />}</div>
    </div>
  );
}
