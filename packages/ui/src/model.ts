import { numberSteps } from '@core/flow-text';
import type { Conn, Drawing, Entity, Model, WithFile } from './types';

export const DEFAULT_SIZE = { w: 256, h: 128 };
export const ACTOR_SIZE = { w: 128, h: 128 };

/** Read-side indices over the server snapshot (mirrors core/project.ts). */
export interface Index {
  entities: Map<string, WithFile<Entity>>;
  conns: Map<string, Conn>;
  children: Map<string, string[]>;
  drawings: Map<string, WithFile<Drawing>>;
  drawingsByScope: Map<string | null, WithFile<Drawing>[]>;
  entityDrawings: Map<string, string[]>;
  connDrawings: Map<string, string[]>;
  connFlows: Map<string, string[]>;
  ancestors: (id: string) => string[];
  descendants: (id: string) => string[];
  resolve: (drawing: Drawing, id: string) => string | undefined;
  size: (id: string, node?: { w?: number; h?: number }) => { w: number; h: number };
  name: (id: string) => string;
}

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => (m.get(k)?.push(v) ?? m.set(k, [v]), m);

export function buildIndex(model: Model): Index {
  const entities = new Map(model.entities.map((e) => [e.id, e]));
  const conns = new Map<string, Conn>();
  const children = new Map<string, string[]>();
  for (const e of model.entities) {
    if (e.parent) push(children, e.parent, e.id);
    for (const c of e.connections ?? []) conns.set(`${e.id}.${c.id}`, { ref: `${e.id}.${c.id}`, from: e.id, to: c.to, conn: c, file: e.file });
  }
  const drawings = new Map(model.drawings.map((d) => [d.id, d]));
  const drawingsByScope = new Map<string | null, WithFile<Drawing>[]>();
  const entityDrawings = new Map<string, string[]>();
  const connDrawings = new Map<string, string[]>();
  for (const d of model.drawings) {
    push(drawingsByScope, d.scope ?? null, d);
    for (const id of Object.keys(d.nodes ?? {})) push(entityDrawings, id, d.id);
    for (const ref of Object.keys(d.edges ?? {})) push(connDrawings, ref, d.id);
  }
  const connFlows = new Map<string, string[]>();
  for (const f of model.flows) for (const s of numberSteps(f.steps)) if (!connFlows.get(s.step.via)?.includes(f.id)) push(connFlows, s.step.via, f.id);

  const ancestors = (id: string) => {
    const chain: string[] = [];
    let cur: string | null | undefined = id;
    while (cur && !chain.includes(cur)) {
      chain.push(cur);
      cur = entities.get(cur)?.parent;
    }
    return chain;
  };
  const descendants = (id: string): string[] => (children.get(id) ?? []).flatMap((c) => [c, ...descendants(c)]);
  return {
    entities,
    conns,
    children,
    drawings,
    drawingsByScope,
    entityDrawings,
    connDrawings,
    connFlows,
    ancestors,
    descendants,
    resolve: (drawing, id) => ancestors(id).find((a) => drawing.nodes?.[a]),
    size: (id, node) => {
      const base = entities.get(id)?.kind === 'actor' ? ACTOR_SIZE : DEFAULT_SIZE;
      return { w: node?.w ?? base.w, h: node?.h ?? base.h };
    },
    name: (id) => entities.get(id)?.name ?? id,
  };
}

export const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'item';

/** First free slug based on `base` (base, base-2, base-3 ...). */
export function freeId(base: string, taken: (id: string) => boolean) {
  const slug = slugify(base);
  if (!taken(slug)) return slug;
  for (let n = 2; ; n++) if (!taken(`${slug}-${n}`)) return `${slug}-${n}`;
}

/** Entity kinds in display order; labels come from i18n (`kind.<kind>`). */
export const KINDS = ['actor', 'system', 'app', 'store', 'component'] as const;
export const ALLOWED_PARENTS: Record<string, (string | null)[]> = {
  actor: [null],
  system: [null],
  app: ['system'],
  store: ['system'],
  component: ['app', 'store'],
};

/** Kinds that can be created inside a drawing with the given scope. */
export function kindsForScope(index: Index, scope: string | null | undefined): string[] {
  const scopeKind = scope ? index.entities.get(scope)?.kind ?? null : null;
  return Object.entries(ALLOWED_PARENTS)
    .filter(([, parents]) => parents.includes(scopeKind) || parents.includes(null))
    .map(([k]) => k);
}
