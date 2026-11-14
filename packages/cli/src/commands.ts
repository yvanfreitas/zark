import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import {
  createDoc,
  diffProjects,
  errorsOf,
  fileKind,
  flowToMermaid,
  formatProblem,
  formatText,
  jsonSchemas,
  loadProject,
  migrate,
  readTexts,
  toText,
  validate,
  warningsOf,
  writeAtomic,
  applyOps,
  planImport,
  toIcePanelYaml,
  toStructurizr,
  writeResult,
  type Change,
  type Project,
} from '@zark/core';
import { defaultBase, ProjectStore, prPreview, projectAtRef, renderedProblems, startServer } from '@zark/server';

export interface Ctx {
  dir: string;
  args: string[];
  format?: string;
  check?: boolean;
  write?: boolean;
  base?: string;
  port?: string;
  host?: string;
  'no-open'?: boolean;
  out?: string;
  yes?: boolean;
  title?: string;
}

type Command = (ctx: Ctx) => Promise<number | void>;

async function requireProject(dir: string) {
  if (!existsSync(join(dir, 'zark.yaml'))) throw new Error(`No Zark project in ${dir}. Run "zark init" or pass --dir`);
  return loadProject(dir);
}

/** Built UI: next to the bundled CLI (dist/ui) or, in the monorepo, packages/ui/dist. */
function findUiDir(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  return [join(here, 'ui'), resolve(here, '../../ui/dist')].find((d) => existsSync(join(d, 'index.html')));
}

function requireUi(): string {
  const ui = findUiDir();
  if (!ui) throw new Error('UI not found. Run "pnpm --filter @zark/ui build" (or "pnpm build") first.');
  return ui;
}

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args as string[], { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => undefined).unref();
}

function changesText(changes: Change[], format?: string): string {
  if (format === 'markdown') {
    const body = changes.length ? changes.map((c) => `- ${c.text}`).join('\n') : '- No model changes';
    return `## Architecture changes\n\n${body}\n`;
  }
  return changes.length ? changes.map((c) => c.text).join('\n') + '\n' : 'No model changes\n';
}

function mermaidFor(project: Project, flowId: string): string {
  const flow = project.flows.get(flowId)?.flow;
  if (!flow) throw new Error(`Flow "${flowId}" does not exist. Flows: ${[...project.flows.keys()].join(', ') || '(none)'}`);
  return flowToMermaid(flow, {
    connection: (ref) => {
      const c = project.connections.get(ref);
      return c && { from: c.from, to: c.conn.to, direction: c.conn.direction };
    },
    name: (id) => project.entities.get(id)?.entity.name ?? id,
    subflow: (id) => project.flows.get(id)?.flow.steps,
  });
}

