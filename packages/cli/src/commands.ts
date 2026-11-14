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
  if (!existsSync(join(dir, 'zark.yaml'))) throw new Error(`Nenhum projeto Zark em ${dir}. Rode "zark init" ou passe --dir`);
  return loadProject(dir);
}

/** Built UI: next to the bundled CLI (dist/ui) or, in the monorepo, packages/ui/dist. */
function findUiDir(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  return [join(here, 'ui'), resolve(here, '../../ui/dist')].find((d) => existsSync(join(d, 'index.html')));
}

function requireUi(): string {
  const ui = findUiDir();
  if (!ui) throw new Error('UI não encontrada. Rode "pnpm --filter @zark/ui build" (ou "pnpm build") antes.');
  return ui;
}

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args as string[], { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => undefined).unref();
}

function changesText(changes: Change[], format?: string): string {
  if (format === 'markdown') {
    const body = changes.length ? changes.map((c) => `- ${c.text}`).join('\n') : '- Sem mudanças no modelo';
    return `## Alterações de arquitetura\n\n${body}\n`;
  }
  return changes.length ? changes.map((c) => c.text).join('\n') + '\n' : 'Sem mudanças no modelo\n';
}

function mermaidFor(project: Project, flowId: string): string {
  const flow = project.flows.get(flowId)?.flow;
  if (!flow) throw new Error(`Fluxo "${flowId}" não existe. Fluxos: ${[...project.flows.keys()].join(', ') || '(nenhum)'}`);
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
    return /^(s|sim|y|yes)$/i.test((await rl.question(`${question} [s/N] `)).trim());
  } finally {
    rl.close();
  }
}

