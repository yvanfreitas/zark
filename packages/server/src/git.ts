import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import {
  buildProject,
  diffProjects,
  errorsOf,
  fileKind,
  warningsOf,
  type Change,
  type Project,
  type Problem,
} from '@zark/core';
import { renderHash } from './render-hash.js';
import { providerFor, type PrProvider } from './providers.js';

const exec = promisify(execFile);

export class GitError extends Error {}

async function run(cmd: string, args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await exec(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    return stdout.trimEnd();
  } catch (err: any) {
    const detail = String(err.stderr || err.message).trim().split('\n')[0];
    throw new GitError(`${cmd} ${args[0]}: ${detail}`);
  }
}
const git = (dir: string, ...args: string[]) => run('git', args, dir);
/**
 * The GitHub CLI. `ZARK_GH` (JSON array, e.g. ["node","fake-gh.mjs"]) swaps it
 * for another executable; used by the end-to-end PR test.
 */
const tryRun = (p: Promise<string>) => p.catch(() => undefined);

export async function repoInfo(dir: string) {
  const root = await git(dir, 'rev-parse', '--show-toplevel');
  const prefix = relative(root, dir).split('\\').join('/');
  return { root, prefix };
}

/** Reads every architecture file as it is at `ref`. */
export async function readTextsAtRef(dir: string, ref: string): Promise<Map<string, string>> {
  const { root, prefix } = await repoInfo(dir);
  const listing = await tryRun(git(root, 'ls-tree', '-r', '--name-only', ref, '--', prefix || '.'));
  const texts = new Map<string, string>();
  for (const full of (listing ?? '').split('\n').filter(Boolean)) {
    const path = prefix ? full.slice(prefix.length + 1) : full;
    if (!fileKind(path)) continue;
    texts.set(path, await git(root, 'show', `${ref}:${full}`));
  }
  return texts;
}

export async function projectAtRef(dir: string, ref: string): Promise<Project> {
  return buildProject(dir, await readTextsAtRef(dir, ref));
}

export async function defaultBase(dir: string, baseBranch: string): Promise<string> {
  const remote = `origin/${baseBranch}`;
  if (await tryRun(git(dir, 'rev-parse', '--verify', '--quiet', remote))) return remote;
  return baseBranch;
}

export interface GitStatus {
  isRepo: boolean;
  branch?: string;
  baseBranch: string;
  changed: { path: string; status: string }[];
  remote?: string;
  behind?: number;
  pr?: { url: string; number: number; state: string };
  /** Hosting provider in use (from zark.yaml or the remote host). */
  provider: { name: 'github' | 'gitlab'; noun: 'PR' | 'MR' };
}

export async function status(dir: string, baseBranch: string, withPr = true, configured?: 'github' | 'gitlab'): Promise<GitStatus> {
  const info = await repoInfo(dir).catch(() => undefined);
  if (!info) {
    const p = providerFor(undefined, configured);
    return { isRepo: false, baseBranch, changed: [], provider: { name: p.name, noun: p.noun } };
  }
  const branch = await git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').catch(() => 'HEAD');
  const porcelain = await git(info.root, 'status', '--porcelain', '-uall', '--', info.prefix || '.');
  const changed = porcelain
    .split('\n')
    .filter(Boolean)
    .map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3).replace(/^"|"$/g, '') }))
    .map((c) => ({ ...c, path: info.prefix ? c.path.slice(info.prefix.length + 1) : c.path }));
  const remote = await tryRun(git(dir, 'remote', 'get-url', 'origin'));
  const behindText = await tryRun(git(dir, 'rev-list', '--count', 'HEAD..@{u}'));
  const provider = providerFor(remote, configured);
  let pr: GitStatus['pr'];
  if (withPr && remote && branch !== baseBranch) pr = await provider.findOpenPr(dir, branch).catch(() => undefined);
  return { isRepo: true, branch, baseBranch, changed, remote, behind: behindText ? Number(behindText) : undefined, pr, provider: { name: provider.name, noun: provider.noun } };
}

/** Restores files to HEAD (`git checkout -- <arquivo>`); untracked files are removed. */
export async function discard(dir: string, files: string[]) {
  const { root, prefix } = await repoInfo(dir);
  for (const file of files) {
    if (file.includes('..')) throw new GitError(`Caminho inválido: ${file}`);
    const full = prefix ? `${prefix}/${file}` : file;
    const tracked = await tryRun(git(root, 'ls-files', '--error-unmatch', '--', full));
    if (tracked !== undefined) await git(root, 'checkout', 'HEAD', '--', full);
    else await rm(join(dir, file), { force: true });
  }
}

// ---------- PR text ----------

const slugify = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'arquitetura';