async function appendLineOnce(file: string, line: string) {
  const current = existsSync(file) ? await readFile(file, 'utf8') : '';
  if (current.split(/\r?\n/).some((l) => l.trim() === line || (line === '.zark/' && l.trim() === '.zark'))) return;
  await appendFile(file, `${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`);
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^(y|yes|s|sim)$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

export const commands: Record<string, Command> = {
  async init({ dir }) {
    if (existsSync(join(dir, 'zark.yaml'))) throw new Error(`A project already exists in ${dir}`);
    const files: [string, Parameters<typeof createDoc>[0], unknown][] = [
      ['zark.yaml', 'config', { schema: 1, name: 'Architecture', defaultDrawing: 'context', grid: 8, render: { commit: 'pr', scale: 2, theme: 'light' }, git: { baseBranch: 'main', branchPrefix: 'zark/' } }],
      ['catalog.yaml', 'catalog', { technologies: [], tags: [], teams: [] }],
      ['drawings/context.yaml', 'drawing', { id: 'context', name: 'Context', scope: null, nodes: {}, edges: {} }],
    ];
    for (const [path, kind, data] of files) await writeAtomic(join(dir, path), toText(createDoc(kind, data)));
    await mkdir(join(dir, 'entities'), { recursive: true });
    await mkdir(join(dir, 'flows'), { recursive: true });
    await appendLineOnce(join(dirname(dir), '.gitignore'), '.zark/');
    // Keep YAML as LF on every OS, or core.autocrlf turns one-line diffs into whole-file ones.
    await appendLineOnce(join(dirname(dir), '.gitattributes'), `${basename(dir)}/**/*.yaml text eol=lf`);
    console.log(`Project created in ${dir}. Next step: zark dev`);
  },

  async validate({ dir, format }) {
    const project = await requireProject(dir);
    const problems = validate(project, await renderedProblems(project));
    const errors = errorsOf(problems);
    if (format === 'json') console.log(JSON.stringify({ errors: errors.length, warnings: warningsOf(problems).length, problems }, null, 2));
    else {
      for (const p of problems) console.log(formatProblem(p));
      console.log(`${errors.length} error(s), ${problems.length - errors.length} warning(s)`);
    }
    return errors.length ? 1 : 0;
  },

  async fmt({ dir, check }) {
    await requireProject(dir);
    const dirty: string[] = [];
    for (const [path, text] of await readTexts(dir)) {
      const out = formatText(fileKind(path)!, text);
      if (out === text) continue;
      dirty.push(path);
      if (!check) await writeAtomic(join(dir, path), out);
    }
    if (check) {
      for (const path of dirty) console.log(`not in canonical format: ${path}`);
      if (dirty.length) console.log('Run "zark fmt" to fix');
      return dirty.length ? 1 : 0;
    }
    console.log(dirty.length ? `${dirty.length} file(s) formatted` : 'Nothing to format');
  },

  async migrate({ dir, check }) {
    if (!existsSync(join(dir, 'zark.yaml'))) throw new Error(`No Zark project in ${dir}`);
    const result = migrate(await readTexts(dir));
    if (!result.steps.length) {
      console.log(`Format already at version ${result.from}. Nothing to migrate`);
      return 0;
    }
    for (const step of result.steps) console.log(`schema ${step}`);
    if (check) {
      console.log(`${result.files.size} file(s) would change. Run "zark migrate" to apply`);
      return 1;
    }
    for (const [path, text] of result.files) {
      if (text === null) await rm(join(dir, path), { force: true });
      else await writeAtomic(join(dir, path), text);
    }
    console.log(`Migrated from schema ${result.from} to ${result.to} (${result.files.size} file(s))`);
  },

  async schema({ out }) {
    if (!out) throw new Error('Use --out <folder>');
    await mkdir(out, { recursive: true });
    for (const [name, schema] of Object.entries(jsonSchemas())) await writeFile(join(out, `${name}.json`), JSON.stringify(schema, null, 2) + '\n');
    console.log(`Schemas written to ${out}`);
  },

  async dev({ dir, port, host, 'no-open': noOpen }) {
    await requireProject(dir);
    const uiDir = findUiDir();
    if (!uiDir) console.warn('Warning: UI not found. Run "pnpm --filter @zark/ui build". The API and MCP still work.');
    if (host && host !== '127.0.0.1' && host !== 'localhost') console.warn(`Warning: listening on ${host}. The server writes files and opens PRs; expose it only on a trusted network.`);
    const { mcpHttpHandler } = await import('@zark/mcp');
    const running = await startServer({ dir, port: port ? Number(port) : 4317, host, uiDir, watch: true, advertise: true, mcp: mcpHttpHandler });
    const url = `${running.url}/?token=${running.token}`;
    console.log(`Zark running at ${url}`);
    console.log(`MCP over HTTP: ${running.url}/mcp (header "Authorization: Bearer ${running.token}")`);
    console.log('Ctrl+C to stop.');
    if (!noOpen) openBrowser(url);
    await new Promise<void>((done) => {
      const stop = () => {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
        void running.stop().finally(done);
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    });
  },

  async mcp({ dir }) {
    await requireProject(dir);
    const { runStdio } = await import('@zark/mcp');
    await runStdio(dir, { uiDir: findUiDir() });
  },

  async render({ dir, check, args }) {
    const project = await requireProject(dir);
    if (check) {
      // Only PNGs already in rendered/ count; no browser needed, hashes say it all.
      const stale = (await renderedProblems(project)).filter((p) => !args.length || (p.ref && args.includes(p.ref.replace(/^rendered:/, ''))));
      for (const p of stale) console.log(`${p.file}: ${p.message}`);
      console.log(stale.length ? `${stale.length} PNG(s) out of date. Run "zark render --write"` : 'PNGs in rendered/ are up to date');
      return stale.length ? 1 : 0;
    }
    for (const id of args) if (!project.drawings.has(id)) throw new Error(`Drawing "${id}" does not exist. Drawings: ${[...project.drawings.keys()].join(', ')}`);
    const running = await startServer({ dir, port: 0, uiDir: requireUi() });
    try {
      const results = await running.service.renderAll(true, args);
      for (const r of results) console.log(`${r.skipped ? 'unchanged' : 'rendered '} ${r.path}`);
      console.log(`${results.filter((r) => !r.skipped).length} rendered, ${results.filter((r) => r.skipped).length} already up to date`);
    } finally {
      await running.stop();
    }
  },

  async diff({ dir, base, format }) {
    const project = await requireProject(dir);
    const ref = base || (await defaultBase(dir, project.config.git.baseBranch));
    const before = await projectAtRef(dir, ref);
    process.stdout.write(changesText(diffProjects(before, project), format));
  },

  async pr({ dir, yes, title }) {
    const project = await requireProject(dir);
    const problems = validate(project, await renderedProblems(project));
    const preview = await prPreview(dir, project, problems, { title });
    console.log(`Title: ${preview.title}`);
    console.log(`Branch: ${preview.branch} -> ${preview.base}`);
    if (preview.existingPr) console.log(`Existing ${preview.provider.noun}: ${preview.existingPr.url} (the description will be updated)`);
    console.log(`Files: ${preview.files.join(', ') || '(none)'}`);
    if (preview.images.length) console.log(`Images: ${preview.images.map((i) => i.path).join(', ')}`);
    console.log(`\n${preview.body}`);
    if (!preview.ok) {
      for (const b of preview.blockers) console.error(`Blocked: ${b}`);
      return 1;
    }
    if (!yes && !(await confirm(`Create the ${preview.provider.noun}?`))) {
      console.log('Cancelled. Nothing was changed.');
      return 1;
    }
    const running = await startServer({ dir, port: 0, uiDir: findUiDir() });
    try {
      const result = await running.service.createPr({ title });
      console.log(`${preview.provider.noun} ${result.updated ? 'updated' : 'created'}: ${result.url}`);
    } finally {
      await running.stop();
    }
  },

  async build({ dir, out }) {
    if (!out) throw new Error('Use --out <folder>');
    const ui = requireUi();
    const store = await new ProjectStore(dir).load();
    const target = resolve(out);
    await cp(ui, target, { recursive: true });
    // Read-only contract with the UI: no session token -> it loads ./model.json next to index.html.
    // root is a local absolute path; it has no meaning on a published site.
    await writeFile(join(target, 'model.json'), JSON.stringify({ ...store.snapshot(), root: '', readOnly: true }) + '\n');
    console.log(`Static site written to ${target}`);
  },

  async export({ dir, args, out }) {
    const [format, id] = args;
    const emit = async (text: string) => {
      if (out) {
        await writeAtomic(resolve(out), text);
        console.error(`Exported to ${resolve(out)}`);
      } else process.stdout.write(text);
    };
    if (format === 'json') {
      const store = await new ProjectStore(dir).load();
      return emit(JSON.stringify(store.snapshot(), null, 2) + '\n');
    }
    if (format === 'mermaid') {
      const project = await requireProject(dir);
      const ids = id ? [id] : [...project.flows.keys()];
      if (!ids.length) throw new Error('No flow to export');
      return emit(ids.map((f) => `%% ${f}\n${mermaidFor(project, f)}`).join('\n'));
    }
    if (format === 'structurizr') return emit(JSON.stringify(toStructurizr(await requireProject(dir)), null, 2) + '\n');
    if (format === 'icepanel-yaml' || format === 'icepanel') return emit(toIcePanelYaml(await requireProject(dir)));
    throw new Error('Formats: mermaid, json, structurizr, icepanel-yaml');
  },

  async import({ dir, args, yes }) {
    const [format, file] = args.length === 1 ? ['auto', args[0]] : args;
    if (!file) throw new Error('Usage: zark import <icepanel-json|icepanel-yaml|structurizr|auto> <file>');
    const project = await requireProject(dir);
    const plan = planImport(await readFile(resolve(file), 'utf8'), format, project);
    const result = await applyOps(project, plan.ops);
    for (const w of plan.warnings) console.log(`warning: ${w}`);
    if (!result.ok) {
      for (const p of result.newErrors) console.log(formatProblem(p));
      throw new Error(`Import refused: ${result.error}`);
    }
    for (const c of result.changes) console.log(c.text);
    console.log(`${result.files.size} file(s) to write from ${plan.format}`);
    if (!yes && !(await confirm('Write the files?'))) return 1;
    await writeResult(dir, result.files);
    console.log('Imported. Run "zark validate" to see the warnings.');
  },
};

