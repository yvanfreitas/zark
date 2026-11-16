/**
 * Read-time aggregation of a generated code graph (C4 level 4). Edges are stored at
 * method granularity; the code view shows them per module pair or per piece pair.
 *
 * Node ids are relative to the graph being viewed: `<path>` / `<path>#<Piece>` for its
 * own modules, `<component>:<path>[#<Piece>]` for those of other components.
 */
import type { CodeGraph } from '../types';

export type CodeEdgeKind = CodeGraph['edges'][number]['kind'];
export interface CodeLevelNode {
  id: string;
  label: string;
  foreign: boolean;
}
export interface CodeLevelEdge {
  from: string;
  to: string;
  count: number;
  kinds: CodeEdgeKind[];
}
export interface CodeLevel {
  nodes: CodeLevelNode[];
  edges: CodeLevelEdge[];
}

/** An endpoint with its component made explicit; `piece` keeps any `.member` suffix. */
interface Endpoint {
  component: string;
  path: string;
  piece?: string;
}

const PREFIX = /^([a-z0-9-]+):(.*)$/;

function parseEndpoint(raw: string, component: string): Endpoint {
  const m = PREFIX.exec(raw);
  const [comp, rest] = m ? [m[1], m[2]] : [component, raw];
  const hash = rest.indexOf('#');
  return hash < 0 ? { component: comp, path: rest } : { component: comp, path: rest.slice(0, hash), piece: rest.slice(hash + 1) };
}

/** Component, file and piece of a node id as produced by `moduleLevel` / `pieceLevel`. */
export function parseNodeId(id: string, component: string): Endpoint {
  return parseEndpoint(id, component);
}

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Every edge that starts or ends in `graph`, from its own file and from the other components' files. */
function edgesTouching(graph: CodeGraph, all: CodeGraph[]) {
  const sources = [graph, ...all.filter((g) => g.component !== graph.component)];
  return sources.flatMap((g) =>
    g.edges
      .map((e) => ({ from: parseEndpoint(e.from, g.component), to: parseEndpoint(e.to, g.component), kind: e.kind, count: e.count }))
      .filter((e) => e.from.component === graph.component || e.to.component === graph.component),
  );
}

function idOf(e: Endpoint, viewed: string, withPiece: boolean): string {
  const local = withPiece && e.piece ? `${e.path}#${e.piece}` : e.path;
  return e.component === viewed ? local : `${e.component}:${local}`;
}

/** Sums counts per (from, to) pair, dropping pairs that collapse onto one node. */
function aggregate(edges: { from: string; to: string; kind: CodeEdgeKind; count: number }[]): CodeLevelEdge[] {
  const pairs = new Map<string, CodeLevelEdge>();
  for (const e of edges) {
    if (e.from === e.to) continue;
    const key = `${e.from}\n${e.to}`;
    const pair = pairs.get(key) ?? pairs.set(key, { from: e.from, to: e.to, count: 0, kinds: [] }).get(key)!;
    pair.count += e.count;
    if (!pair.kinds.includes(e.kind)) pair.kinds.push(e.kind);
  }
  const out = [...pairs.values()];
  for (const p of out) p.kinds.sort();
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

/** Own nodes first (as listed), then foreign ones by id. */
function nodeList(own: CodeLevelNode[], foreign: Map<string, string>): CodeLevelNode[] {
  const rest = [...foreign].filter(([id]) => !own.some((n) => n.id === id)).sort(([a], [b]) => a.localeCompare(b));
  return [...own, ...rest.map(([id, label]) => ({ id, label, foreign: true }))];
}

/** Longest shared directory of `paths` (with trailing slash), so labels stay short. */
function commonDir(paths: string[]): string {
  if (!paths.length) return '';
  let dir = paths[0].slice(0, paths[0].lastIndexOf('/') + 1);
  while (dir && !paths.every((p) => p.startsWith(dir))) dir = dir.slice(0, dir.slice(0, -1).lastIndexOf('/') + 1);
  return dir;
}

/** One node per module of `graph`, plus the other components' modules it calls or is called by. */
export function moduleLevel(graph: CodeGraph, all: CodeGraph[]): CodeLevel {
  const viewed = graph.component;
  const touching = edgesTouching(graph, all).map((e) => ({ ...e, from: idOf(e.from, viewed, false), to: idOf(e.to, viewed, false) }));
  const own = [...graph.modules].map((m) => m.path).sort();
  const dir = commonDir(own);
  const ownNodes = own.map((path) => ({ id: path, label: path.slice(dir.length), foreign: false }));
  const foreign = new Map<string, string>();
  for (const e of touching) for (const id of [e.from, e.to]) if (!own.includes(id)) foreign.set(id, basename(parseEndpoint(id, viewed).path));
  return { nodes: nodeList(ownNodes, foreign), edges: aggregate(touching) };
}

/** Pieces of one module (members folded into their class), plus the pieces elsewhere it touches. */
export function pieceLevel(graph: CodeGraph, modulePath: string, all: CodeGraph[]): CodeLevel {
  const viewed = graph.component;
  const inModule = (e: Endpoint) => e.component === viewed && e.path === modulePath;
  const fold = (e: Endpoint): Endpoint => (e.piece ? { ...e, piece: e.piece.split('.')[0] } : e);
  const touching = edgesTouching(graph, all)
    .filter((e) => inModule(e.from) || inModule(e.to))
    .map((e) => ({ ...e, from: fold(e.from), to: fold(e.to) }));
  const pieces = graph.modules.find((m) => m.path === modulePath)?.pieces ?? [];
  const own = [...pieces].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ id: `${modulePath}#${p.name}`, label: p.name, foreign: false }));
  const edges = aggregate(touching.map((e) => ({ ...e, from: idOf(e.from, viewed, true), to: idOf(e.to, viewed, true) })));
  // Code at the top of the file (no enclosing piece) gets a node named after the file.
  if (edges.some((e) => e.from === modulePath || e.to === modulePath)) own.push({ id: modulePath, label: basename(modulePath), foreign: false });
  const foreign = new Map<string, string>();
  for (const e of touching) {
    for (const end of [e.from, e.to]) if (!inModule(end)) foreign.set(idOf(end, viewed, true), end.piece ?? basename(end.path));
  }
  return { nodes: nodeList(own, foreign), edges };
}
