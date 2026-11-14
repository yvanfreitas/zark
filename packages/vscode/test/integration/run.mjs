// Runs the extension inside a real VS Code (downloaded by @vscode/test-electron).
// Workspace: a temp copy of examples/ecommerce. The extension starts `zark dev`
// from the built CLI (ZARK_CLI), so run `pnpm build` first. On Linux CI wrap
// with `xvfb-run -a`.
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import testElectron from '@vscode/test-electron';

const { runTests } = testElectron;

const pkg = fileURLToPath(new URL('../..', import.meta.url));
const repo = join(pkg, '..', '..');
const cli = join(repo, 'packages', 'cli', 'dist', 'main.js');
if (!existsSync(cli)) throw new Error(`CLI não encontrada em ${cli}. Rode "pnpm build" antes.`);
if (!existsSync(join(pkg, 'dist', 'extension.cjs'))) throw new Error('Extensão não buildada. Rode "pnpm --filter zark-vscode build".');

const workspace = await mkdtemp(join(tmpdir(), 'zark-vscode-'));
await cp(join(repo, 'examples', 'ecommerce'), workspace, { recursive: true });
try {
  await runTests({
    version: process.env.VSCODE_VERSION ?? 'stable',
    extensionDevelopmentPath: pkg,
    extensionTestsPath: join(pkg, 'test', 'integration', 'suite.cjs'),
    launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
    extensionTestsEnv: { ZARK_CLI: cli, ZARK_TEST_WORKSPACE: workspace },
  });
} finally {
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
}