const count = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);
const joinPt = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`);

/** Title from the semantic diff, by template, no LLM (section 13). */
export function prTitle(changes: Change[], after: Project, before: Project): string {
  if (!changes.length) return 'Arquitetura: sem mudanças no modelo';
  if (changes.length === 1) return changes[0].text;
  const of = (t: Change['type']) => changes.filter((c) => c.type === t);
  const entityName = (id: string) => after.entities.get(id)?.entity.name ?? before.entities.get(id)?.entity.name ?? id;
  const drawingName = (id: string) => after.drawings.get(id)?.drawing.name ?? before.drawings.get(id)?.drawing.name ?? id;
  const flowName = (id: string) => after.flows.get(id)?.flow.name ?? before.flows.get(id)?.flow.name ?? id;
  const names = (list: Change[], name: (id: string) => string, many: string) => (list.length <= 2 ? list.map((c) => name(c.ref)) : [`${list.length} ${many}`]);

  const adds = [
    ...names(of('entity.added'), entityName, 'entidades'),
    ...(of('connection.added').length ? [count(of('connection.added').length, 'uma conexão', 'conexões')] : []),
    ...names(of('flow.added'), flowName, 'fluxos'),
    ...names(of('drawing.added'), drawingName, 'desenhos'),
  ];
  const removes = [
    ...names(of('entity.removed'), entityName, 'entidades'),
    ...(of('connection.removed').length ? [count(of('connection.removed').length, 'uma conexão', 'conexões')] : []),
    ...names(of('flow.removed'), flowName, 'fluxos'),
    ...names(of('drawing.removed'), drawingName, 'desenhos'),
  ];
  const edits = [...new Set([
    ...[...of('entity.changed'), ...of('entity.moved')].map((c) => entityName(c.ref)),
    ...(of('connection.changed').length + of('connection.reversed').length ? [count(of('connection.changed').length + of('connection.reversed').length, 'uma conexão', 'conexões')] : []),
    ...of('flow.steps').map((c) => flowName(c.ref)),
  ])];
  const tweaks = [...new Set([...of('drawing.content'), ...of('drawing.layout')].map((c) => drawingName(c.ref)))];
  const parts = [
    adds.length && `adiciona ${joinPt(adds)}`,
    removes.length && `remove ${joinPt(removes)}`,
    edits.length && `altera ${joinPt(edits)}`,
    tweaks.length && `ajusta ${joinPt(tweaks)}`,
  ].filter(Boolean);
  return `Arquitetura: ${parts.join(', ')}`;
}

export interface PrImage {
  drawing: string;
  name: string;
  path: string;
  /** False when the drawing is new or had no committed PNG at the base. */
  hasBefore: boolean;
}

export function prBody(opts: {
  context?: string;
  changes: Change[];
  images: PrImage[];
  imageUrl?: (path: string, side: 'before' | 'after') => string;
  flows: Change[];
  problems: Problem[];
}): string {
  const lines: string[] = [];
  if (opts.context?.trim()) lines.push(opts.context.trim(), '');
  lines.push('## Resumo');
  const summary = opts.changes.filter((c) => c.type !== 'flow.steps');
  lines.push(...(summary.length ? summary.map((c) => `- ${c.text}`) : ['- Sem mudanças no modelo']));
  if (opts.images.length) {
    lines.push('', '## Desenhos');
    for (const img of opts.images) {
      const url = opts.imageUrl ?? ((p: string, side: string) => `<${side === 'before' ? 'PNG na base' : 'PNG no commit'}: ${p}>`);
      lines.push(`### ${img.name}`);
      if (img.hasBefore) lines.push('| Antes | Depois |', '| --- | --- |', `| ![antes](${url(img.path, 'before')}) | ![depois](${url(img.path, 'after')}) |`);
      else lines.push(`![${img.name}](${url(img.path, 'after')})`);
    }
  }
  if (opts.flows.length) lines.push('', '## Fluxos afetados', ...opts.flows.map((c) => `- ${c.text}`));
  const errors = errorsOf(opts.problems).length;
  const warnings = warningsOf(opts.problems);
  const byCode = Object.entries(warnings.reduce<Record<string, number>>((acc, p) => ((acc[p.code] = (acc[p.code] ?? 0) + 1), acc), {}));
  lines.push('', '## Validação', `${errors} erros, ${warnings.length} avisos${byCode.length ? ` (${byCode.map(([c, n]) => `${c} x${n}`).join(', ')})` : ''}`);
  return lines.join('\n') + '\n';
}

export interface PrPreview {
  ok: boolean;
  blockers: string[];
  branch: string;
  base: string;
  title: string;
  body: string;
  changes: Change[];
  files: string[];
  images: PrImage[];
  existingPr?: GitStatus['pr'];
  provider: GitStatus['provider'];
}

