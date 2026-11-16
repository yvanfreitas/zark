// One component's code graph from extracted module facts (spec section 3, rules 1-6). Pure: no
// filesystem. A site whose target cannot be confirmed is counted under `unresolved`, never drawn.
import type { CodeEdge, CodeGraph, CodePiece } from '../schema.js';
import type { CallSite, ModuleFacts } from './extract.js';
import { resolveExport, resolveSpecifier, type Aliases } from './resolve.js';

type Unresolved = keyof CodeGraph['unresolved'];
// 'internal': a call into a non-exported declaration of the same module; no edge, not counted.
type Target = { path: string; piece: CodePiece; member?: string } | Unresolved | 'internal';

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Builds the graph of `component` from the facts of its `owned` files. `facts` must also hold the
 * files of other components those files import (to confirm target pieces). `files` is every repo
 * source file, so a target outside `owner` counts as `unowned` rather than `external`.
 *
 * Endpoints are `<path>#<piece>[.<member>]`, prefixed `<id>:` in another component. Calls from
 * non-exported code (`from` '') are attributed to the module itself: endpoint `<path>`; calls into
 * it are internal to the module and neither drawn nor counted.
 * `external` and `unowned` are counted per call site, not per import declaration.
 */
export function buildGraph(
  component: string,
  owned: string[],
  facts: Map<string, ModuleFacts>,
  owner: Map<string, string>,
  aliases: Aliases,
  files: Set<string> = new Set([...owner.keys(), ...facts.keys()]),
): { graph: CodeGraph; parseErrors: number } {
  const unresolved: CodeGraph['unresolved'] = { calls: 0, external: 0, unowned: 0 };
  const edges = new Map<string, CodeEdge>();
  const modules: CodeGraph['modules'] = [];
  let parseErrors = 0;

  const pieceAt = (hit: { path: string; name: string }): Target => {
    if (!owner.has(hit.path)) return 'unowned'; // a re-export chain that leaves the claimed files
    const piece = facts.get(hit.path)?.pieces.find((p) => p.name === hit.name);
    return piece ? { path: hit.path, piece } : 'calls';
  };

  // A module-level `name` (with the `.member` the syntax applies to it) resolved to a piece: a local
  // declaration (by its local name, which may differ from the exported one) or an import (type-only
  // imports only for type hints). On a namespace import the member names the piece and is consumed.
  const resolveName = (path: string, name: string, member: string | undefined, typeHint: boolean): Target => {
    const mod = facts.get(path)!;
    if (mod.locals.has(name)) {
      const piece = mod.pieces.find((p) => p.name === mod.locals.get(name));
      return piece ? { path, piece, member } : 'internal';
    }
    const imp = mod.imports.find((i) => i.local === name && (typeHint || !i.typeOnly));
    if (!imp) return 'calls'; // a global
    const file = resolveSpecifier(path, imp.from, files, aliases);
    if (file === 'external') return 'external';
    if (!owner.has(file)) return 'unowned';
    const hit = imp.imported === '*' ? { path: file, name: '*' } : resolveExport(file, imp.imported, facts, files, aliases);
    if (!hit) return 'calls';
    if (hit.name !== '*') {
      const target = pieceAt(hit);
      return typeof target === 'string' ? target : { ...target, member };
    }
    const inner = member ? resolveExport(hit.path, member, facts, files, aliases) : undefined;
    return inner && inner.name !== '*' ? pieceAt(inner) : 'calls';
  };

  const resolveSite = (path: string, site: CallSite): Target => {
    const hint = site.target;
    if (hint.ref === 'unknown') return 'calls';
    if (hint.ref === 'binding') return resolveName(path, hint.name, hint.member, false);
    const target = resolveName(path, hint.typeName, undefined, true);
    if (typeof target === 'string') return target;
    // An instance call needs a class or interface; an interface is the target itself (implementations are not guessed).
    if (target.piece.kind !== 'class' && target.piece.kind !== 'interface') return 'calls';
    return { ...target, member: hint.member };
  };

  // `Class.member` only for a listed member (public method); anything else is the piece itself.
  const pieceName = (piece: CodePiece, member: string | undefined) =>
    piece.kind === 'class' && member && piece.members?.includes(member) ? `${piece.name}.${member}` : piece.name;
  const endpoint = (t: Exclude<Target, string>): string => {
    const id = owner.get(t.path)!;
    return `${id === component ? '' : `${id}:`}${t.path}#${pieceName(t.piece, t.member)}`;
  };
  // A site's `from` (`piece`, `Class.method` or `Class.constructor`) normalized like a target.
  const fromEndpoint = (mod: ModuleFacts, from: string): string => {
    if (!from) return mod.path;
    const [name, member] = from.split('.', 2);
    const piece = mod.pieces.find((p) => p.name === name);
    return `${mod.path}#${piece ? pieceName(piece, member) : name}`;
  };

  for (const path of [...owned].sort(byString)) {
    const mod = facts.get(path);
    if (!mod) continue;
    parseErrors += mod.parseErrors;
    modules.push({ path, pieces: [...mod.pieces].sort((a, b) => byString(a.name, b.name)) });
    for (const site of mod.sites) {
      const target = resolveSite(path, site);
      if (target === 'internal') continue;
      if (typeof target === 'string') {
        unresolved[target]++;
        continue;
      }
      const from = fromEndpoint(mod, site.from);
      const to = endpoint(target);
      if (from === to) continue;
      const key = `${from}\0${to}\0${site.kind}`;
      const edge = edges.get(key);
      if (edge) edge.count++;
      else edges.set(key, { from, to, kind: site.kind, count: 1 });
    }
  }

  const sorted = [...edges.values()].sort((a, b) => byString(a.from, b.from) || byString(a.to, b.to) || byString(a.kind, b.kind));
  return { graph: { component, modules, edges: sorted, unresolved }, parseErrors };
}
