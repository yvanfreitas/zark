// Fase 6 acceptance, end to end: edit -> preview -> one confirmation -> PR with
// title, summary and images. Real git (local bare remote), real headless render,
// fake `gh` that records its arguments. Skipped when the UI is not built.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const EXAMPLE = fileURLToPath(new URL('../../../examples/ai-chat/architecture', import.meta.url));
const UI = fileURLToPath(new URL('../../ui/dist', import.meta.url));
const hasUi = existsSync(join(UI, 'index.html'));

const FAKE_GH = `
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + '\\n');
const cmd = args.slice(0, 2).join(' ');
if (cmd === 'auth status') process.exit(0);
if (cmd === 'repo view') { console.log(JSON.stringify({ nameWithOwner: 'acme/zark' })); process.exit(0); }
if (cmd === 'pr view') { console.error('no pull requests found'); process.exit(1); }
if (cmd === 'pr create') { console.log('https://github.com/acme/zark/pull/1'); process.exit(0); }
process.exit(2);
`;

describe.skipIf(!hasUi)('phase 6: from edit to PR', () => {
  it('opens a PR with title, summary and SHA-pinned images, committing only architecture/', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'zark-pr-'));
    const repo = join(tmp, 'repo');
    const remote = join(tmp, 'remote.git');
    const dir = join(repo, 'architecture');
    await cp(EXAMPLE, dir, { recursive: true });
    await writeFile(join(repo, 'app.txt'), 'application code\n');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    execFileSync('git', ['init', '--bare', '-b', 'main', remote]);
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('config', 'core.autocrlf', 'false');
    git('add', '-A');
    git('commit', '-m', 'base');
    git('remote', 'add', 'origin', remote);
    git('push', '-u', 'origin', 'main');

    const log = join(tmp, 'gh.log');
    await writeFile(join(tmp, 'fake-gh.mjs'), FAKE_GH);
    process.env.FAKE_GH_LOG = log;
    process.env.ZARK_GH = JSON.stringify([process.execPath, join(tmp, 'fake-gh.mjs')]);
    const { startServer } = await import('../src/index.js');

    const running = await startServer({ dir, port: 0, uiDir: UI });
    try {
      const { service } = running;
      // An edit made in the UI: new external system, connected and drawn.
      const edit = await service.store.apply(
        [
          { op: 'entity.create', entity: { id: 'spam-filter', name: 'Spam filter', kind: 'system', external: true } },
          { op: 'connection.create', from: 'papo-app', connection: { id: 'score', to: 'spam-filter', label: 'Checks for spam' } },
          { op: 'drawing.place', drawing: 'context', nodes: [{ id: 'spam-filter', x: 320, y: 320 }] },
          { op: 'drawing.draw-edges', drawing: 'context', edges: [{ ref: 'papo-app.score', shape: 'straight' }] },
        ],
        'ui',
      );
      expect(edit.ok, edit.error).toBe(true);
      // A change outside architecture/ must stay out of the commit.
      await writeFile(join(repo, 'app.txt'), 'unrelated change\n');

      const preview = await service.prPreview();
      expect(preview.blockers).toEqual([]);
      expect(preview.title).toBe('Architecture: adds Spam filter and a connection, adjusts Context');
      expect(preview.branch).toMatch(/^zark\//);
      expect(preview.images.map((i) => i.drawing)).toEqual(['context']);

      // The single confirmation.
      const pr = await service.createPr();
      expect(pr.url).toBe('https://github.com/acme/zark/pull/1');

      // Branch pushed, never forced; commit holds architecture/ only, PNG included.
      expect(git('ls-remote', '--heads', 'origin', pr.branch)).toContain(pr.commit);
      const files = git('show', '--name-only', '--format=', pr.commit).split('\n');
      expect(files).toContain('architecture/rendered/context.png');
      expect(files).toContain('architecture/entities/spam-filter.yaml');
      expect(files.every((f) => f.startsWith('architecture/'))).toBe(true);
      expect(git('status', '--porcelain', '--', 'app.txt')).toBe('M app.txt');
      expect(git('log', '-1', '--format=%s', pr.commit)).toBe(preview.title);

      // gh pr create got the generated title and body with pinned images.
      const calls = (await readFile(log, 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as string[]);
      const create = calls.find((c) => c[0] === 'pr' && c[1] === 'create')!;
      const body = create[create.indexOf('--body') + 1];
      expect(create[create.indexOf('--title') + 1]).toBe(preview.title);
      expect(create[create.indexOf('--base') + 1]).toBe('main');
      expect(body).toContain('## Summary\n- Entity added: Spam filter (system, external)');
      expect(body).toContain('- New connection: Papo app -> Spam filter ("Checks for spam")');
      expect(body).toContain(`https://github.com/acme/zark/blob/${pr.commit}/architecture/rendered/context.png?raw=true`);
      expect(body).toMatch(/## Validation\n0 errors/);

      // The committed PNG is current: `zark render --check` would pass.
      const { renderedProblems } = await import('../src/index.js');
      expect(await renderedProblems(service.project)).toEqual([]);
    } finally {
      await running.stop();
      delete process.env.ZARK_GH;
    }
  }, 180_000);
});
