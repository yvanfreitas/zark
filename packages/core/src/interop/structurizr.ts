// Structurizr JSON workspace (https://github.com/structurizr/json).
// person -> actor, softwareSystem -> system, container -> app (store when tagged "Database"),
// component -> component; relationships -> connections on the source; views -> drawings.
// Zark-only fields travel in `properties` under "zark:*" so an export/import round trip is lossless
// for the model; anchor sides, groups and notes are not mapped.
import type { Op } from '../ops.js';
import type { Project } from '../project.js';
import type { DrawingEdge, Entity, Kind } from '../schema.js';
import { CatalogCollector, chain, snap, uniqueSlug, type ImportContext, type ImportResult } from './common.js';

/** Structurizr boxes are ~450x300; Zark's are 256x128. Positions scale by this factor. */
export const STRUCTURIZR_SCALE = 2;
const DEFAULT_TAGS = new Set(['Element', 'Person', 'Software System', 'Container', 'Component', 'Relationship', 'Database']);
const ROUTING: Record<string, DrawingEdge['shape']> = { Direct: 'straight', Curved: 'curved', Orthogonal: 'step' };
const ROUTING_OUT: Record<string, string> = { straight: 'Direct', curved: 'Curved', step: 'Orthogonal' };

interface SElement {
  id: string;
  name: string;
  description?: string;
  technology?: string;
  tags?: string;
  url?: string;
  location?: 'External' | 'Internal' | 'Unspecified';
  properties?: Record<string, string>;
  relationships?: SRelationship[];
  containers?: SElement[];
  components?: SElement[];
}
interface SRelationship {
  id: string;
  sourceId: string;
  destinationId: string;
  description?: string;
  technology?: string;
  tags?: string;
  linkedRelationshipId?: string;
  properties?: Record<string, string>;
}
interface SView {
  key: string;
  title?: string;
  description?: string;
  softwareSystemId?: string;
  containerId?: string;
  elements?: { id: string; x?: number; y?: number }[];
  relationships?: { id: string; vertices?: { x: number; y: number }[]; routing?: string; position?: number }[];
}
export interface StructurizrWorkspace {
  name?: string;
  description?: string;
  model: { people?: SElement[]; softwareSystems?: SElement[]; deploymentNodes?: unknown[] };
  views?: { systemLandscapeViews?: SView[]; systemContextViews?: SView[]; containerViews?: SView[]; componentViews?: SView[]; [k: string]: unknown };
}

export function isStructurizr(data: unknown): data is StructurizrWorkspace {
  const m = (data as StructurizrWorkspace | undefined)?.model;
  return !!m && typeof m === 'object' && (Array.isArray(m.people) || Array.isArray(m.softwareSystems));
}

