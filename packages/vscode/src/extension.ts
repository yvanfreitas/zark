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

/** Prefers the workspace's own `zark` (node_modules/.bin), else `npx zark`. */
function zarkCommand(archDir: string): { cmd: string; args: string[] } {
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
  const child = spawn(cmd, [...args, 'dev', '--no-open', '--port', '0', '--dir', archDir], {
    cwd: dirname(archDir),
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  child.stdout?.on('data', (d) => log.append(String(d)));
  child.stderr?.on('data', (d) => log.append(String(d)));
  spawned.set(archDir, child);
  const exited = new Promise<never>((_, reject) => child.once('exit', (code) => reject(new Error(`zark dev saiu com código ${code}. Veja o canal de saída "Zark".`))));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const info = await Promise.race([readServer(archDir), exited]);
    if (info) return info;
    await new Promise((r) => setTimeout(r, 300));
  }
  child.kill();
  throw new Error('O zark dev não respondeu em 30 s. Veja o canal de saída "Zark".');
}

async function modelSummary(info: ServerInfo): Promise<ModelSummary | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/api/model`, { headers: { 'x-zark-token': info.token } });
    return res.ok ? ((await res.json()) as ModelSummary) : undefined;
  } catch {
    return undefined;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('Zark');
  context.subscriptions.push(
    log,
    vscode.commands.registerCommand('zark.openDrawing', async (uri?: vscode.Uri) => {
      const file = (uri ?? vscode.window.activeTextEditor?.document.uri)?.fsPath;
      if (!file) return void vscode.window.showWarningMessage('Abra um arquivo YAML da pasta architecture/.');
      const archDir = findArchitectureDir(file, existsSync);
      if (!archDir) return void vscode.window.showWarningMessage('Nenhum zark.yaml acima deste arquivo. Rode "zark init" primeiro.');
      try {
        const info = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Zark: abrindo o desenho…' },
          () => ensureServer(archDir, log),
        );
        const url = drawingUrl(info.port, info.token, fragmentFor(archDir, file, await modelSummary(info)));
        let panel = panels.get(archDir);
        if (!panel) {
          panel = vscode.window.createWebviewPanel('zark.drawing', 'Zark', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true });
          panel.onDidDispose(() => panels.delete(archDir));
          panels.set(archDir, panel);
        }
        panel.webview.html = webviewHtml(url, info.port);
        panel.reveal(vscode.ViewColumn.Beside, true);
      } catch (err) {
        vscode.window.showErrorMessage(`Zark: ${(err as Error).message}`);
      }
    }),
  );
}

export function deactivate() {
  for (const child of spawned.values()) child.kill();
  spawned.clear();
}