export const commands: Record<string, Command> = {
  async init({ dir }) {
    if (existsSync(join(dir, 'zark.yaml'))) throw new Error(`Já existe um projeto em ${dir}`);
    const files: [string, Parameters<typeof createDoc>[0], unknown][] = [
      ['zark.yaml', 'config', { schema: 1, name: 'Arquitetura', defaultDrawing: 'contexto', grid: 8, render: { commit: 'pr', scale: 2, theme: 'light' }, git: { baseBranch: 'main', branchPrefix: 'zark/' } }],
      ['catalog.yaml', 'catalog', { technologies: [], tags: [], teams: [] }],
      ['drawings/contexto.yaml', 'drawing', { id: 'contexto', name: 'Contexto', scope: null, nodes: {}, edges: {} }],
    ];
    for (const [path, kind, data] of files) await writeAtomic(join(dir, path), toText(createDoc(kind, data)));
    await mkdir(join(dir, 'entities'), { recursive: true });
    await mkdir(join(dir, 'flows'), { recursive: true });
    await appendLineOnce(join(dirname(dir), '.gitignore'), '.zark/');
    // Keep YAML as LF on every OS, or core.autocrlf turns one-line diffs into whole-file ones.
    await appendLineOnce(join(dirname(dir), '.gitattributes'), `${basename(dir)}/**/*.yaml text eol=lf`);
    console.log(`Projeto criado em ${dir}. Próximo passo: zark dev`);
  },

  async validate({ dir, format }) {
    const project = await requireProject(dir);
    const problems = validate(project, await renderedProblems(project));
    const errors = errorsOf(problems);
    if (format === 'json') console.log(JSON.stringify({ errors: errors.length, warnings: warningsOf(problems).length, problems }, null, 2));
    else {
      for (const p of problems) console.log(formatProblem(p));
      console.log(`${errors.length} erro(s), ${problems.length - errors.length} aviso(s)`);
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
      for (const path of dirty) console.log(`fora do formato canônico: ${path}`);
      if (dirty.length) console.log('Rode "zark fmt" para corrigir');
      return dirty.length ? 1 : 0;
    }
    console.log(dirty.length ? `${dirty.length} arquivo(s) formatado(s)` : 'Nada a formatar');
  },

  async migrate({ dir, check }) {
    if (!existsSync(join(dir, 'zark.yaml'))) throw new Error(`Nenhum projeto Zark em ${dir}`);
    const result = migrate(await readTexts(dir));
    if (!result.steps.length) {
      console.log(`Formato já na versão ${result.from}. Nada a migrar`);
      return 0;
    }
    for (const step of result.steps) console.log(`schema ${step}`);
    if (check) {
      console.log(`${result.files.size} arquivo(s) seriam alterados. Rode "zark migrate" para aplicar`);
      return 1;
    }
    for (const [path, text] of result.files) {
      if (text === null) await rm(join(dir, path), { force: true });
      else await writeAtomic(join(dir, path), text);
    }
    console.log(`Migrado do schema ${result.from} para ${result.to} (${result.files.size} arquivo(s))`);
  },

  async schema({ out }) {
    if (!out) throw new Error('Use --out <pasta>');
    await mkdir(out, { recursive: true });
    for (const [name, schema] of Object.entries(jsonSchemas())) await writeFile(join(out, `${name}.json`), JSON.stringify(schema, null, 2) + '\n');
    console.log(`Schemas gravados em ${out}`);
  },

  async dev({ dir, port, host, 'no-open': noOpen }) {
    await requireProject(dir);
    const uiDir = findUiDir();
    if (!uiDir) console.warn('Aviso: UI não encontrada. Rode "pnpm --filter @zark/ui build". A API e o MCP funcionam mesmo assim.');
    if (host && host !== '127.0.0.1' && host !== 'localhost') console.warn(`Aviso: escutando em ${host}. O servidor grava arquivos e abre PRs; exponha só em rede confiável.`);
    const { mcpHttpHandler } = await import('@zark/mcp');
    const running = await startServer({ dir, port: port ? Number(port) : 4317, host, uiDir, watch: true, advertise: true, mcp: mcpHttpHandler });
    const url = `${running.url}/?token=${running.token}`;
    console.log(`Zark rodando em ${url}`);
    console.log(`MCP por HTTP: ${running.url}/mcp (header "Authorization: Bearer ${running.token}")`);
    console.log('Ctrl+C para parar.');
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
      console.log(stale.length ? `${stale.length} PNG(s) desatualizado(s). Rode "zark render --write"` : 'PNGs em rendered/ atualizados');
      return stale.length ? 1 : 0;
    }
    for (const id of args) if (!project.drawings.has(id)) throw new Error(`Desenho "${id}" não existe. Desenhos: ${[...project.drawings.keys()].join(', ')}`);
    const running = await startServer({ dir, port: 0, uiDir: requireUi() });
    try {
      const results = await running.service.renderAll(true, args);
      for (const r of results) console.log(`${r.skipped ? 'inalterado' : 'gerado    '} ${r.path}`);
      console.log(`${results.filter((r) => !r.skipped).length} gerado(s), ${results.filter((r) => r.skipped).length} já atualizado(s)`);
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
    console.log(`Título: ${preview.title}`);
    console.log(`Branch: ${preview.branch} -> ${preview.base}`);
    if (preview.existingPr) console.log(`PR existente: ${preview.existingPr.url} (a descrição será atualizada)`);
    console.log(`Arquivos: ${preview.files.join(', ') || '(nenhum)'}`);
    if (preview.images.length) console.log(`Imagens: ${preview.images.map((i) => i.path).join(', ')}`);
    console.log(`\n${preview.body}`);
    if (!preview.ok) {
      for (const b of preview.blockers) console.error(`Bloqueado: ${b}`);
      return 1;
    }
    if (!yes && !(await confirm('Criar o PR?'))) {
      console.log('Cancelado. Nada foi alterado.');
      return 1;
    }
    const running = await startServer({ dir, port: 0, uiDir: findUiDir() });
    try {
      const result = await running.service.createPr({ title });
      console.log(`${result.updated ? 'PR atualizado' : 'PR criado'}: ${result.url}`);
    } finally {
      await running.stop();
    }
  },

  async build({ dir, out }) {
    if (!out) throw new Error('Use --out <pasta>');
    const ui = requireUi();
    const store = await new ProjectStore(dir).load();
    const target = resolve(out);
    await cp(ui, target, { recursive: true });
    // Read-only contract with the UI: no session token -> it loads ./model.json next to index.html.
    // root is a local absolute path; it has no meaning on a published site.
    await writeFile(join(target, 'model.json'), JSON.stringify({ ...store.snapshot(), root: '', readOnly: true }) + '\n');
    console.log(`Site estático gravado em ${target}`);
  },

  async export({ dir, args, out }) {
    const [format, id] = args;
    const emit = async (text: string) => {
      if (out) {
        await writeAtomic(resolve(out), text);
        console.error(`Exportado em ${resolve(out)}`);
      } else process.stdout.write(text);
    };
    if (format === 'json') {
      const store = await new ProjectStore(dir).load();
      return emit(JSON.stringify(store.snapshot(), null, 2) + '\n');
    }
    if (format === 'mermaid') {
      const project = await requireProject(dir);
      const ids = id ? [id] : [...project.flows.keys()];
      if (!ids.length) throw new Error('Nenhum fluxo para exportar');
      return emit(ids.map((f) => `%% ${f}\n${mermaidFor(project, f)}`).join('\n'));
    }
    if (format === 'structurizr') return emit(JSON.stringify(toStructurizr(await requireProject(dir)), null, 2) + '\n');
    if (format === 'icepanel-yaml' || format === 'icepanel') return emit(toIcePanelYaml(await requireProject(dir)));
    throw new Error('Formatos: mermaid, json, structurizr, icepanel-yaml');
  },

  async import({ dir, args, yes }) {
    const [format, file] = args.length === 1 ? ['auto', args[0]] : args;
    if (!file) throw new Error('Uso: zark import <icepanel-json|icepanel-yaml|structurizr|auto> <arquivo>');
    const project = await requireProject(dir);
    const plan = planImport(await readFile(resolve(file), 'utf8'), format, project);
    const result = await applyOps(project, plan.ops);
    for (const w of plan.warnings) console.log(`aviso: ${w}`);
    if (!result.ok) {
      for (const p of result.newErrors) console.log(formatProblem(p));
      throw new Error(`Importação recusada: ${result.error}`);
    }
    for (const c of result.changes) console.log(c.text);
    console.log(`${result.files.size} arquivo(s) a gravar a partir de ${plan.format}`);
    if (!yes && !(await confirm('Gravar os arquivos?'))) return 1;
    await writeResult(dir, result.files);
    console.log('Importado. Rode "zark validate" para ver os avisos.');
  },
};

