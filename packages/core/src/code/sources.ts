import { existsSync } from 'node:fs';
import { glob, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, sep, win32 } from 'node:path';
import { lineOf, type Project } from '../project.js';
import { PROBLEM_EN, type Params } from '../messages.js';
import type { Problem } from '../validate.js';

export const DEFAULT_EXCLUDE = ['**/*.{test,spec}.*', '**/__tests__/**', '**/*.d.ts', '**/generated/**'];
const EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs)$/;

/** Nearest ancestor of `dir` that holds a `.git`, else the parent of `dir`. */
export function repoRootOf(dir: string): string {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return d;
    if (dirname(d) === d) return dirname(dir);
  }
}

const posixPath = (p: string) => p.replaceAll(sep, '/');

const SKIPPED_DIRS = new Set(['node_modules', '.git']);
const skipped = (e: { name: string }) => SKIPPED_DIRS.has(e.name);

/** Files below `dir`, pruning node_modules and .git during the walk; `seen` dedupes overlapping walks. */
async function walk(repoRoot: string, dir: string, seen: Set<string>, out: Set<string>): Promise<void> {
  if (seen.has(dir)) return;
  seen.add(dir);
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (skipped(e)) continue;
    if (e.isDirectory()) await walk(repoRoot, full, seen, out);
    else if (e.isFile()) out.add(posixPath(relative(repoRoot, full)));
  }
}

/** Every source-language file of the repo (repo-relative posix, sorted), minus `exclude`. */
export async function listSourceFiles(repoRoot: string, exclude: string[]): Promise<string[]> {
  const out = new Set<string>();
  await walk(repoRoot, repoRoot, new Set(), out);
  return [...out].filter((f) => EXTENSIONS.test(f) && !exclude.some((g) => posix.matchesGlob(f, g))).sort();
}

/** A component's `source` entries with `\` normalised to `/` (also what the generated header shows). */
export function sourceEntries(source: string | string[]): string[] {
  return (typeof source === 'string' ? [source] : source).map((e) => e.replaceAll('\\', '/'));
}

/** An entry that could reach outside the repo: absolute (posix or Windows) or with a `..` segment. */
export function escapesRepo(entry: string): boolean {
  return posix.isAbsolute(entry) || win32.isAbsolute(entry) || entry.split('/').includes('..');
}

/** Repo-relative paths are never absolute and never climb out of the root. */
const insideRepo = (rel: string) => !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);

/** Repo-relative posix paths of every file an entry matches (folders expand to everything below). */
async function filesMatching(repoRoot: string, entry: string): Promise<string[] | undefined> {
  const out = new Set<string>();
  const seen = new Set<string>();
  let matched = false;
  for await (const hit of glob(entry, { cwd: repoRoot, withFileTypes: true, exclude: skipped })) {
    const full = join(hit.parentPath, hit.name);
    // Second line of defence after `escapesRepo` (e.g. a symlinked folder pointing elsewhere).
    if (!insideRepo(relative(repoRoot, full))) continue;
    matched = true;
    if (hit.isDirectory()) await walk(repoRoot, full, seen, out);
    else if (hit.isFile()) out.add(posixPath(relative(repoRoot, full)));
  }
  return matched ? [...out] : undefined;
}

/**
 * Assigns each source file to the component with the most specific `source` entry
 * (length of the entry). Touches the filesystem, so it runs in `zark validate` and
 * `zark scan` only, never inside `validate()`.
 */
export async function claimFiles(repoRoot: string, project: Project): Promise<{ owner: Map<string, string>; problems: Problem[] }> {
  const problems: Problem[] = [];
  const problem = (code: string, key: string, params: Params, id: string, sourcePath: (string | number)[]) => {
    const path = project.entities.get(id)!.file;
    const file = project.files.get(path);
    problems.push({ code, severity: code[0] === 'E' ? 'error' : 'warning', file: path, line: file ? lineOf(file, sourcePath) : undefined, message: PROBLEM_EN[key](params), key, params, ref: id });
  };
  const exclude = project.config.code?.exclude ?? DEFAULT_EXCLUDE;
  // file -> best specificity so far and the components holding it
  const best = new Map<string, { len: number; ids: Set<string> }>();

  for (const [id, { entity }] of project.entities) {
    if (entity.kind !== 'component' || !entity.source) continue;
    for (const [i, entry] of sourceEntries(entity.source).entries()) {
      const at = typeof entity.source === 'string' ? ['source'] : ['source', i];
      if (escapesRepo(entry)) {
        problem('E014', 'E014.outside', { id, source: entry }, id, at);
        continue;
      }
      const files = await filesMatching(repoRoot, entry);
      if (!files) {
        problem('E014', 'E014', { id, source: entry }, id, at);
        continue;
      }
      for (const file of files) {
        if (!EXTENSIONS.test(file) || exclude.some((g) => posix.matchesGlob(file, g))) continue;
        const cur = best.get(file);
        if (!cur || entry.length > cur.len) best.set(file, { len: entry.length, ids: new Set([id]) });
        else if (entry.length === cur.len) cur.ids.add(id);
      }
    }
  }

  const owner = new Map<string, string>();
  for (const file of [...best.keys()].sort()) {
    const { ids } = best.get(file)!;
    if (ids.size === 1) owner.set(file, [...ids][0]);
    else {
      const [first, ...rest] = [...ids].sort();
      problem('E015', 'E015', { file, components: [first, ...rest] }, first, ['source']);
    }
  }
  return { owner, problems };
}
