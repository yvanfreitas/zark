import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position, type EdgeProps } from '@xyflow/react';
import { useStore } from '../store';
import { routeOrthogonal, type Side as RouteSide } from '@core/route';
import type { EdgeData } from './build';

type Pt = [number, number];
const OFFSET = 24;

const dirOf = (p: Position): Pt => (p === Position.Left ? [-1, 0] : p === Position.Right ? [1, 0] : p === Position.Top ? [0, -1] : [0, 1]);
const horizontal = (p: Position) => p === Position.Left || p === Position.Right;

/** Orthogonal route from s to t leaving/entering along the anchor sides. */
function stepRoute(s: Pt, sp: Position, t: Pt, tp: Position, points: Pt[]): Pt[] {
  const [sdx, sdy] = dirOf(sp);
  const [tdx, tdy] = dirOf(tp);
  const s1: Pt = [s[0] + sdx * OFFSET, s[1] + sdy * OFFSET];
  const t1: Pt = [t[0] + tdx * OFFSET, t[1] + tdy * OFFSET];
  if (points.length) {
    const route: Pt[] = [s, s1];
    let prev = s1;
    let h = horizontal(sp);
    for (const p of [...points, t1]) {
      if (prev[0] !== p[0] && prev[1] !== p[1]) route.push(h ? [p[0], prev[1]] : [prev[0], p[1]]);
      route.push(p);
      h = !h;
      prev = p;
    }
    route.push(t);
    return route;
  }
  if (horizontal(sp) && horizontal(tp)) {
    const mx = (s1[0] + t1[0]) / 2;
    return [s, s1, [mx, s1[1]], [mx, t1[1]], t1, t];
  }
  if (!horizontal(sp) && !horizontal(tp)) {
    const my = (s1[1] + t1[1]) / 2;
    return [s, s1, [s1[0], my], [t1[0], my], t1, t];
  }
  return horizontal(sp) ? [s, s1, [t1[0], s1[1]], t1, t] : [s, s1, [s1[0], t1[1]], t1, t];
}

function pathOf(route: Pt[]) {
  return route.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
}

/** Point at fraction `f` (0..1) of the polyline length. */
function pointAt(route: Pt[], f: number): Pt {
  const lens = route.slice(1).map((p, i) => Math.hypot(p[0] - route[i][0], p[1] - route[i][1]));
  let left = lens.reduce((a, b) => a + b, 0) * f;
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i] || i === lens.length - 1) {
      const k = lens[i] ? left / lens[i] : 0;
      return [route[i][0] + (route[i + 1][0] - route[i][0]) * k, route[i][1] + (route[i + 1][1] - route[i][1]) * k];
    }
    left -= lens[i];
  }
  return route[0];
}

const SIDE: Record<Position, RouteSide> = { [Position.Top]: 'top', [Position.Right]: 'right', [Position.Bottom]: 'bottom', [Position.Left]: 'left' };
const routeCache = new WeakMap<object, Map<string, Pt[]>>();

/** Orthogonal route around other boxes; falls back to a plain step route. Memoized per geometry. */
function autoRoute(sx: number, sy: number, sp: Position, tx: number, ty: number, tp: Position, obstacles: EdgeData['obstacles'], shift: number): Pt[] {
  // Slide each end along its side; the same absolute shift keeps parallel connectors parallel.
  if (sp === Position.Top || sp === Position.Bottom) sx += shift;
  else sy += shift;
  if (tp === Position.Top || tp === Position.Bottom) tx += shift;
  else ty += shift;
  let cache = routeCache.get(obstacles);
  if (!cache) routeCache.set(obstacles, (cache = new Map()));
  const key = `${sx},${sy},${sp},${tx},${ty},${tp}`;
  let route = cache.get(key);
  if (!route) {
    route = routeOrthogonal([sx, sy], SIDE[sp], [tx, ty], SIDE[tp], obstacles, { margin: 16, stub: 24 }) ?? stepRoute([sx, sy], sp, [tx, ty], tp, []);
    cache.set(key, route);
  }
  return route;
}

export const ZarkEdge = memo(function ZarkEdge(props: EdgeProps & { data: EdgeData }) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd, markerStart } = props;
  const spec = data.spec;
  const shape = spec.shape ?? 'straight';
  const points = (spec.points ?? []) as Pt[];
  const at = spec.labelAt ?? data.labelAt ?? 0.5;
  let d: string;
  let label: Pt;
  if (shape === 'curved' && !points.length) {
    const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
    d = path;
    label = at === 0.5 ? [lx, ly] : pointAt([[sourceX, sourceY], [targetX, targetY]], at);
  } else {
    const route: Pt[] =
      shape === 'auto'
        ? autoRoute(sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data.obstacles, data.shift)
        : shape === 'step'
          ? stepRoute([sourceX, sourceY], sourcePosition, [targetX, targetY], targetPosition, points)
          : [[sourceX, sourceY], ...points, [targetX, targetY]];
    d = pathOf(route);
    label = pointAt(route, at);
  }
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
              {a.reply && <span className="ml-1 opacity-80">(resposta)</span>}
            </span>
          ))}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

export const edgeTypes = { zark: ZarkEdge };
