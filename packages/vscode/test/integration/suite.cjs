// Runs inside the VS Code extension host. Minimal runner: run() resolves on
// success and rejects on the first failed check (test-electron then exits 1).
const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

const log = (...a) => console.log('[zark-integration]', ...a);

async function waitFor(fn, what, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout esperando ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function run() {
  log(`VS Code ${vscode.version}`);
  const workspace = process.env.ZARK_TEST_WORKSPACE;
  assert.ok(workspace, 'ZARK_TEST_WORKSPACE ausente');

  const ext = vscode.extensions.getExtension('zark.zark-vscode');
  assert.ok(ext, 'extension zark.zark-vscode not loaded');
  const api = await ext.activate();
  assert.ok(api && api.panels, 'activate() did not return the API');
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('zark.openDrawing'), 'command zark.openDrawing not registered');
  log('extension activated, command registered');

  const file = path.join(workspace, 'architecture', 'drawings', 'context.yaml');
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('zark.openDrawing');

  const panel = await waitFor(() => {
    if (api.lastError()) throw new Error(`the extension failed: ${api.lastError()}`);
    return [...api.panels.values()][0];
  }, 'the Zark panel');
  assert.equal(panel.title, 'Zark: context');
  // "Ao lado do YAML": the panel's tab must live in a group to the right of the editor's.
  const editorColumn = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
  const panelGroup = await waitFor(
    () => vscode.window.tabGroups.all.find((g) => g.tabs.some((t) => t.label === 'Zark: context')),
    'the panel tab in an editor group',
  );
  const yamlGroup = vscode.window.tabGroups.all.find((g) => g.tabs.some((t) => t.input && t.input.uri && t.input.uri.fsPath === doc.uri.fsPath));
  assert.ok(yamlGroup, 'the YAML tab disappeared');
  assert.notEqual(panelGroup.viewColumn, yamlGroup.viewColumn, 'the panel opened in the YAML group, not beside it');
  assert.ok(panelGroup.viewColumn > yamlGroup.viewColumn, `the panel ended up on the left (panel ${panelGroup.viewColumn}, YAML ${yamlGroup.viewColumn})`);
  assert.equal(editorColumn, yamlGroup.viewColumn, 'o foco deveria continuar no YAML (preserveFocus)');
  log(`webview panel "${panel.title}" in column ${panelGroup.viewColumn}, YAML in column ${yamlGroup.viewColumn} (beside)`);

  const html = panel.webview.html;
  const m = /<iframe src="(http:\/\/127\.0\.0\.1:(\d+)\/\?token=([0-9a-f]+)#drawing=context)"/.exec(html);
  assert.ok(m, `iframe for the drawing not found in the webview HTML:\n${html}`);
  const [, url, port, token] = m;
  assert.match(html, new RegExp(`frame-src http://127\\.0\\.0\\.1:${port};`), 'CSP does not restrict the frame to the server port');
  log(`iframe ${url.replace(token, '<token>')}`);

  const health = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { 'x-zark-token': token } });
  assert.equal(health.status, 200, `/api/health respondeu ${health.status}`);
  const body = await health.json();
  assert.equal(path.resolve(body.dir), path.resolve(workspace, 'architecture'));
  log(`GET /api/health -> ${health.status} (dir ${body.dir})`);

  // The page the iframe loads is the real UI.
  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<div id="root">/);
  const model = await fetch(`http://127.0.0.1:${port}/api/model`, { headers: { 'x-zark-token': token } }).then((r) => r.json());
  assert.equal(model.entities.length, 18);
  log(`UI served, model has ${model.entities.length} entities`);

  // Same command on an entity file reuses the server and retargets the panel.
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(path.join(workspace, 'architecture', 'entities', 'bot-queue.yaml')));
  await vscode.commands.executeCommand('zark.openDrawing');
  await waitFor(() => api.panels.size === 1 && /#drawing=platform"/.test(panel.webview.html), 'the panel pointing at the platform drawing');
  assert.ok(panel.webview.html.includes(`127.0.0.1:${port}/`), 'server was not reused');
  log('entity bot-queue.yaml -> same panel, #drawing=platform, same server');

  log('PASS');
}

module.exports = { run };
