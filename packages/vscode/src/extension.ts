import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { drawingUrl, findArchitectureDir, fragmentFor, webviewHtml, type ModelSummary } from './target.js';

interface ServerInfo {
  port: number;
  token: string;
}

/** `zark dev` processes this extension started, by architecture dir. */
const spawned = new Map<string, ChildProcess>();
const panels = new Map<string, vscode.WebviewPanel>();

const serverFile = (archDir: string) => join(dirname(archDir), '.zark', 'server.json');

async function healthy(info: ServerInfo): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/api/health`, { headers: { 'x-zark-token': info.token } });
    return res.ok;
  } catch {
    return false;
  }
}

async function readServer(archDir: string): Promise<ServerInfo | undefined> {
  const info = await readFile(serverFile(archDir), 'utf8').then((t) => JSON.parse(t) as ServerInfo).catch(() => undefined);
  return info && (await healthy(info)) ? info : undefined;
}

/**
 * Which `zark` to run: the `zark.cliPath` setting or the `ZARK_CLI` env (path
 * to the CLI's main.js, run with node), else the workspace's own
 * node_modules/.bin/zark, else `npx zark`.
 */
function zarkCommand(archDir: string): { cmd: string; args: string[] } {
  const cliPath = vscode.workspace.getConfiguration('zark').get<string>('cliPath') || process.env.ZARK_CLI;
  if (cliPath) return { cmd: 'node', args: [cliPath] };
  const bin = process.platform === 'win32' ? 'zark.cmd' : 'zark';
  for (let dir = dirname(archDir); ; dir = dirname(dir)) {
    const local = join(dir, 'node_modules', '.bin', bin);
    if (existsSync(local)) return { cmd: local, args: [] };
    if (dirname(dir) === dir) break;
  }
  return { cmd: process.platform === 'win32' ? 'npx.cmd' : 'npx', args: ['--yes', 'zark'] };
}

/** Reuses a running `zark dev` for this folder or starts one on a free port. */
async function ensureServer(archDir: string, log: vscode.OutputChannel): Promise<ServerInfo> {
  const running = await readServer(archDir);
  if (running) return running;
  const { cmd, args } = zarkCommand(archDir);
  const argv = [...args, 'dev', '--no-open', '--port', '0', '--dir', archDir];
  log.appendLine(`zark: ${cmd} ${argv.join(' ')}`);
  const child = spawn(cmd, argv, {
    cwd: dirname(archDir),
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  child.stdout?.on('data', (d) => log.append(String(d)));
  child.stderr?.on('data', (d) => log.append(String(d)));
  spawned.set(archDir, child);
  const exited = new Promise<never>((_, reject) => child.once('exit', (code) => reject(new Error(`zark dev exited with code ${code}. See the "Zark" output channel.`))));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const info = await Promise.race([readServer(archDir), exited]);
    if (info) return info;
    await new Promise((r) => setTimeout(r, 300));
  }
  child.kill();
  throw new Error('zark dev did not respond within 30 s. See the "Zark" output channel.');
}

async function modelSummary(info: ServerInfo): Promise<ModelSummary | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/api/model`, { headers: { 'x-zark-token': info.token } });
    return res.ok ? ((await res.json()) as ModelSummary) : undefined;
  } catch {
    return undefined;
  }
}

/** Tab title: the drawing or flow the fragment points to. */
function panelTitle(fragment: string): string {
  const m = /^#(drawing|flow)=(.+)$/.exec(fragment);
  return m ? `Zark: ${decodeURIComponent(m[2])}` : 'Zark';
}

/** Returned by activate(); the integration tests inspect panels and the last error. */
export interface ZarkApi {
  panels: ReadonlyMap<string, vscode.WebviewPanel>;
  lastError(): string | undefined;
}

export function activate(context: vscode.ExtensionContext): ZarkApi {
  let lastError: string | undefined;
  const log = vscode.window.createOutputChannel('Zark');
  context.subscriptions.push(
    log,
    vscode.commands.registerCommand('zark.openDrawing', async (uri?: vscode.Uri) => {
      const file = (uri ?? vscode.window.activeTextEditor?.document.uri)?.fsPath;
      if (!file) return void vscode.window.showWarningMessage('Open a YAML file from the architecture/ folder.');
      const archDir = findArchitectureDir(file, existsSync);
      if (!archDir) return void vscode.window.showWarningMessage('No zark.yaml above this file. Run "zark init" first.');
      try {
        const info = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Zark: opening the drawing…' },
          () => ensureServer(archDir, log),
        );
        const fragment = fragmentFor(archDir, file, await modelSummary(info));
        const url = drawingUrl(info.port, info.token, fragment);
        let panel = panels.get(archDir);
        if (!panel) {
          panel = vscode.window.createWebviewPanel('zark.drawing', panelTitle(fragment), { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true });
          panel.onDidDispose(() => panels.delete(archDir));
          panels.set(archDir, panel);
        }
        panel.title = panelTitle(fragment);
        panel.webview.html = webviewHtml(url, info.port);
        panel.reveal(vscode.ViewColumn.Beside, true);
        lastError = undefined;
      } catch (err) {
        lastError = (err as Error).message;
        vscode.window.showErrorMessage(`Zark: ${lastError}`);
      }
    }),
  );
  return { panels, lastError: () => lastError };
}

export function deactivate() {
  for (const child of spawned.values()) child.kill();
  spawned.clear();
}
