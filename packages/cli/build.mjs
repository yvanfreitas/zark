// Bundles the CLI (core, server, mcp included) into dist/main.js, ships the
// built UI next to it and writes the JSON Schemas referenced by the YAML files.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const ui = here('../ui/dist');

rmSync(here('dist'), { recursive: true, force: true });
await build({
  entryPoints: [here('src/main.ts')],
  outfile: here('dist/main.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // playwright-core stays a real dependency: it locates its browsers relative to itself.
  external: ['playwright-core'],
  // Some bundled CommonJS deps call require(); give ESM output a real one.
  banner: { js: "import { createRequire as __zarkCreateRequire } from 'node:module';\nglobalThis.require ??= __zarkCreateRequire(import.meta.url);" },
  logLevel: 'warning',
});

if (existsSync(ui)) cpSync(ui, here('dist/ui'), { recursive: true });
else console.warn('Aviso: packages/ui/dist não existe; rode "pnpm --filter @zark/ui build" antes para embutir a UI.');

execFileSync(process.execPath, [here('dist/main.js'), 'schema', '--out', here('schema')], { stdio: 'inherit' });
console.log('CLI gerada em packages/cli/dist');