export async function prPreview(dir: string, project: Project, problems: Problem[], opts: { title?: string; context?: string } = {}): Promise<PrPreview> {
  const blockers: string[] = [];
  const st = await status(dir, project.config.git.baseBranch, true, project.config.git.provider);
  const provider = providerFor(st.remote, project.config.git.provider);
  if (!st.isRepo) blockers.push('A pasta não está num repositório git. Rode "git init" e configure um remoto');
  if (st.isRepo && !st.remote) blockers.push('Nenhum remoto "origin" configurado. Rode "git remote add origin <url>"');
  const errors = errorsOf(problems);
  if (errors.length) blockers.push(`A validação tem ${errors.length} erro(s). Corrija antes de abrir o ${provider.noun} (painel Problemas ou "zark validate")`);
  if (!(await provider.authOk(dir))) blockers.push(`O ${provider.cli} não está autenticado. Rode "${provider.cli} auth login" no terminal`);

  const base = st.isRepo ? await defaultBase(dir, project.config.git.baseBranch) : project.config.git.baseBranch;
  const before = st.isRepo ? await projectAtRef(dir, base).catch(() => buildProject(dir, new Map())) : buildProject(dir, new Map());
  const changes = diffProjects(before, project);
  const title = opts.title?.trim() || prTitle(changes, project, before);
  const onBase = st.branch === project.config.git.baseBranch || st.branch === 'HEAD';
  const branch = onBase ? `${project.config.git.branchPrefix}${slugify(title.replace(/^Arquitetura:\s*/, ''))}` : st.branch!;
  const images = await changedImages(dir, project, before, base);
  if (!changes.length && !st.changed.length) blockers.push(`Nenhuma alteração em architecture/ para abrir ${provider.noun}`);
  const body = prBody({ context: opts.context, changes, images, flows: changes.filter((c) => c.type.startsWith('flow.')), problems });
  return { ok: !blockers.length, blockers, branch, base, title, body, changes, files: st.changed.map((c) => c.path), images, existingPr: st.pr, provider: st.provider };
}

/** Drawings whose picture differs from the base. */
async function changedImages(dir: string, project: Project, before: Project, base: string): Promise<PrImage[]> {
  if (project.config.render.commit === 'never') return [];
  const { root, prefix } = await repoInfo(dir).catch(() => ({ root: dir, prefix: '' }));
  const out: PrImage[] = [];
  for (const [id, { drawing }] of project.drawings) {
    const existed = before.drawings.has(id);
    if (existed && renderHash(before, { drawing: id }) === renderHash(project, { drawing: id })) continue;
    const path = `rendered/${id}.png`;
    const full = prefix ? `${prefix}/${path}` : path;
    const hasBefore = existed && (await tryRun(git(root, 'cat-file', '-e', `${base}:${full}`))) !== undefined;
    out.push({ drawing: id, name: drawing.name, path, hasBefore });
  }
  return out;
}

export interface PrResult {
  url: string;
  branch: string;
  commit: string;
  updated: boolean;
}

/**
 * Branch, render, commit (architecture/ only), push (never --force) and
 * open or update the PR/MR through the provider (gh or glab). `render`
 * writes PNGs for the given drawings.
 */
export async function createPr(
  dir: string,
  project: Project,
  problems: Problem[],
  opts: { title?: string; context?: string; render?: (drawings: string[]) => Promise<void> },
): Promise<PrResult> {
  const preview = await prPreview(dir, project, problems, opts);
  if (!preview.ok) throw new GitError(preview.blockers.join('\n'));
  const { root, prefix } = await repoInfo(dir);
  const current = await git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
  if (current !== preview.branch) await git(dir, 'checkout', '-b', preview.branch);

  if (preview.images.length && opts.render) await opts.render(preview.images.map((i) => i.drawing));

  const scope = prefix || '.';
  await git(root, 'add', '-A', '--', scope);
  const staged = await git(root, 'diff', '--cached', '--name-only', '--', scope);
  if (staged) {
    const message = `${preview.title}\n\n${preview.changes.map((c) => `- ${c.text}`).join('\n')}\n`;
    await git(root, 'commit', '-m', message, '--', scope);
  }
  const commit = await git(dir, 'rev-parse', 'HEAD');
  await git(dir, 'push', '-u', 'origin', preview.branch);

  const provider: PrProvider = providerFor(await tryRun(git(dir, 'remote', 'get-url', 'origin')), project.config.git.provider);
  const repo = await provider.repoSlug(dir);
  const baseSha = await git(dir, 'rev-parse', preview.base).catch(() => commit);
  const full = (p: string) => (prefix ? `${prefix}/${p}` : p);
  // Pinned to SHAs so the images never change if the branch moves on.
  const imageUrl = (p: string, side: 'before' | 'after') => provider.blobUrl(repo, side === 'before' ? baseSha : commit, full(p));
  const body = prBody({ context: opts.context, changes: preview.changes, images: preview.images, imageUrl, flows: preview.changes.filter((c) => c.type.startsWith('flow.')), problems });

  const existing = preview.existingPr?.state === 'OPEN' ? preview.existingPr : undefined;
  if (existing) {
    await provider.editPr(dir, existing.number, body);
    return { url: existing.url, branch: preview.branch, commit, updated: true };
  }
  const baseBranch = project.config.git.baseBranch;
  const url = await provider.openPr(dir, { title: preview.title, body, base: baseBranch, head: preview.branch });
  return { url, branch: preview.branch, commit, updated: false };
}

