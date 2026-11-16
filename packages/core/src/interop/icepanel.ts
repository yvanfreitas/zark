// IcePanel "model as code" (LandscapeImportData, https://api.icepanel.io/v1/schemas/LandscapeImportData).
// Schema read on 2026-11-13: modelObjects {id, name, type, parentId?, caption?, description?, external?,
// status?, tagIds?, technologyIds?, teamIds?, links?[{url, customName?}], groupIds?, labels?},
// modelConnections {id, name, originId, targetId, direction, description?, viaId?, status?, tagIds?,
// technologyIds?}, tags {id, name, color, groupId}, tagGroups {id, name, icon}.
// The format carries no diagrams, so the import creates one drawing with the root items laid out.
//
// Conformance (test/icepanel-schema.test.ts validates against the vendored schema):
// - IcePanel requires actor/system objects to sit under a domain, so the export wraps the root in one.
// - technologyIds/teamIds must be ids from IcePanel's own catalog (api.icepanel.io/v1/catalog/technologies)
//   and organization; Zark catalog ids are not, so the export carries them in `labels` as `id=Name`
//   pairs (zark:technologies, zark:owner) and the import reads them back.
// - IcePanel's own guide example uses type "database" (not in the schema enum); the import maps it to store.
import { Document } from 'yaml';
import type { Op } from '../ops.js';
import type { Project } from '../project.js';
import type { Kind } from '../schema.js';
import { CatalogCollector, chain, slugify, uniqueSlug, ZARK_KINDS, type ImportContext, type ImportResult } from './common.js';

export const ICEPANEL_SCHEMA = 'https://api.icepanel.io/v1/schemas/LandscapeImportData';
/** A TagGroupIcon enum value (the guide's example uses "tag", which the schema rejects). */
const TAG_GROUP_ICON = 'toolbox';
const LABEL = { technologies: 'zark:technologies', owner: 'zark:owner', icon: 'zark:icon', source: 'zark:source' } as const;
const TYPE_ALIASES: Record<string, Kind> = { database: 'store' };
const TAG_COLORS = ['blue', 'green', 'yellow', 'orange', 'red', 'beaver', 'dark-blue', 'purple', 'pink', 'white', 'grey', 'black'];

interface IceObject {
  id: string;
  name: string;
  type: string;
  parentId?: string | null;
  caption?: string;
  description?: string;
  external?: boolean;
  status?: string;
  tagIds?: string[];
  technologyIds?: string[];
  teamIds?: string[];
  links?: { url: string; customName?: string }[];
  groupIds?: string[];
  labels?: Record<string, string>;
}
interface IceConnection {
  id: string;
  name: string;
  originId: string;
  targetId: string;
  direction?: 'outgoing' | 'bidirectional';
  description?: string;
  viaId?: string;
  status?: string;
  tagIds?: string[];
  technologyIds?: string[];
  labels?: Record<string, string>;
}
export interface IcePanelData {
  modelObjects?: IceObject[];
  modelConnections?: IceConnection[];
  tags?: { id: string; name: string; color?: string; groupId?: string }[];
  tagGroups?: { id: string; name: string; icon?: string }[];
  namespace?: string;
}

const isSlug = (s: string) => /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(s);
const STATUSES = ['live', 'future', 'deprecated', 'removed'];

export function isIcePanel(data: unknown): data is IcePanelData {
  return !!data && typeof data === 'object' && (Array.isArray((data as IcePanelData).modelObjects) || Array.isArray((data as IcePanelData).modelConnections));
}

