import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { diffProjects, type Change } from '@zark/core';
import { createPr, defaultBase, discard, projectAtRef, prPreview, status } from './git.js';
import { readHash, renderHash, renderStatus, type RenderStatus, type RenderTarget } from './render-hash.js';
import { cacheDir, Renderer, renderedDir, type RenderOutput, type SharedBrowser } from './render.js';
import { ProjectStore } from './store.js';

/**
 * Everything a client (HTTP, MCP, CLI) can ask for. Only the store writes
 * architecture files; only git.ts talks to git and gh.
 */
export class ZarkService {
  readonly renderer: Renderer;
  private alwaysTimer?: NodeJS.Timeout;
  private statusTimer?: NodeJS.Timeout;

  constructor(readonly store: ProjectStore, baseUrl: () => string, readonly token: string, opts: { browser?: SharedBrowser } = {}) {
    this.renderer = new Renderer(baseUrl, token, opts.browser);
  }

  get dir() {
    return this.store.dir;
  }
  get project() {
    return this.store.project;
  }

  /** In `always` mode every save re-renders the drawings it touched, debounced 2 s. */
  enableAutoRender() {
    this.store.on('model.changed', () => {
      if (this.project.config.render.commit !== 'always') return;
      clearTimeout(this.alwaysTimer);
    clearTimeout(this.statusTimer);
      this.alwaysTimer = setTimeout(() => void this.renderAll(true).catch((e) => console.error(`render: ${e.message}`)), 2000);
    });
  }

  renderStatus(): Promise<RenderStatus> {
    return renderStatus(this.project);
  }

  /** Recomputes render status after model changes (debounced) and broadcasts `render.status`. */
  enableRenderStatus() {
    const emit = () => void this.renderStatus().then((s) => this.store.emit('render.status', s), () => undefined);
    this.store.on('model.changed', () => {
      clearTimeout(this.statusTimer);
      this.statusTimer = setTimeout(emit, 300);
    });
  }

  /** Re-renders every stale committed PNG into rendered/ and broadcasts the new status. */
  async renderStale() {
    const { stale } = await this.renderStatus();
    const written: string[] = [];
    for (const item of stale) {
      const out = await this.render(item.target, true);
      written.push(`rendered/${out.file}`);
    }
    const status = await this.renderStatus();
    this.store.emit('render.status', status);
    return { written, status };
  }

  /**
   * Renders one target. PNGs meant for the repo go to rendered/; previews go
   * to .zark/cache (mode `pr`), outside git.
   */
  async render(target: RenderTarget, forCommit = this.project.config.render.commit === 'always'): Promise<RenderOutput> {
    const p = this.project;
    if (target.flow && !p.flows.has(target.flow)) throw new Error(`Flow "${target.flow}" does not exist`);
    if (target.drawing && !p.drawings.has(target.drawing)) throw new Error(`Drawing "${target.drawing}" does not exist`);
    if (!target.flow && !target.drawing) throw new Error('Pass drawing or flow');
    const out = await this.renderer.renderTo(p, target, forCommit ? renderedDir(this.dir) : cacheDir(this.dir));
    this.store.emit('render.done', { target, path: out.path, hash: out.hash });
    if (forCommit) await this.store.refreshProblems();
    return out;
  }

  async renderPng(target: RenderTarget): Promise<Buffer> {
    const out = await this.render(target);
    return readFile(out.path);
  }

  /** Renders the given drawings (default: all) into rendered/. */
  async renderAll(forCommit: boolean, ids?: string[]) {
    const results: RenderOutput[] = [];
    for (const id of ids?.length ? ids : [...this.project.drawings.keys()]) results.push(await this.render({ drawing: id }, forCommit));
    return results;
  }

  /** IDs of drawings whose committed PNG in rendered/ is stale or missing. */
  async staleRendered(ids?: string[]) {
    const stale: string[] = [];
    for (const id of ids?.length ? ids : [...this.project.drawings.keys()]) {
      const png = await readFile(join(renderedDir(this.dir), `${id}.png`)).catch(() => undefined);
      if (!png || readHash(png) !== renderHash(this.project, { drawing: id })) stale.push(id);
    }
    return stale;
  }

  async diff(base?: string): Promise<{ base: string; changes: Change[] }> {
    const ref = base || (await defaultBase(this.dir, this.project.config.git.baseBranch));
    const before = await projectAtRef(this.dir, ref);
    return { base: ref, changes: diffProjects(before, this.project) };
  }

  gitStatus() {
    return status(this.dir, this.project.config.git.baseBranch, true, this.project.config.git.provider);
  }

  async discard(files: string[]) {
    await discard(this.dir, files);
  }

  prPreview(opts: { title?: string; context?: string } = {}) {
    return prPreview(this.dir, this.project, this.store.problems, opts);
  }

  async createPr(opts: { title?: string; context?: string } = {}) {
    const result = await createPr(this.dir, this.project, this.store.problems, {
      ...opts,
      render: async (drawings) => {
        await this.renderAll(true, drawings);
      },
    });
    this.store.emit('git.changed', await this.gitStatus().catch(() => undefined));
    return result;
  }

  async close() {
    clearTimeout(this.alwaysTimer);
    await this.renderer.close();
    await this.store.close();
  }
}
