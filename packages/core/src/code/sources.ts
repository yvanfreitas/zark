import { existsSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { dirname, join, posix, relative, sep } from 'node:path';
import { lineOf, type Project } from '../project.js';
import { PROBLEM_EN, type Params } from '../messages.js';
import type { Problem } from '../validate.js';

export const DEFAULT_EXCLUDE = ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**', '**/*.d.ts', '**/generated/**'];
const EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs)$/;

/** Nearest ancestor of `dir` that holds a `.git`, else the parent of `dir`. */
export function repoRootOf(dir: string): string {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return d;
    if (dirname(d) === d) return dirname(dir);
  }
}

const posixPath = (p: string) => p.replaceAll(sep, '/');

/** Repo-relative posix paths of every file an entry matches (folders expand to everything below). */
async function filesMatching(repoRoot: string, entry: string): Promise<string[] | undefined> {
  const out: string[] = [];
  let matched = false;
  for await (const hit of glob(entry, { cwd: repoRoot, withFileTypes: true })) {
    matched = true;
    if (hit.isDirectory()) {
      for await (const inner of glob('**/*', { cwd: join(hit.parentPath, hit.name), withFileTypes: true })) {
        if (inner.isFile()) out.push(posixPath(relative(repoRoot, join(inner.parentPath, inner.name))));
      }
    } else if (hit.isFile()) out.push(posixPath(relative(repoRoot, join(hit.parentPath, hit.name))));
  }
  return matched ? out : undefined;
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
    const entries = typeof entity.source === 'string' ? [entity.source] : entity.source;
    for (const [i, entry] of entries.entries()) {
      const files = await filesMatching(repoRoot, entry);
      if (!files) {
        problem('E014', 'E014', { id, source: entry }, id, typeof entity.source === 'string' ? ['source'] : ['source', i]);
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