export function fromIcePanel(data: IcePanelData, ctx: ImportContext, opts: { drawingName?: string } = {}): ImportResult {
  const warnings: string[] = [];
  const warnOnce = new Set<string>();
  const warn = (key: string, text: string) => {
    if (!warnOnce.has(key)) warnings.push(text);
    warnOnce.add(key);
  };
  const catalog = new CatalogCollector(ctx);
  const tagById = new Map((data.tags ?? []).map((t) => [t.id, t]));
  const objects = (data.modelObjects ?? []).map((o) => (TYPE_ALIASES[o.type] ? { ...o, type: TYPE_ALIASES[o.type] } : o)).filter((o) => {
    if (ZARK_KINDS.includes(o.type as Kind)) return true;
    if (o.type === 'domain') warn('domain', `IcePanel domains do not exist in Zark; their children become root items (${o.name})`);
    else if (o.type === 'group') warn('group', 'IcePanel groups were not imported: in Zark groups are frames of each drawing');
    else warn(`type:${o.type}`, `Tipo "${o.type}" ignorado (${o.name})`);
    return false;
  });
  const byId = new Map(objects.map((o) => [o.id, o]));
  const taken = new Set(ctx.entities);
  const ids = new Map<string, string>();
  for (const o of objects) ids.set(o.id, uniqueSlug(isSlug(o.id) ? o.id : o.name, taken));
  const parentOf = (o: IceObject) => (o.parentId && byId.has(o.parentId) ? ids.get(o.parentId) : undefined);
  const parents = new Map(objects.map((o) => [ids.get(o.id)!, parentOf(o)]));

  const ops: Op[] = [];
  const depth = (o: IceObject) => chain(parents, ids.get(o.id)!).length;
  for (const o of [...objects].sort((a, b) => depth(a) - depth(b))) {
    if ((o as { icon?: unknown }).icon) warn('icon', 'IcePanel icon (a technologyId from their catalog) has no equivalent and was ignored');
    if (Object.keys(o.labels ?? {}).some((k) => !k.startsWith('zark:'))) warn('labels', 'IcePanel labels have no equivalent and were ignored');
    if (o.groupIds?.length) warn('group', 'IcePanel groups were not imported: in Zark groups are frames of each drawing');
    if (o.teamIds && o.teamIds.length > 1) warn('teams', 'Only the first team of each object becomes the owner in Zark');
    if (o.technologyIds?.length) warn('tech', 'IcePanel technologyIds become catalog items named after their id; adjust the names in catalog.yaml');
    const parent = parentOf(o);
    ops.push({
      op: 'entity.create',
      entity: {
        id: ids.get(o.id)!,
        name: o.name,
        kind: o.type as Kind,
        ...(parent ? { parent } : {}),
        ...(o.caption ? { caption: o.caption } : {}),
        ...(o.labels?.[LABEL.icon] && /^[a-z0-9-]+:[a-z0-9._-]+$/.test(o.labels[LABEL.icon]) ? { icon: o.labels[LABEL.icon] } : {}),
        ...(o.description ? { description: o.description } : {}),
        ...(o.external ? { external: true } : {}),
        ...(o.status && o.status !== 'live' && STATUSES.includes(o.status) ? { status: o.status as 'future' } : {}),
        ...techsOf(catalog, o),
        ...(o.tagIds?.length ? { tags: o.tagIds.map((t) => tagRef(catalog, tagById.get(t), t)) } : {}),
        ...ownerOf(catalog, o),
        ...sourceOf(o),
        ...(o.links?.length ? { links: o.links.map((l) => ({ label: l.customName || l.url, url: l.url })) } : {}),
      },
    });
  }

  // Connections live on their origin.
  const connIds = new Map<string, Set<string>>();
  const refs: { ref: string; from: string; to: string }[] = [];
  for (const c of data.modelConnections ?? []) {
    const from = ids.get(c.originId);
    const to = ids.get(c.targetId);
    if (!from || !to) {
      warn(`conn:${c.id}`, `Connection "${c.name}" ignored: source or target was not imported`);
      continue;
    }
    if (from === to) {
      warn(`self:${c.id}`, `Connection "${c.name}" ignored: it links ${from} to itself`);
      continue;
    }
    const used = connIds.get(from) ?? new Set<string>();
    connIds.set(from, used);
    const base = c.id.startsWith(`${c.originId}.`) ? c.id.slice(c.originId.length + 1) : c.name || 'connection';
    const id = uniqueSlug(base, used);
    const via = c.viaId ? ids.get(c.viaId) : undefined;
    ops.push({
      op: 'connection.create',
      from,
      connection: {
        id,
        to,
        label: c.name ?? '',
        ...(c.direction === 'bidirectional' ? { direction: 'bidirectional' as const } : {}),
        ...(c.description ? { description: c.description } : {}),
        ...(via ? { via } : {}),
        ...techsOf(catalog, c),
        ...(c.status && c.status !== 'live' && STATUSES.includes(c.status) ? { status: c.status as 'future' } : {}),
        ...(c.tagIds?.length ? { tags: c.tagIds.map((t) => tagRef(catalog, tagById.get(t), t)) } : {}),
      },
    });
    refs.push({ ref: `${from}.${id}`, from, to });
  }

  // One drawing with the root items; connections drawn where both ends resolve to distinct roots.
  const roots = objects.map((o) => ids.get(o.id)!).filter((id) => !parents.get(id));
  if (roots.length) {
    const drawingTaken = new Set(ctx.drawings);
    const drawing = uniqueSlug('icepanel', drawingTaken);
    const rootOf = (id: string) => chain(parents, id).at(-1)!;
    const edges = refs.filter((r) => rootOf(r.from) !== rootOf(r.to)).map((r) => ({ ref: r.ref, shape: 'straight' as const }));
    ops.push(
      { op: 'drawing.create', drawing: { id: drawing, name: opts.drawingName ?? 'Imported from IcePanel', scope: null } },
      { op: 'drawing.place', drawing, nodes: roots.map((id) => ({ id })) },
      ...(edges.length ? [{ op: 'drawing.draw-edges', drawing, edges } as Op] : []),
      { op: 'drawing.auto-layout', drawing },
    );
  }
  return { ops: [...catalog.ops(), ...ops], warnings };
}

/** `id=Name, id2=Name 2` pairs; ", " and "=" inside names become spaces. */
const encodePairs = (items: { id: string; name: string }[]) => items.map((i) => `${i.id}=${i.name.replace(/,\s|=/g, ' ')}`).join(', ');
const decodePairs = (text: string) =>
  text
    .split(', ')
    .map((p) => p.split('='))
    .filter(([id]) => id?.trim())
    .map(([id, name]) => ({ id: slugify(id), name: (name ?? id).trim() }));

