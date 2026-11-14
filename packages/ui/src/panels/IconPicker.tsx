import { useEffect, useState } from 'react';
import { api, token } from '../api';
import { useStore } from '../store';
import type { Entity } from '../types';
import { useT } from '../i18n';
import { Button, inputClass } from './ui';

interface IconHit {
  id: string;
  set: string;
  title: string;
}
interface IconSet {
  id: string;
  title: string;
  count: number;
}

const svgUrl = (id: string) => `/api/icons/svg/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`;

/** Icon of an entity: current one, suggestions from its settings, and a picker for everything else. */
export function IconField({ entity, onChange }: { entity: Entity; onChange: (icon: string | undefined) => void }) {
  const icons = useStore((s) => s.model?.icons ?? {});
  const readOnly = useStore((s) => s.readOnly);
  const [suggested, setSuggested] = useState<{ id: string; svg?: string }[]>([]);
  const [picking, setPicking] = useState(false);
  const t = useT();
  const key = `${entity.id}|${entity.name}|${entity.caption ?? ''}|${entity.kind}|${(entity.technologies ?? []).join(',')}`;

  useEffect(() => {
    if (readOnly) return;
    let alive = true;
    const timer = setTimeout(() => {
      void api<{ icons: { id: string; svg?: string }[] }>('GET', `/api/icons/suggest/${encodeURIComponent(entity.id)}`)
        .then((r) => alive && setSuggested(r.icons ?? []))
        .catch(() => alive && setSuggested([]));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, readOnly, entity.id]);

  const current = entity.icon ? icons[entity.icon] : undefined;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          className="zark-icon grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--badge)] p-1.5 text-[var(--badge-fg)]"
          aria-hidden="true"
          dangerouslySetInnerHTML={current ? { __html: current } : undefined}
        >
          {current ? undefined : <span className="text-[11px] text-[var(--muted)]">—</span>}
        </span>
        <code className="min-w-0 flex-1 truncate text-[12px] text-[var(--fg-soft)]">{entity.icon ?? t('icon.none')}</code>
        <Button variant="subtle" onClick={() => setPicking(true)}>
          {t('icon.choose')}
        </Button>
        {entity.icon && (
          <Button variant="ghost" onClick={() => onChange(undefined)} aria-label={t('icon.remove')}>
            ×
          </Button>
        )}
      </div>
      {suggested.length > 0 && (
        <div data-edit>
          <div className="mb-1 text-[11px] text-[var(--muted)]">{t('icon.suggested')}</div>
          <div className="flex flex-wrap gap-1.5" role="list" aria-label={t('icon.suggestedList')}>
            {suggested.map((s) => (
              <button
                key={s.id}
                type="button"
                role="listitem"
                title={s.id}
                aria-label={t('icon.use', { id: s.id })}
                onClick={() => onChange(s.id)}
                className={`zark-icon grid size-9 place-items-center rounded-lg border p-1.5 text-[var(--fg-soft)] hover:border-[var(--accent)] ${entity.icon === s.id ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] bg-[var(--surface)]'}`}
                dangerouslySetInnerHTML={s.svg ? { __html: s.svg } : undefined}
              />
            ))}
          </div>
        </div>
      )}
      {picking && (
        <IconPicker
          current={entity.icon}
          onPick={(id) => {
            setPicking(false);
            onChange(id);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

export function IconPicker({ current, onPick, onClose }: { current?: string; onPick: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [set, setSet] = useState('');
  const [sets, setSets] = useState<IconSet[]>([]);
  const [hits, setHits] = useState<IconHit[]>([]);
  const [hover, setHover] = useState<IconHit>();
  const t = useT();

  useEffect(() => {
    void api<{ sets: IconSet[] }>('GET', '/api/icons/sets').then((r) => setSets(r.sets)).catch(() => setSets([]));
  }, []);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query, limit: '120', ...(set ? { set } : {}) });
      void api<{ icons: IconHit[] }>('GET', `/api/icons?${params}`).then((r) => alive && setHits(r.icons)).catch(() => alive && setHits([]));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, set]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose());
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={t('icon.dialog')} className="flex max-h-[80vh] w-[620px] max-w-[94vw] flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="flex flex-col gap-2 border-b border-[var(--border)] p-3">
          <input autoFocus className={inputClass} placeholder={t('icon.searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('icon.search')} />
          <div role="tablist" aria-label={t('icon.sets')} className="flex flex-wrap gap-1">
            {[{ id: '', title: t('icon.all'), count: sets.reduce((a, s) => a + s.count, 0) }, ...sets].map((s) => (
              <button
                key={s.id || 'all'}
                type="button"
                role="tab"
                aria-selected={set === s.id}
                onClick={() => setSet(s.id)}
                className={`rounded-full border px-2.5 py-0.5 text-[12px] ${set === s.id ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]'}`}
              >
                {s.title} <span className="opacity-60">{s.count}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1.5 overflow-y-auto p-3" role="listbox" aria-label={t('icon.list')}>
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              role="option"
              aria-selected={current === h.id}
              aria-label={`${h.title} (${h.id})`}
              title={`${h.title}\n${h.id}`}
              onMouseEnter={() => setHover(h)}
              onFocus={() => setHover(h)}
              onClick={() => onPick(h.id)}
              // Light tile in both themes: SVGs drawn with currentColor render black inside <img>.
              className={`grid aspect-square place-items-center rounded-lg border bg-white p-2 hover:border-[var(--accent)] ${current === h.id ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/30' : 'border-[var(--border)]'}`}
            >
              <img src={svgUrl(h.id)} alt="" width={26} height={26} loading="lazy" />
            </button>
          ))}
          {!hits.length && <p className="col-span-full py-8 text-center text-[13px] text-[var(--muted)]">{t('icon.empty')}</p>}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] p-3 text-[12px] text-[var(--muted)]">
          <span className="truncate">{hover ? `${hover.title} · ${hover.id}` : t('icon.footer')}</span>
          <Button variant="ghost" onClick={onClose}>
            {t('icon.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}
