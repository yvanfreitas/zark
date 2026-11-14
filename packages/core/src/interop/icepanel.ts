// IcePanel "model as code" (LandscapeImportData, https://api.icepanel.io/v1/schemas/LandscapeImportData).
// Schema read on 2026-11-13: modelObjects {id, name, type, parentId?, caption?, description?, external?,
// status?, tagIds?, technologyIds?, teamIds?, links?[{url, customName?}], groupIds?, labels?},
// modelConnections {id, name, originId, targetId, direction, description?, viaId?, status?, tagIds?,
// technologyIds?}, tags {id, name, color, groupId}, tagGroups {id, name, icon}.
// The format carries no diagrams, so the import creates one drawing with the root items laid out.
import { Document } from 'yaml';
import type { Op } from '../ops.js';
import type { Project } from '../project.js';
import type { Kind } from '../schema.js';
import { CatalogCollector, chain, slugify, uniqueSlug, ZARK_KINDS, type ImportContext, type ImportResult } from './common.js';

export const ICEPANEL_SCHEMA = 'https://api.icepanel.io/v1/schemas/LandscapeImportData';
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
  labels?: Record<string, unknown>;
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
  const objects = (data.modelObjects ?? []).filter((o) => {
    if (ZARK_KINDS.includes(o.type as Kind)) return true;
    if (o.type === 'domain') warn('domain', `Domínios do IcePanel não existem no Zark; seus filhos viram itens da raiz (${o.name})`);
    else if (o.type === 'group') warn('group', 'Grupos do IcePanel não foram importados: no Zark grupos são molduras de cada desenho');
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
    if (o.labels && Object.keys(o.labels).length) warn('labels', 'Labels do IcePanel não têm equivalente e foram ignorados');
    if (o.groupIds?.length) warn('group', 'Grupos do IcePanel não foram importados: no Zark grupos são molduras de cada desenho');
    if (o.teamIds && o.teamIds.length > 1) warn('teams', 'Só o primeiro time de cada objeto vira owner no Zark');
    if (o.technologyIds?.length) warn('tech', 'technologyIds do IcePanel viram itens do catálogo com o próprio id como nome; ajuste os nomes em catalog.yaml');
    const parent = parentOf(o);
    ops.push({
      op: 'entity.create',
      entity: {
        id: ids.get(o.id)!,
        name: o.name,
        kind: o.type as Kind,
        ...(parent ? { parent } : {}),
        ...(o.caption ? { caption: o.caption } : {}),
        ...(o.description ? { description: o.description } : {}),
        ...(o.external ? { external: true } : {}),
        ...(o.status && o.status !== 'live' && STATUSES.includes(o.status) ? { status: o.status as 'future' } : {}),
        ...(o.technologyIds?.length ? { technologies: o.technologyIds.map((t) => catalog.ref('technologies', t, { id: slugify(t) })) } : {}),
        ...(o.tagIds?.length ? { tags: o.tagIds.map((t) => tagRef(catalog, tagById.get(t), t)) } : {}),
        ...(o.teamIds?.length ? { owner: catalog.ref('teams', o.teamIds[0], { id: slugify(o.teamIds[0]) }) } : {}),
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
      warn(`conn:${c.id}`, `Conexão "${c.name}" ignorada: origem ou destino não importado`);
      continue;
    }
    if (from === to) {
      warn(`self:${c.id}`, `Conexão "${c.name}" ignorada: liga ${from} a ele mesmo`);
      continue;
    }
    const used = connIds.get(from) ?? new Set<string>();
    connIds.set(from, used);
    const base = c.id.startsWith(`${c.originId}.`) ? c.id.slice(c.originId.length + 1) : c.name || 'conexao';
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
        ...(c.technologyIds?.length ? { technologies: c.technologyIds.map((t) => catalog.ref('technologies', t, { id: slugify(t) })) } : {}),
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
      { op: 'drawing.create', drawing: { id: drawing, name: opts.drawingName ?? 'Importado do IcePanel', scope: null } },
      { op: 'drawing.place', drawing, nodes: roots.map((id) => ({ id })) },
      ...(edges.length ? [{ op: 'drawing.draw-edges', drawing, edges } as Op] : []),
      { op: 'drawing.auto-layout', drawing },
    );
  }
  return { ops: [...catalog.ops(), ...ops], warnings };
}

function tagRef(catalog: CatalogCollector, tag: { id: string; name: string; color?: string } | undefined, raw: string) {
  return catalog.ref('tags', tag?.name ?? raw, { id: slugify(tag?.name ?? raw), color: tag?.color });
}

export function toIcePanel(project: Project): IcePanelData {
  const tags = (project.catalog.tags ?? []).map((t) => ({ id: t.id, name: t.name, color: TAG_COLORS.includes(t.color ?? '') ? t.color! : 'grey', groupId: 'zark' }));
  const modelObjects: IceObject[] = [...project.entities.values()].map(({ entity: e }) => ({
    id: e.id,
    name: e.name,
    type: e.kind,
    ...(e.parent ? { parentId: e.parent } : {}),
    ...(e.caption ? { caption: e.caption } : {}),
    ...(e.description ? { description: e.description } : {}),
    ...(e.external ? { external: true } : {}),
    ...(e.status ? { status: e.status } : {}),
    ...(e.tags?.length ? { tagIds: e.tags } : {}),
    ...(e.technologies?.length ? { technologyIds: e.technologies } : {}),
    ...(e.owner ? { teamIds: [e.owner] } : {}),
    ...(e.links?.length ? { links: e.links.map((l) => ({ url: l.url, customName: l.label })) } : {}),
  }));
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
    ...(c.technologies?.length ? { technologyIds: c.technologies } : {}),
  }));
  return {
    ...(tags.length ? { tagGroups: [{ id: 'zark', name: 'Zark', icon: 'tag' }], tags } : {}),
    modelObjects,
    modelConnections,
  };
}

/** YAML ready for IcePanel's "Import model > File upload" (validated by its JSON Schema in editors). */
export function toIcePanelYaml(project: Project): string {
  const doc = new Document(toIcePanel(project));
  doc.commentBefore = ` yaml-language-server: $schema=${ICEPANEL_SCHEMA}\n Gerado pelo Zark. technologyIds e teamIds são ids do catálogo do Zark.`;
  return doc.toString({ lineWidth: 0 });
}