/** Zark labels win (lossless round trip); IcePanel catalog ids become catalog items named after the id. */
function techsOf(catalog: CatalogCollector, o: { labels?: Record<string, string>; technologyIds?: string[] }) {
  const fromLabel = o.labels?.[LABEL.technologies];
  if (fromLabel) return { technologies: decodePairs(fromLabel).map((t) => catalog.ref('technologies', t.name, { id: t.id })) };
  return o.technologyIds?.length ? { technologies: o.technologyIds.map((t) => catalog.ref('technologies', t, { id: slugify(t) })) } : {};
}
/** `source` travels JSON-encoded in a label (a string or a list of paths). */
function sourceOf(o: IceObject) {
  const raw = o.labels?.[LABEL.source];
  if (!raw) return {};
  try {
    return { source: JSON.parse(raw) as string | string[] };
  } catch {
    return {};
  }
}

function ownerOf(catalog: CatalogCollector, o: IceObject) {
  const fromLabel = o.labels?.[LABEL.owner];
  if (fromLabel) {
    const [team] = decodePairs(fromLabel);
    if (team) return { owner: catalog.ref('teams', team.name, { id: team.id }) };
  }
  return o.teamIds?.length ? { owner: catalog.ref('teams', o.teamIds[0], { id: slugify(o.teamIds[0]) }) } : {};
}

function tagRef(catalog: CatalogCollector, tag: { id: string; name: string; color?: string } | undefined, raw: string) {
  return catalog.ref('tags', tag?.name ?? raw, { id: slugify(tag?.name ?? raw), color: tag?.color });
}

export function toIcePanel(project: Project): IcePanelData {
  const tags = (project.catalog.tags ?? []).map((t) => ({ id: t.id, name: t.name, color: TAG_COLORS.includes(t.color ?? '') ? t.color! : 'grey', groupId: 'zark' }));
  const named = (list: 'technologies' | 'teams', ids: string[]) => ids.map((id) => ({ id, name: project.catalog[list]?.find((i) => i.id === id)?.name ?? id }));
  const labelsOf = (techs?: string[], owner?: string, icon?: string, source?: string | string[]) => {
    const labels: Record<string, string> = {};
    // IcePanel's own icon is a technologyId of its catalog; ours travels as a label.
    if (icon) labels[LABEL.icon] = icon;
    if (source !== undefined) labels[LABEL.source] = JSON.stringify(source);
    if (techs?.length) labels[LABEL.technologies] = encodePairs(named('technologies', techs));
    if (owner) labels[LABEL.owner] = encodePairs(named('teams', [owner]));
    return Object.keys(labels).length ? { labels } : {};
  };
  // IcePanel hierarchy: actor/system must have a domain parent.
  const domainId = uniqueSlug(`domain-${project.config.name}`, new Set(project.entities.keys()));
  const domain: IceObject = { id: domainId, name: project.config.name, type: 'domain' };
  const modelObjects: IceObject[] = [domain, ...[...project.entities.values()].map(({ entity: e }) => ({
    id: e.id,
    name: e.name,
    type: e.kind,
    parentId: e.parent ?? domainId,
    ...(e.caption ? { caption: e.caption } : {}),
    ...(e.description ? { description: e.description } : {}),
    ...(e.external ? { external: true } : {}),
    ...(e.status ? { status: e.status } : {}),
    ...(e.tags?.length ? { tagIds: e.tags } : {}),
    ...labelsOf(e.technologies, e.owner, e.icon, e.source),
    ...(e.links?.length ? { links: e.links.map((l) => ({ url: l.url, customName: l.label })) } : {}),
  }))];
  const modelConnections: IceConnection[] = [...project.connections.values()].map(({ ref, from, conn: c }) => ({
    id: ref,
    name: c.label,
    originId: from,
    targetId: c.to,
    direction: c.direction ?? 'outgoing',
    ...(c.description ? { description: c.description } : {}),
    ...(c.via ? { viaId: c.via } : {}),
    ...(c.status ? { status: c.status } : {}),
    ...(c.tags?.length ? { tagIds: c.tags } : {}),
    ...labelsOf(c.technologies),
  }));
  return {
    ...(tags.length ? { tagGroups: [{ id: 'zark', name: 'Zark', icon: TAG_GROUP_ICON }], tags } : {}),
    modelObjects,
    modelConnections,
  };
}

/** YAML ready for IcePanel's "Import model > File upload" (validated by its JSON Schema in editors). */
export function toIcePanelYaml(project: Project): string {
  const doc = new Document(toIcePanel(project));
  doc.commentBefore = ` yaml-language-server: $schema=${ICEPANEL_SCHEMA}\n Generated by Zark. Technologies and team go in labels (zark:technologies, zark:owner):\n IcePanel technologyIds/teamIds require ids from the IcePanel catalog and organization.`;
  return doc.toString({ lineWidth: 0 });
}
