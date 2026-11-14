// Loads the bundled extension with a stub `vscode` module and checks it registers its command.
const Module = require('node:module');
const registered = [];
const stub = {
  window: { createOutputChannel: () => ({ append() {}, dispose() {} }) },
  commands: { registerCommand: (id) => (registered.push(id), { dispose() {} }) },
  ViewColumn: { Beside: -2 },
  ProgressLocation: { Notification: 15 },
};
const load = Module._load;
Module._load = (request, ...rest) => (request === 'vscode' ? stub : load(request, ...rest));
const ext = require('./dist/extension.cjs');
ext.activate({ subscriptions: [] });
if (registered.join() !== 'zark.openDrawing' || typeof ext.deactivate !== 'function') {
  console.error('unexpected', registered);
  process.exit(1);
}
console.log('ok: activate registered', registered.join());
