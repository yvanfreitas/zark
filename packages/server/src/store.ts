import { EventEmitter } from 'node:events';
import { watch, type FSWatcher } from 'chokidar';
import {
  usedIcons,
  applyOps,
  buildProject,
  diffProjects,
  hashText,
  readTexts,
  validate,
  writeResult,
  type ApplyOptions,
  type Change,
  type ApplyResult,
  type Op,
  type Problem,
  type Project,
} from '@zark/core';
import { renderedProblems } from './render-hash.js';

export type Origin = 'ui' | 'mcp' | 'external' | 'cli';

export interface ChangeItem {
  key: string;
  params: Change['params'];
  text: string;
}

const changePayload = (changes: Change[]) => ({
  changes: changes.map((c) => c.text),
  items: changes.map(({ key, params, text }) => ({ key, params, text })),
});

export interface ModelChanged {
  files: string[];
  hashes: Record<string, string | null>;
  origin: Origin;
  /** English texts; `items` carries key + params so UIs can localize. */
  changes: string[];
  items: ChangeItem[];
}

interface HistoryItem {
  before: Map<string, string | null>;
  after: Map<string, string | null>;
}

/**
 * Single owner of the project files for one process. Every write goes
 * through `apply`, which validates in memory before touching disk.
 */
export class ProjectStore extends EventEmitter {
  project!: Project;
  problems: Problem[] = [];
  private watcher?: FSWatcher;
  private undoStack: HistoryItem[] = [];
  private redoStack: HistoryItem[] = [];
  /** Hashes we just wrote, so the watcher can tell our writes from external ones. */
  private ownWrites = new Map<string, string | null>();
  private queue: Promise<unknown> = Promise.resolve();
  private reloadTimer?: NodeJS.Timeout;

  constructor(readonly dir: string) {
    super();
  }

  async load() {
    this.project = buildProject(this.dir, await readTexts(this.dir));
    this.problems = await this.computeProblems(this.project);
    return this;
  }

  private async computeProblems(project: Project) {
    return validate(project, await renderedProblems(project));
  }

  /** Serializes writes so two clients never interleave a read-validate-write cycle. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  apply(ops: Op[], origin: Origin, options: ApplyOptions & { dryRun?: boolean } = {}): Promise<ApplyResult> {
    return this.exclusive(async () => {
      const result = await applyOps(this.project, ops, options);
      if (!result.ok || options.dryRun || !result.files.size) return result;
      const before = new Map([...result.files.keys()].map((p) => [p, this.project.files.get(p)?.text ?? null]));
      await this.commit(result.files, result.project, origin, result.changes);
      this.undoStack.push({ before, after: result.files });
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
      result.problems = this.problems;
      return result;
    });
  }

  private async commit(files: Map<string, string | null>, project: Project, origin: Origin, changes: Change[]) {
    for (const [path, text] of files) this.ownWrites.set(path, text === null ? null : hashText(text));
    await writeResult(this.dir, files);
    this.project = project;
    const oldProblems = JSON.stringify(this.problems);
    this.problems = await this.computeProblems(project);
    const hashes = Object.fromEntries([...files].map(([p, t]) => [p, t === null ? null : hashText(t)]));
    this.emit('model.changed', { files: [...files.keys()], hashes, origin, ...changePayload(changes) } satisfies ModelChanged);
    if (JSON.stringify(this.problems) !== oldProblems) this.emit('problems.changed', this.problems);
  }

  undo(origin: Origin = 'ui') {
    return this.history(this.undoStack, this.redoStack, 'before', origin);
  }
  redo(origin: Origin = 'ui') {
    return this.history(this.redoStack, this.undoStack, 'after', origin);
  }

  private history(from: HistoryItem[], to: HistoryItem[], side: 'before' | 'after', origin: Origin) {
    return this.exclusive(async () => {
      const item = from.pop();
      if (!item) return { ok: false as const, error: 'Nothing to undo' };
      const expected = side === 'before' ? item.after : item.before;
      // Only undo when files still match what the operation produced.
      for (const [path, text] of expected) {
        if ((this.project.files.get(path)?.text ?? null) !== text) {
          from.length = 0;
          return { ok: false as const, error: `${path} changed outside this session; history discarded` };
        }
      }
      const target = item[side];
      const texts = new Map([...this.project.files].map(([p, f]) => [p, f.text]));
      for (const [path, text] of target) text === null ? texts.delete(path) : texts.set(path, text);
      const project = buildProject(this.dir, texts);
      await this.commit(target, project, origin, diffProjects(this.project, project));
      to.push(item);
      return { ok: true as const };
    });
  }

  /** Watches the architecture dir and reloads on changes made by anyone else. */
  watch() {
    this.watcher = watch(this.dir, {
      ignoreInitial: true,
      ignored: (path) => /[\\/](\.zark|rendered|node_modules|\.git)([\\/]|$)/.test(path) || /\.tmp$/.test(path),
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
    });
    const onChange = () => {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => void this.reloadExternal(), 60);
    };
    this.watcher.on('all', onChange);
    return this;
  }

  private reloadExternal() {
    return this.exclusive(async () => {
      const texts = await readTexts(this.dir);
      const changed = new Map<string, string | null>();
      for (const [path, text] of texts) if (this.project.files.get(path)?.text !== text) changed.set(path, text);
      for (const path of this.project.files.keys()) if (!texts.has(path)) changed.set(path, null);
      const external = [...changed].filter(([p, t]) => this.ownWrites.get(p) !== (t === null ? null : hashText(t)));
      for (const p of changed.keys()) this.ownWrites.delete(p);
      if (!external.length) return;
      const project = buildProject(this.dir, texts);
      const changes = diffProjects(this.project, project);
      this.project = project;
      const oldProblems = JSON.stringify(this.problems);
      this.problems = await this.computeProblems(project);
      this.emit('model.changed', {
        files: external.map(([p]) => p),
        hashes: Object.fromEntries(external.map(([p, t]) => [p, t === null ? null : hashText(t)])),
        origin: 'external',
        ...changePayload(changes),
      } satisfies ModelChanged);
      if (JSON.stringify(this.problems) !== oldProblems) this.emit('problems.changed', this.problems);
    });
  }

  async close() {
    await this.watcher?.close();
  }

  /** Recomputes problems (e.g. after a render updates PNG hashes). */
  async refreshProblems() {
    const old = JSON.stringify(this.problems);
    this.problems = await this.computeProblems(this.project);
    if (JSON.stringify(this.problems) !== old) this.emit('problems.changed', this.problems);
  }

  /** JSON snapshot for clients: data, per-file hashes and problems. */
  snapshot() {
    const p = this.project;
    return {
      root: this.dir,
      config: p.config,
      catalog: p.catalog,
      entities: [...p.entities.values()].map(({ entity, file }) => ({ ...entity, file })),
      drawings: [...p.drawings.values()].map(({ drawing, file }) => ({ ...drawing, file })),
      flows: [...p.flows.values()].map(({ flow, file }) => ({ ...flow, file })),
      files: Object.fromEntries([...p.files.values()].map((f) => [f.path, { hash: f.hash, kind: f.kind, error: f.error }])),
      problems: this.problems,
      // SVGs of the icons in use, so boxes, the render route and the static site need no fetch.
      icons: usedIcons(p),
      codeGraphs: [...p.codeGraphs.values()].map(({ graph }) => graph).sort((a, b) => (a.component < b.component ? -1 : a.component > b.component ? 1 : 0)),
    };
  }
}
