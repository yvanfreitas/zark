// Import resolution without a type checker (spec section 3, rule 1): relative and tsconfig-alias
// specifiers resolve to a repo file in `files`; everything else (bare and workspace packages, or a
// local-looking specifier that matches no file) is 'external'. Never guesses.
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path';
import type { ModuleFacts } from './extract.js';

export type Aliases = { baseUrl?: string; paths: [pattern: string, targets: string[]][] };

const EXTS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs'];
const toPosix = (p: string) => p.replaceAll(sep, '/');

/** JSON with comments and trailing commas (tsconfig flavour); string literals are left untouched. */
function parseJsonc(text: string): any {
  const stripped = text.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_m, str) => str ?? '');
  const noTrailing = stripped.replace(/("(?:[^"\\]|\\.)*")|,(\s*[}\]])/g, (_m, str, close) => str ?? close);
  return JSON.parse(noTrailing);
}

/** Reads tsconfig `baseUrl`/`paths` (following relative `extends`) as repo-relative posix paths. */
export async function loadAliases(repoRoot: string, tsconfigPath = 'tsconfig.json'): Promise<Aliases> {
  const start = isAbsolute(tsconfigPath) ? tsconfigPath : join(repoRoot, tsconfigPath);
  const repoRel = (abs: string) => toPosix(relative(repoRoot, abs)) || '.';

  async function load(file: string, seen: Set<string>): Promise<Aliases> {
    if (seen.has(file)) return { paths: [] };
    seen.add(file);
    let json: any;
    try {
      json = parseJsonc(await readFile(file, 'utf8'));
    } catch {
      return { paths: [] }; // missing or unparsable config: no aliases
    }
    const dir = dirname(file);
    let inherited: Aliases = { paths: [] };
    const ext = json.extends;
    for (const e of Array.isArray(ext) ? ext : ext ? [ext] : []) {
      if (typeof e !== 'string' || !e.startsWith('.')) continue; // package-name extends is ignored
      const target = join(dir, e);
      const parent = await load(target.endsWith('.json') ? target : `${target}.json`, seen);
      inherited = { baseUrl: parent.baseUrl ?? inherited.baseUrl, paths: parent.paths.length ? parent.paths : inherited.paths };
    }
    const opts = json.compilerOptions ?? {};
    const baseUrl = typeof opts.baseUrl === 'string' ? repoRel(join(dir, opts.baseUrl)) : inherited.baseUrl;
    let paths = inherited.paths;
    if (opts.paths && typeof opts.paths === 'object') {
      // Targets are relative to baseUrl when one is in effect, else to this config's directory.
      const base = baseUrl ?? repoRel(dir);
      paths = Object.entries<string[]>(opts.paths).map(([pattern, targets]) => [
        pattern,
        targets.map((t) => posix.normalize(posix.join(base, t))),
      ]);
    }
    return { ...(baseUrl !== undefined ? { baseUrl } : {}), paths };
  }

  return load(start, new Set());
}

/** First existing candidate: as-is, `.js`-to-`.ts` swap, each extension, then `/index.<ext>`. */
function probe(base: string, files: Set<string>): string | undefined {
  if (files.has(base)) return base;
  const swap = /^(.*)\.(js|jsx|mjs)$/.exec(base);
  if (swap) {
    const alts = swap[2] === 'js' ? ['ts', 'tsx'] : swap[2] === 'jsx' ? ['tsx'] : ['mts'];
    for (const e of alts) if (files.has(`${swap[1]}.${e}`)) return `${swap[1]}.${e}`;
  }
  for (const e of EXTS) if (files.has(`${base}.${e}`)) return `${base}.${e}`;
  for (const e of EXTS) if (files.has(`${base}/index.${e}`)) return `${base}/index.${e}`;
  return undefined;
}

export function resolveSpecifier(fromPath: string, spec: string, files: Set<string>, aliases: Aliases): string | 'external' {
  if (spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') {
    return probe(posix.normalize(posix.join(posix.dirname(fromPath), spec)), files) ?? 'external';
  }
  // TypeScript picks the single best pattern (exact, else longest prefix before `*`) and tries only its targets.
  let best: { targets: string[]; captured: string; prefix: number } | undefined;
  for (const [pattern, targets] of aliases.paths) {
    const star = pattern.indexOf('*');
    if (star < 0) {
      if (pattern === spec) {
        best = { targets, captured: '', prefix: Infinity };
        break;
      }
      continue;
    }
    const head = pattern.slice(0, star);
    const tail = pattern.slice(star + 1);
    if (spec.length >= head.length + tail.length && spec.startsWith(head) && spec.endsWith(tail) && head.length > (best?.prefix ?? -1)) {
      best = { targets, captured: spec.slice(head.length, spec.length - tail.length), prefix: head.length };
    }
  }
  for (const t of best?.targets ?? []) {
    const hit = probe(posix.normalize(t.replace('*', () => best!.captured)), files);
    if (hit) return hit;
  }
  if (aliases.baseUrl !== undefined) {
    const hit = probe(posix.normalize(posix.join(aliases.baseUrl, spec)), files);
    if (hit) return hit;
  }
  return 'external';
}

/**
 * Follows re-exports (named, `export * from`, `export * as ns`) from `path` to the declaring module.
 * `files`/`aliases` resolve the raw re-export specifiers. Cycles and unknown names give `undefined`.
 */
export function resolveExport(
  path: string,
  name: string,
  facts: Map<string, ModuleFacts>,
  files: Set<string> = new Set(facts.keys()),
  aliases: Aliases = { paths: [] },
  visited: Set<string> = new Set(),
): { path: string; name: string } | undefined {
  const key = `${path}\0${name}`;
  if (visited.has(key)) return undefined;
  visited.add(key);
  const mod = facts.get(path);
  if (!mod) return undefined;
  if (mod.pieces.some((p) => p.name === name)) return { path, name };
  const follow = (from: string, imported: string) => {
    const target = resolveSpecifier(path, from, files, aliases);
    if (target === 'external') return undefined;
    return imported === '*' ? { path: target, name: '*' } : resolveExport(target, imported, facts, files, aliases, visited);
  };
  for (const r of mod.reexports) if (r.exported === name) return follow(r.from, r.imported);
  if (name !== 'default') {
    for (const r of mod.reexports) {
      if (r.exported !== '*') continue;
      const target = resolveSpecifier(path, r.from, files, aliases);
      const hit = target === 'external' ? undefined : resolveExport(target, name, facts, files, aliases, visited);
      if (hit) return hit;
    }
  }
  return undefined;
}
