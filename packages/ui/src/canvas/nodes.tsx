import { memo } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { tr, useT } from '../i18n';
import { useStore } from '../store';
import type { EntityData } from './build';

const SIDES = [
  ['top', Position.Top],
  ['right', Position.Right],
  ['bottom', Position.Bottom],
  ['left', Position.Left],
] as const;

/** One handle per side; with ConnectionMode.Loose each works as source and target. */
export function Handles({ interactive }: { interactive: boolean }) {
  return (
    <>
      {SIDES.map(([id, pos]) => (
        <Handle key={id} id={id} type="source" position={pos} className={interactive ? 'zark-handle' : 'zark-handle zark-handle-hidden'} isConnectable={interactive} />
      ))}
    </>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
      <circle cx="24" cy="15" r="9" fill="currentColor" />
      <path d="M6 44c0-10 8-17 18-17s18 7 18 17" fill="currentColor" />
    </svg>
  );
}

/**
 * Two letters that tell boxes apart: initials of the entity's significant
 * words ("Fila do bot" -> FB). The technology name made every AWS box read "Am".
 */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => w.length > 2 || /^[A-ZÀ-Ý]/.test(w));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const one = words[0] ?? name;
  return one.slice(0, 1).toUpperCase() + one.slice(1, 2).toLowerCase();
}

