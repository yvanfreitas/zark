// `zark scan`: generates `code/<component>.yaml` for every component with `source` (spec sections
// 3-5). Reads the filesystem; the graph itself is built by the pure `buildGraph`.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadProject, type Project } from '../project.js';
import type { CodeGraph } from '../schema.js';
import type { Problem } from '../validate.js';
import { createDoc, removeFile, toText, writeAtomic } from '../writer.js';
import { extractModule, loadParser, type ModuleFacts } from './extract.js';
import { buildGraph } from './graph.js';
import { loadAliases, resolveSpecifier } from './resolve.js';
import { claimFiles, DEFAULT_EXCLUDE, listSourceFiles, repoRootOf, sourceEntries } from './sources.js';

export type ScanStatus = 'written' | 'unchanged' | 'stale' | 'deleted';
export type ScanComponent = {
  id: string;
  /** Path of the generated file, relative to the architecture dir. */
  file: string;
  status: ScanStatus;
  modules: number;
  pieces: number;
  edges: number;
  unresolved: CodeGraph['unresolved'];
  parseErrors: number;
};
/** `warnings`: non-blocking notes for the scan summary (e.g. an explicit `code.tsconfig` that cannot be read). */
export type ScanResult = { components: ScanComponent[]; problems: Problem[]; warnings: string[] };

/** Source text, or undefined when unreadable (a parse error, never an aborted scan). */
const readSource = (repoRoot: string, path: string) => readFile(join(repoRoot, path), 'utf8').catch(() => undefined);

/** Unreadable or unparsable source never aborts a scan: it counts as a parse error. */
function parseModule(path: string, text: string | undefined): ModuleFacts {
  try {
    if (text === undefined) throw new Error('unreadable');
    return extractModule(path, text);
  } catch {
    return { path, pieces: [], imports: [], reexports: [], sites: [], locals: new Map(), parseErrors: 1 };
  }
}

/**
 * Scans the components with `source` (or those in `only`), writing their graphs and deleting the
 * graphs of components that no longer have `source`. With `check`, nothing is written: a file that
 * differs, is missing or would be deleted is `stale`. Pass `project` when the caller already loaded
 * it from `dir`, so the (possibly large) generated files are not parsed twice.
 */
export async function scanProject(dir: string, opts: { check?: boolean; only?: string[]; project?: Project } = {}): Promise<ScanResult> {
  dir = resolve(dir);
  const project = opts.project ?? (await loadProject(dir));
  // Opt-in: without `source` (and no leftover graphs) a scan touches nothing, not even the parser.
  const anySource = [...project.entities.values()].some(({ entity }) => entity.kind === 'component' && entity.source);
  if (!anySource && !project.codeGraphs.size) return { components: [], problems: [], warnings: [] };
  if (anySource) await loadParser();
  const repoRoot = repoRootOf(dir);
  const { owner, problems } = await claimFiles(repoRoot, project);
  const warnings: string[] = [];
  const tsconfig = project.config.code?.tsconfig;
  const aliases = await loadAliases(repoRoot, tsconfig ?? 'tsconfig.json', tsconfig ? (file, reason) => warnings.push(`code.tsconfig: ${file} is ${reason}; path aliases are not resolved`) : undefined);
  const files = new Set(await listSourceFiles(repoRoot, project.config.code?.exclude ?? DEFAULT_EXCLUDE));

  const sourced = new Map<string, string[]>();
  for (const [id, { entity }] of project.entities) {
    if (entity.kind === 'component' && entity.source) sourced.set(id, sourceEntries(entity.source));
  }
  for (const id of opts.only ?? []) {
    if (!sourced.has(id) && !project.codeGraphs.has(id)) throw new Error(`Cannot scan "${id}": it is not a component with \`source\` and has no generated file.`);
  }
  const wanted = (id: string) => !opts.only || opts.only.includes(id);
  const scanned = [...sourced.keys()].filter(wanted);
  const scannedIds = new Set(scanned);

  // Parse the scanned components' files, then the files of other components they import, following
  // re-exports so a barrel's target piece can be confirmed. Unclaimed files are never parsed.
  const facts = new Map<string, ModuleFacts>();
  const queue = [...owner].filter(([, id]) => scannedIds.has(id)).map(([file]) => file);
  // The scanned files are all parsed, so read them concurrently up front; imported ones follow lazily.
  const prefetched = new Map(await Promise.all(queue.map(async (path) => [path, await readSource(repoRoot, path)] as const)));
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i];
    if (facts.has(path)) continue;
    const mod = parseModule(path, prefetched.has(path) ? prefetched.get(path) : await readSource(repoRoot, path));
    facts.set(path, mod);
    const specs = [...(scannedIds.has(owner.get(path)!) ? mod.imports.map((x) => x.from) : []), ...mod.reexports.map((x) => x.from)];
    for (const spec of specs) {
      const target = resolveSpecifier(path, spec, files, aliases);
      if (target !== 'external' && owner.has(target) && !facts.has(target)) queue.push(target);
    }
  }

  const components: ScanComponent[] = [];
  for (const id of scanned) {
    const owned = [...owner].filter(([, o]) => o === id).map(([file]) => file);
    const { graph, parseErrors } = buildGraph(id, owned, facts, owner, aliases, files);
    const doc = createDoc('code', graph);
    doc.commentBefore = ` Generated by \`zark scan\` from ${sourced.get(id)!.join(', ')}. Do not edit.\n${doc.commentBefore ?? ''}`;
    const text = toText(doc);
    const file = `code/${id}.yaml`;
    // The loaded project already holds the file's text; read it only when it is not there.
    const current = project.files.get(file)?.text ?? (await readFile(join(dir, file), 'utf8').catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return undefined; // not generated yet
      throw err;
    }));
    const status: ScanStatus = current === text ? 'unchanged' : opts.check ? 'stale' : 'written';
    if (status === 'written') await writeAtomic(join(dir, file), text);
    const pieces = graph.modules.reduce((n, m) => n + m.pieces.length, 0);
    components.push({ id, file, status, modules: graph.modules.length, pieces, edges: graph.edges.length, unresolved: graph.unresolved, parseErrors });
  }

  for (const [id, { file }] of project.codeGraphs) {
    if (sourced.has(id) || !wanted(id)) continue;
    if (!opts.check) await removeFile(join(dir, file));
    const none = { calls: 0, external: 0, unowned: 0 };
    components.push({ id, file, status: opts.check ? 'stale' : 'deleted', modules: 0, pieces: 0, edges: 0, unresolved: none, parseErrors: 0 });
  }
  components.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { components, problems, warnings };
}
