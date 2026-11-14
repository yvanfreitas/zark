import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position, type EdgeProps } from '@xyflow/react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { edgeRoute, pointAt, type Pt, type Side } from '@core/edge-geometry';
import type { EdgeData } from './build';

const SIDE: Record<Position, Side> = { [Position.Top]: 'top', [Position.Right]: 'right', [Position.Bottom]: 'bottom', [Position.Left]: 'left' };
const pathOf = (route: Pt[]) => route.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');

export const ZarkEdge = memo(function ZarkEdge(props: EdgeProps & { data: EdgeData }) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd, markerStart } = props;
  const spec = data.spec;
  // Route geometry is shared with the render route and the validator (core edge-geometry).
  const route = edgeRoute(spec, [sourceX, sourceY], SIDE[sourcePosition], [targetX, targetY], SIDE[targetPosition], data.obstacles, data.shift);
  const curved = (spec.shape ?? 'straight') === 'curved' && !spec.points?.length;
  const d = curved ? getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })[0] : pathOf(route);
  const label = pointAt(route, data.labelAt ?? spec.labelAt ?? 0.5);
  const t = useT();
  const active = data.active?.length ? data.active : undefined;
  const stroke = active ? 'var(--accent)' : data.severity === 'error' ? 'var(--danger)' : selected ? 'var(--accent)' : 'var(--edge)';
  const opacity = data.dim && !active ? 0.18 : 1;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={d}
        markerEnd={markerEnd}
        markerStart={markerStart}
        interactionWidth={18}
        style={{ stroke, strokeWidth: active || selected ? 2.25 : 1.5, strokeDasharray: data.inherited ? '2 5' : undefined, strokeLinecap: 'round', opacity }}
        className={data.pulse && data.animate ? 'zark-pulse' : undefined}
      />
      {active && data.animate &&
        active.map((a, i) => (
          <circle key={i} r="5" fill="var(--accent)">
            <animateMotion dur="1.4s" repeatCount="indefinite" path={d} keyPoints={a.backwards ? '1;0' : '0;1'} keyTimes="0;1" calcMode="linear" />
          </circle>
        ))}
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute flex flex-col items-center gap-1"
          style={{ transform: `translate(-50%, -50%) translate(${label[0]}px, ${label[1]}px)`, opacity, zIndex: active ? 30 : 10 }}
        >
          {data.label && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                useStore.getState().select([], [data.ref]);
              }}
              className={`cursor-pointer max-w-[220px] truncate rounded-full border px-2.5 py-0.5 text-[11px] leading-5 ${selected ? 'border-[var(--accent)]' : 'border-[var(--border)]'} bg-[var(--surface)] text-[var(--fg-soft)]`}
            >
              {data.label}
            </span>
          )}
          {active?.map((a, i) => (
            <span key={i} className="max-w-[260px] rounded-md bg-[var(--accent)] px-2 py-1 text-[11.5px] font-medium leading-tight text-white shadow-md">
              <span className="mr-1.5 font-mono opacity-80">{a.number}</span>
              {a.text}
              {a.reply && <span className="ml-1 opacity-80">{t('edge.reply')}</span>}
            </span>
          ))}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

export const edgeTypes = { zark: ZarkEdge };