/** Inline, sanitized SVG (server-side): no fetch, so the render route stays deterministic. */
function EntityIcon({ svg, className }: { svg: string; className: string }) {
  return <span aria-hidden="true" className={`zark-icon shrink-0 ${className}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function Badge({ text }: { text: string }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--badge)] text-[13px] font-semibold text-[var(--badge-fg)]" aria-hidden="true">
      {initials(text)}
    </span>
  );
}

function Indicators({ data, id }: { data: EntityData; id: string }) {
  const openInner = () => {
    const s = useStore.getState();
    const inner = s.index?.drawingsByScope.get(id)?.[0];
    if (inner) s.openDrawing(inner.id);
  };
  const t = useT();
  return (
    <div className="absolute -top-2.5 right-2 flex gap-1">
      {data.severity && (
        <span
          className={`grid size-5 place-items-center rounded-full text-[11px] font-bold text-white ${data.severity === 'error' ? 'bg-[var(--danger)]' : 'bg-[var(--warn)]'}`}
          title={data.severity === 'error' ? t('node.errorTitle') : t('node.warningTitle')}
        >
          !
        </span>
      )}
      {data.hasInner && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openInner();
          }}
          className="nodrag grid size-5 place-items-center rounded-full bg-[var(--surface)] text-[var(--muted)] ring-1 ring-[var(--border)] hover:text-[var(--accent)]"
          title={t('node.openInner')}
          aria-label={t('node.openInnerOf', { name: data.entity.name })}
        >
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="2" fill="none" />
            <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      )}
      {data.hasCode && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            useStore.getState().openCode(id);
          }}
          className="nodrag grid size-5 place-items-center rounded-full bg-[var(--surface)] text-[var(--muted)] ring-1 ring-[var(--border)] hover:text-[var(--accent)]"
          title={t('node.openCode')}
          aria-label={t('node.openCodeOf', { name: data.entity.name })}
        >
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
            <path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

export const EntityNode = memo(function EntityNode({ id, data, selected }: NodeProps & { data: EntityData }) {
  const e = data.entity;
  const status = e.status ?? 'live';
  const border = status === 'future' ? 'border-dashed' : 'border-solid';
  const opacity = status === 'removed' ? 'opacity-40' : data.dim ? 'opacity-25' : '';
  const ring = selected ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--canvas)]' : data.inActiveFlow ? 'ring-2 ring-[var(--accent)]/50' : '';
  const nameClass = status === 'deprecated' ? 'line-through' : '';
  useT(); // re-render on language change
  const kind = tr(`kind.${e.kind}`).toLowerCase();
  const footer = e.kind === 'actor' ? '' : `${tr(e.external ? 'node.footerExternal' : 'node.footer', { kind })}${data.techName ? `: ${data.techName}` : ''}`;
  const description = data.showDescription ? e.description?.trim() : undefined;

  if (e.kind === 'actor') {
    return (
      <div className={`relative flex h-full w-full flex-col items-center justify-center gap-1 rounded-2xl text-center transition-opacity ${opacity} ${ring}`}>
        <Handles interactive={data.interactive} />
        <Indicators data={data} id={id} />
        <div className={`text-[var(--actor)] ${e.external ? 'opacity-70' : ''}`}>
          {data.iconSvg ? <EntityIcon svg={data.iconSvg} className="block size-11" /> : <PersonIcon />}
        </div>
        <div className={`px-1 text-[14px] font-semibold leading-tight text-[var(--fg)] ${nameClass}`}>{e.name}</div>
        {e.caption && <div className="px-1 text-[11px] leading-tight text-[var(--muted)]">{e.caption}</div>}
        {description && <div className="line-clamp-2 px-1 text-[10.5px] leading-tight text-[var(--subtle)]" title={description}>{description}</div>}
      </div>
    );
  }

  if (data.expanded) {
    return (
      <div className={`relative h-full w-full rounded-2xl border-2 ${border} border-[var(--frame)] bg-[var(--frame-bg)] transition-opacity ${opacity} ${ring}`}>
        {data.resizable && <NodeResizer isVisible={!!selected} minWidth={160} minHeight={96} lineClassName="!border-[var(--accent)]" handleClassName="!bg-[var(--accent)] !size-2" />}
        <Handles interactive={data.interactive} />
        <Indicators data={data} id={id} />
        <div className="flex items-center gap-2 px-3 py-2">
          <span className={`text-[13px] font-semibold text-[var(--fg)] ${nameClass}`}>{e.name}</span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--muted)]">{footer}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative flex h-full w-full flex-col justify-between rounded-xl border ${border} ${e.external ? 'border-[var(--ext-border)] bg-[var(--ext-bg)]' : 'border-[var(--box-border)] bg-[var(--box-bg)]'} px-3.5 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-opacity ${opacity} ${ring}`}
    >
      {data.resizable && <NodeResizer isVisible={!!selected} minWidth={128} minHeight={64} lineClassName="!border-[var(--accent)]" handleClassName="!bg-[var(--accent)] !size-2" />}
      <Handles interactive={data.interactive} />
      <Indicators data={data} id={id} />
      <div className={`flex min-h-0 items-start gap-2.5 ${description ? 'overflow-hidden' : ''}`}>
        {data.iconSvg ? <EntityIcon svg={data.iconSvg} className="grid size-8 place-items-center rounded-lg bg-[var(--badge)] p-1.5 text-[var(--badge-fg)]" /> : <Badge text={e.name} />}
        <div className="min-w-0">
          <div className={`truncate text-[15px] font-semibold leading-snug text-[var(--fg)] ${nameClass}`}>{e.name}</div>
          {e.caption && <div className="line-clamp-2 text-[12px] leading-snug text-[var(--muted)]">{e.caption}</div>}
          {description && <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-[var(--subtle)]" title={description}>{description}</div>}
        </div>
      </div>
      <div className="truncate font-mono text-[10.5px] uppercase tracking-wide text-[var(--subtle)]">{footer}</div>
    </div>
  );
});

export const GroupNode = memo(function GroupNode({ data, selected }: NodeProps & { data: { label: string; style: string } }) {
  return (
    <div className={`h-full w-full rounded-2xl border-[1.5px] ${data.style === 'dashed' ? 'border-dashed' : 'border-solid'} ${selected ? 'border-[var(--accent)]' : 'border-[var(--group)]'}`}>
      <div className="px-3 pt-1.5 text-[12px] font-medium text-[var(--muted)]">{data.label}</div>
    </div>
  );
});

export const NoteNode = memo(function NoteNode({ data, selected }: NodeProps & { data: { text: string } }) {
  return (
    <div className={`rounded-lg bg-[var(--note-bg)] px-3 py-2 text-[12px] leading-snug text-[var(--note-fg)] shadow-sm ${selected ? 'ring-2 ring-[var(--accent)]' : ''}`}>{data.text}</div>
  );
});

export const nodeTypes = { entity: EntityNode, frame: GroupNode, note: NoteNode };
