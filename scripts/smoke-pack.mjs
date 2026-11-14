// Installs the packed CLI tarball into an empty project and follows the README:
// npm i -D zark, npx zark init / validate / fmt / render / export / import /
// build / schema, `zark dev` serving the UI and API, and an MCP stdio handshake.
// Usage: node scripts/smoke-pack.mjs <path-to-zark-x.y.z.tgz> [--no-render]
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const tarball = resolve(process.argv[2] ?? '');
if (!existsSync(tarball)) throw new Error(`Tarball not found: ${tarball}`);
const withRender = !process.argv.includes('--no-render');
const win = process.platform === 'win32';
const npm = win ? 'npm.cmd' : 'npm';
const npx = win ? 'npx.cmd' : 'npx';

const project = mkdtempSync(join(tmpdir(), 'zark-smoke-'));
const run = (cmd, args, opts = {}) => {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: win, ...opts });
};
const zark = (...args) => run(npx, ['--no-install', 'zark', ...args]);
const step = (name) => console.log(`\n== ${name}`);
// Ends a spawned CLI and its children; the process may already be gone.
// npx starts `zark` as its own child, so the whole tree must go: taskkill /T on
// Windows, the process group elsewhere (children are spawned detached).
const stop = (child) => {
  child.stdout?.removeAllListeners('data');
  child.stdout?.destroy();
  child.stdin?.destroy();
  try {
    if (win) execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    /* already exited */
  }
};

step('npm i -D @ewcodes/zark');
run('git', ['init', '-q', '-b', 'main']);
writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'smoke', private: true }, null, 2));
run(npm, ['i', '-D', tarball, '--no-audit', '--no-fund']);

step('zark init');
console.log(zark('init'));
for (const f of ['architecture/zark.yaml', 'architecture/catalog.yaml', 'architecture/drawings/context.yaml', '.gitignore', '.gitattributes']) {
  if (!existsSync(join(project, f))) throw new Error(`init did not create ${f}`);
}

step('model via import + validate + fmt');
const structurizr = {
  name: 'Smoke',
  model: {
    people: [{ id: '1', name: 'User', relationships: [{ id: '10', destinationId: '2', description: 'Uses the app' }] }],
    softwareSystems: [{ id: '2', name: 'Shop', relationships: [{ id: '11', destinationId: '3', description: 'Charges the card' }] }, { id: '3', name: 'Payments', location: 'External' }],
  },
  views: { systemLandscapeViews: [{ key: 'landscape', elements: [{ id: '1', x: 0, y: 0 }, { id: '2', x: 800, y: 0 }, { id: '3', x: 1600, y: 0 }], relationships: [{ id: '10' }, { id: '11' }] }] },
};
writeFileSync(join(project, 'workspace.json'), JSON.stringify(structurizr));
console.log(zark('import', 'workspace.json', '--yes'));
console.log(zark('validate'));
console.log(zark('fmt', '--check'));

step('export + schema + build');
const mermaidOrJson = zark('export', 'json');
if (!JSON.parse(mermaidOrJson).entities?.length) throw new Error('export json has no entities');
zark('export', 'structurizr', '--out', 'out.json');
if (!JSON.parse(readFileSync(join(project, 'out.json'), 'utf8')).model) throw new Error('structurizr export is empty');
zark('schema', '--out', 'schemas');
if (!existsSync(join(project, 'schemas/entity.json'))) throw new Error('schema did not write entity.json');
zark('build', '--out', 'site');
if (!existsSync(join(project, 'site/index.html')) || !existsSync(join(project, 'site/model.json'))) throw new Error('build did not write the site');

if (withRender) {
  step('render (downloads Chromium on first use)');
  console.log(zark('render'));
  console.log(zark('render', '--check'));
  const pngs = readFileSync(join(project, 'architecture/rendered/landscape.png'));
  if (pngs.length < 5000) throw new Error('rendered PNG looks empty');
}

step('zark dev serves the UI and the API');
await new Promise((done, fail) => {
  const child = spawn(npx, ['--no-install', 'zark', 'dev', '--no-open', '--port', '0'], { cwd: project, shell: win, detached: !win, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  const timer = setTimeout(() => (stop(child), fail(new Error(`zark dev did not start:\n${out}`))), 60_000);
  let checked = false;
  child.stdout.on('data', async (d) => {
    out += d;
    if (checked) return;
    const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([0-9a-f]+)/.exec(out);
    if (!m) return;
    checked = true;
    const base = `http://127.0.0.1:${m[1]}`;
    const token = m[2];
    clearTimeout(timer);
    try {
      const html = await (await fetch(`${base}/`)).text();
      if (!html.includes('<div id="root">')) throw new Error('UI not served');
      const health = await fetch(`${base}/api/health`, { headers: { 'x-zark-token': token } });
      if (health.status !== 200) throw new Error(`/api/health -> ${health.status}`);
      const model = await (await fetch(`${base}/api/model`, { headers: { 'x-zark-token': token } })).json();
      console.log(`UI ok, health ok, model has ${model.entities.length} entities`);
      done();
    } catch (err) {
      fail(err);
    } finally {
      stop(child);
    }
  });
});

step('zark mcp (stdio handshake)');
await new Promise((done, fail) => {
  const child = spawn(npx, ['--no-install', 'zark', 'mcp'], { cwd: project, shell: win, detached: !win, stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '';
  const timer = setTimeout(() => (stop(child), fail(new Error(`no MCP response:\n${buf}`))), 60_000);
  const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');
  child.stdout.on('data', (d) => {
    buf += d;
    for (const line of buf.split('\n').slice(0, -1)) {
      const msg = JSON.parse(line);
      if (msg.id === 1) {
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      }
      if (msg.id === 2) {
        clearTimeout(timer);
        const names = msg.result.tools.map((t) => t.name);
        if (!names.includes('apply_changes')) return fail(new Error('MCP tools missing apply_changes'));
        console.log(`MCP ok: ${names.length} tools`);
        stop(child);
        done();
      }
    }
    buf = buf.slice(buf.lastIndexOf('\n') + 1);
  });
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } });
});

console.log(`\nSMOKE OK (${process.platform}, node ${process.version}) in ${project}`);
