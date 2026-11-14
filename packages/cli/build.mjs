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
  // Read from disk at runtime (icon SVGs and metadata), so they stay real dependencies.
  external: ['playwright-core', 'lucide-static', 'simple-icons'],
  // Some bundled CommonJS deps call require(); give ESM output a real one.
  banner: { js: "import { createRequire as __zarkCreateRequire } from 'node:module';\nglobalThis.require ??= __zarkCreateRequire(import.meta.url);" },
  logLevel: 'warning',
});

// A CLI without the UI would publish a broken `zark dev`: fail instead of warning.
if (!existsSync(ui)) {
  console.error('packages/ui/dist does not exist: run "pnpm --filter @zark/ui build" (or "pnpm build") first.');
  process.exit(1);
}
cpSync(ui, here('dist/ui'), { recursive: true });

execFileSync(process.execPath, [here('dist/main.js'), 'schema', '--out', here('schema')], { stdio: 'inherit' });

// The npm page and the tarball show the repo's README, license and icon notices.
for (const f of ['README.md', 'LICENSE', 'ICONS.md']) cpSync(here(`../../${f}`), here(f));
console.log('CLI built in packages/cli/dist');