const splitTags = (tags?: string) => (tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
const splitCsv = (s?: string) => (s ?? '').split(',').map((t) => t.trim()).filter(Boolean);

export function fromStructurizr(ws: StructurizrWorkspace, ctx: ImportContext): ImportResult {
  const warnings: string[] = [];
  const once = new Set<string>();
  const warn = (key: string, text: string) => {
    if (!once.has(key)) warnings.push(text);
    once.add(key);
  };
  const catalog = new CatalogCollector(ctx);
  const taken = new Set(ctx.entities);
  const ids = new Map<string, string>();
  const parents = new Map<string, string | undefined>();
  const elements: { el: SElement; kind: Kind; parent?: string }[] = [];
  const relationships: SRelationship[] = [];

  const visit = (el: SElement, kind: Kind, parent?: string) => {
    const base = el.properties?.['zark:id'] ?? el.name;
    const id = uniqueSlug(base, taken);
    ids.set(el.id, id);
    parents.set(id, parent);
    elements.push({ el, kind, parent });
    // Relationships nest inside their source element; take it as sourceId when the file omits it.
    relationships.push(...(el.relationships ?? []).map((r) => ({ ...r, sourceId: r.sourceId ?? el.id })));
    for (const c of el.containers ?? []) visit(c, splitTags(c.tags).includes('Database') ? 'store' : 'app', id);
    for (const c of el.components ?? []) visit(c, 'component', id);
  };
  for (const p of ws.model.people ?? []) visit(p, 'actor');
  for (const s of ws.model.softwareSystems ?? []) visit(s, 'system');
  if (ws.model.deploymentNodes?.length) warn('deploy', 'Deployment nodes were not imported');

  const ops: Op[] = [];
  for (const { el, kind, parent } of elements) {
    const p = el.properties ?? {};
    const tags = splitTags(el.tags).filter((t) => !DEFAULT_TAGS.has(t));
    const techIds = p['zark:technologies'] ? splitCsv(p['zark:technologies']) : undefined;
    const techs = techIds ? techIds.map((t) => catalog.ref('technologies', t, { id: t })) : splitCsv(el.technology).map((t) => catalog.ref('technologies', t));
    let links: Entity['links'];
    try {
      links = p['zark:links'] ? JSON.parse(p['zark:links']) : el.url ? [{ label: 'Link', url: el.url }] : undefined;
    } catch {
      warn(`links:${el.id}`, `Invalid links in ${el.name}`);
    }
    let source: Entity['source'];
    try {
      source = p['zark:source'] ? JSON.parse(p['zark:source']) : undefined;
    } catch {
      warn(`source:${el.id}`, `Invalid source in ${el.name}`);
    }
    ops.push({
      op: 'entity.create',
      entity: {
        id: ids.get(el.id)!,
        name: el.name,
        kind,
        ...(parent ? { parent } : {}),
        ...(el.description ? { caption: el.description } : {}),
        ...(p['zark:description'] ? { description: p['zark:description'] } : {}),
        ...(p['zark:icon'] && /^[a-z0-9-]+:[a-z0-9._-]+$/.test(p['zark:icon']) ? { icon: p['zark:icon'] } : {}),
        ...(el.location === 'External' || p['zark:external'] === 'true' ? { external: true } : {}),
        ...(p['zark:status'] ? { status: p['zark:status'] as 'future' } : {}),
        ...(techs.length ? { technologies: techs } : {}),
        ...(tags.length ? { tags: tags.map((t) => catalog.ref('tags', t)) } : {}),
        ...(p['zark:owner'] ? { owner: catalog.ref('teams', p['zark:owner'], { id: p['zark:owner'] }) } : {}),
        ...(links?.length ? { links } : {}),
        ...(source ? { source } : {}),
      },
    });
  }

  // Relationships. Implied ones (linkedRelationshipId) point at a real one and are not duplicated.
  const refOf = new Map<string, string>();
  const used = new Map<string, Set<string>>();
  for (const r of relationships) {
    if (r.linkedRelationshipId) continue;
    const from = ids.get(r.sourceId);
    const to = ids.get(r.destinationId);
    if (!from || !to || from === to) {
      warn(`rel:${r.id}`, `Relationship "${r.description ?? r.id}" ignored: missing end or self-loop`);
      continue;
    }
    const p = r.properties ?? {};
    const set = used.get(from) ?? new Set<string>();
    used.set(from, set);
    const id = uniqueSlug(p['zark:id'] ?? (r.description || 'relacao'), set);
    const techIds = p['zark:technologies'] ? splitCsv(p['zark:technologies']) : undefined;
    const techs = techIds ? techIds.map((t) => catalog.ref('technologies', t, { id: t })) : splitCsv(r.technology).map((t) => catalog.ref('technologies', t));
    const tags = splitTags(r.tags).filter((t) => !DEFAULT_TAGS.has(t));
    const via = p['zark:via'] ? ids.get(p['zark:via']) ?? (taken.has(p['zark:via']) ? p['zark:via'] : undefined) : undefined;
    ops.push({
      op: 'connection.create',
      from,
      connection: {
        id,
        to,
        label: r.description ?? '',
        ...(p['zark:direction'] === 'bidirectional' ? { direction: 'bidirectional' as const } : {}),
        ...(p['zark:description'] ? { description: p['zark:description'] } : {}),
        ...(via ? { via } : {}),
        ...(techs.length ? { technologies: techs } : {}),
        ...(p['zark:status'] ? { status: p['zark:status'] as 'future' } : {}),
        ...(tags.length ? { tags: tags.map((t) => catalog.ref('tags', t)) } : {}),
      },
    });
    refOf.set(r.id, `${from}.${id}`);
  }
  // Implied relationships drawn in a view resolve to the real one.
  for (const r of relationships) if (r.linkedRelationshipId && refOf.has(r.linkedRelationshipId)) refOf.set(r.id, refOf.get(r.linkedRelationshipId)!);

  // Views -> drawings.
  const views: { v: SView; scope: string | null }[] = [
    ...(ws.views?.systemLandscapeViews ?? []).map((v) => ({ v, scope: null })),
    ...(ws.views?.systemContextViews ?? []).map((v) => ({ v, scope: null })),
    ...(ws.views?.containerViews ?? []).map((v) => ({ v, scope: (v.softwareSystemId && ids.get(v.softwareSystemId)) || null })),
    ...(ws.views?.componentViews ?? []).map((v) => ({ v, scope: (v.containerId && ids.get(v.containerId)) || null })),
  ];
  for (const k of ['dynamicViews', 'deploymentViews', 'filteredViews', 'imageViews', 'customViews']) {
    if ((ws.views?.[k] as unknown[] | undefined)?.length) warn(k, `Views of type ${k} were not imported (Zark flows are built separately)`);
  }
  const drawingTaken = new Set(ctx.drawings);
  const g = ctx.grid;
  for (const { v, scope } of views) {
    const drawing = uniqueSlug(v.key, drawingTaken);
    const placed = (v.elements ?? []).filter((e) => ids.has(e.id));
    const positioned = placed.every((e) => typeof e.x === 'number' && typeof e.y === 'number');
    const nodeIds = new Set(placed.map((e) => ids.get(e.id)!));
    const resolve = (id: string) => chain(parents, id).find((a) => nodeIds.has(a));
    const edges: ({ ref: string } & DrawingEdge)[] = [];
    for (const r of v.relationships ?? []) {
      const ref = refOf.get(r.id);
      if (!ref || edges.some((e) => e.ref === ref)) continue;
      const [from] = ref.split('.');
      const to = (ops.find((o) => o.op === 'connection.create' && `${o.from}.${o.connection.id}` === ref) as Extract<Op, { op: 'connection.create' }>).connection.to;
      const a = resolve(from);
      const b = resolve(to);
      if (!a || !b || a === b) continue;
      const shape = ROUTING[r.routing ?? ''] ?? 'straight';
      edges.push({
        ref,
        shape,
        ...(r.vertices?.length ? { points: r.vertices.map((p) => [snap(p.x / STRUCTURIZR_SCALE, g), snap(p.y / STRUCTURIZR_SCALE, g)] as [number, number]) } : {}),
        ...(typeof r.position === 'number' && r.position !== 50 ? { labelAt: Math.min(1, Math.max(0, Math.round(r.position) / 100)) } : {}),
      });
    }
    ops.push(
      { op: 'drawing.create', drawing: { id: drawing, name: v.title || v.key, ...(v.description ? { description: v.description } : {}), scope } },
      {
        op: 'drawing.place',
        drawing,
        nodes: placed.map((e) => ({ id: ids.get(e.id)!, ...(positioned ? { x: snap(e.x! / STRUCTURIZR_SCALE, g), y: snap(e.y! / STRUCTURIZR_SCALE, g) } : {}) })),
      },
      ...(edges.length ? [{ op: 'drawing.draw-edges', drawing, edges } as Op] : []),
      ...(positioned ? [] : [{ op: 'drawing.auto-layout', drawing } as Op]),
    );
  }
  return { ops: [...catalog.ops(), ...ops], warnings };
}

export function toStructurizr(project: Project): StructurizrWorkspace {
  const techName = (id: string) => project.catalog.technologies?.find((t) => t.id === id)?.name ?? id;
  const rels = (from: string): SRelationship[] =>
    [...project.connections.values()]
      .filter((c) => c.from === from)
      .map(({ ref, conn: c }) => ({
        id: ref,
        sourceId: from,
        destinationId: c.to,
        description: c.label,
        ...(c.technologies?.length ? { technology: c.technologies.map(techName).join(', ') } : {}),
        tags: ['Relationship', ...(c.tags ?? [])].join(','),
        properties: props({ 'zark:id': c.id, 'zark:direction': c.direction, 'zark:via': c.via, 'zark:status': c.status, 'zark:description': c.description, 'zark:technologies': c.technologies?.join(',') }),
      }));
  const element = (e: Entity, defaultTags: string[]): SElement => ({
    id: e.id,
    name: e.name,
    ...(e.caption ? { description: e.caption } : {}),
    ...(e.technologies?.length && (e.kind === 'app' || e.kind === 'store' || e.kind === 'component') ? { technology: e.technologies.map(techName).join(', ') } : {}),
    tags: [...defaultTags, ...(e.kind === 'store' ? ['Database'] : []), ...(e.tags ?? [])].join(','),
    ...(e.links?.[0] ? { url: e.links[0].url } : {}),
    ...(e.kind === 'actor' || e.kind === 'system' ? { location: e.external ? 'External' : 'Internal' } : {}),
    properties: props({
      'zark:id': e.id,
      'zark:description': e.description,
      'zark:icon': e.icon,
      'zark:status': e.status,
      'zark:technologies': e.technologies?.join(','),
      'zark:owner': e.owner,
      'zark:links': e.links?.length ? JSON.stringify(e.links) : undefined,
      'zark:source': e.source === undefined ? undefined : JSON.stringify(e.source),
      'zark:external': e.external && e.kind !== 'actor' && e.kind !== 'system' ? 'true' : undefined,
    }),
    relationships: rels(e.id),
  });
  const children = (id: string) => [...project.entities.values()].filter((x) => x.entity.parent === id).map((x) => x.entity);
  const people = [...project.entities.values()].filter((x) => x.entity.kind === 'actor').map((x) => element(x.entity, ['Element', 'Person']));
  const softwareSystems = [...project.entities.values()]
    .filter((x) => x.entity.kind === 'system')
    .map((x) => ({
      ...element(x.entity, ['Element', 'Software System']),
      containers: children(x.entity.id)
        .filter((c) => c.kind === 'app' || c.kind === 'store')
        .map((c) => ({ ...element(c, ['Element', 'Container']), components: children(c.id).filter((k) => k.kind === 'component').map((k) => element(k, ['Element', 'Component'])) })),
    }));

  const view = (id: string): SView => {
    const d = project.drawings.get(id)!.drawing;
    return {
      key: d.id,
      title: d.name,
      ...(d.description ? { description: d.description } : {}),
      elements: Object.entries(d.nodes ?? {}).map(([nid, n]) => ({ id: nid, x: n.x * STRUCTURIZR_SCALE, y: n.y * STRUCTURIZR_SCALE })),
      relationships: Object.entries(d.edges ?? {}).map(([ref, e]) => ({
        id: ref,
        ...(e.points?.length ? { vertices: e.points.map(([x, y]) => ({ x: x * STRUCTURIZR_SCALE, y: y * STRUCTURIZR_SCALE })) } : {}),
        routing: ROUTING_OUT[e.shape ?? 'straight'],
        ...(e.labelAt !== undefined ? { position: Math.round(e.labelAt * 100) } : {}),
      })),
    };
  };
  const systemLandscapeViews: SView[] = [];
  const containerViews: SView[] = [];
  const componentViews: SView[] = [];
  for (const [id, { drawing }] of project.drawings) {
    const scopeKind = drawing.scope ? project.entities.get(drawing.scope)?.entity.kind : undefined;
    if (!drawing.scope) systemLandscapeViews.push(view(id));
    else if (scopeKind === 'system') containerViews.push({ ...view(id), softwareSystemId: drawing.scope });
    else componentViews.push({ ...view(id), containerId: drawing.scope });
  }
  return {
    name: project.config.name,
    model: { people, softwareSystems },
    views: { systemLandscapeViews, containerViews, componentViews },
  };
}

function props(p: Record<string, string | undefined>): Record<string, string> | undefined {
  const out = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string>;
  return Object.keys(out).length ? out : undefined;
}

