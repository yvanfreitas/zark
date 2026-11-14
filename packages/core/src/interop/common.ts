// Shared pieces for importers/exporters. Pure: no Node imports.
import type { Op } from '../ops.js';
import type { Project } from '../project.js';
import type { Kind } from '../schema.js';

export interface ImportResult {
  /** Core operations; apply with applyOps so validation and canonical writing are reused. */
  ops: Op[];
  /** Things the source had that Zark could not map. */
  warnings: string[];
}

/** What already exists in the target project, so imported ids never collide. */
export interface ImportContext {
  entities: Set<string>;
  drawings: Set<string>;
  catalog: { technologies: Set<string>; tags: Set<string>; teams: Set<string> };
  grid: number;
}

export function importContext(project?: Project): ImportContext {
  return {
    entities: new Set(project?.entities.keys() ?? []),
    drawings: new Set(project?.drawings.keys() ?? []),
    catalog: {
      technologies: new Set((project?.catalog.technologies ?? []).map((t) => t.id)),
      tags: new Set((project?.catalog.tags ?? []).map((t) => t.id)),
      teams: new Set((project?.catalog.teams ?? []).map((t) => t.id)),
    },
    grid: project?.config.grid ?? 8,
  };
}

export const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '') || 'item';

/** First free slug from `base`: base, base-2, base-3 ... */
export function uniqueSlug(base: string, taken: Set<string>): string {
  const slug = slugify(base);
  let id = slug;
  for (let n = 2; taken.has(id); n++) id = `${slug.slice(0, 60)}-${n}`;
  taken.add(id);
  return id;
}

export const snap = (v: number, grid: number) => Math.round(v / grid) * grid;

/** Collects catalog items referenced during an import; emits catalog.set for new ones only. */
export class CatalogCollector {
  private pending = new Map<string, { list: 'technologies' | 'tags' | 'teams'; id: string; name: string; color?: string }>();
  constructor(private ctx: ImportContext) {}

  /** Returns the catalog id for `name`, registering it when new. */
  ref(list: 'technologies' | 'tags' | 'teams', name: string, opts: { id?: string; color?: string } = {}): string {
    const id = opts.id ?? slugify(name);
    if (!this.ctx.catalog[list].has(id) && !this.pending.has(`${list}:${id}`)) this.pending.set(`${list}:${id}`, { list, id, name, color: opts.color });
    return id;
  }

  ops(): Op[] {
    return [...this.pending.values()].map(({ list, id, name, color }) => ({ op: 'catalog.set', list, item: { id, name, ...(color ? { color } : {}) } }) as Op);
  }
}

/** Ancestors from a parent map, starting at `id`. */
export function chain(parents: Map<string, string | undefined>, id: string): string[] {
  const out: string[] = [];
  let cur: string | undefined = id;
  while (cur && !out.includes(cur)) {
    out.push(cur);
    cur = parents.get(cur);
  }
  return out;
}

export const ZARK_KINDS: Kind[] = ['actor', 'system', 'app', 'store', 'component'];
