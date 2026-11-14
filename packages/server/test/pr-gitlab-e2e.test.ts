// Fase 6 on GitLab, end to end: same flow as pr-e2e.test.ts, but the project
// picks `git.provider: gitlab` and a fake `glab` records its arguments.
// Skipped when the UI is not built.
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

const FAKE_GLAB = `
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_GLAB_LOG, JSON.stringify(args) + '\\n');
const cmd = args.slice(0, 2).join(' ');
if (cmd === 'auth status') process.exit(0);
if (cmd === 'repo view') { console.log(JSON.stringify({ path_with_namespace: 'acme/zark' })); process.exit(0); }
if (cmd === 'mr list') { console.log('[]'); process.exit(0); }
if (cmd === 'mr create') { console.log('Creating merge request in acme/zark\\n\\nhttps://gitlab.com/acme/zark/-/merge_requests/1'); process.exit(0); }
process.exit(2);
`;

describe.skipIf(!hasUi)('phase 6 with GitLab: from edit to MR', () => {
  it('opens an MR through glab with raw image URLs pinned to the commit', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'zark-mr-'));
    const repo = join(tmp, 'repo');
    const remote = join(tmp, 'remote.git');
    const dir = join(repo, 'architecture');
    await cp(EXAMPLE, dir, { recursive: true });
    // A local bare remote has no host to detect from, so zark.yaml picks GitLab.
    const cfg = join(dir, 'zark.yaml');
    await writeFile(cfg, (await readFile(cfg, 'utf8')).replace('  branchPrefix: zark/', '  branchPrefix: zark/\n  provider: gitlab'));
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

    const log = join(tmp, 'glab.log');
    await writeFile(join(tmp, 'fake-glab.mjs'), FAKE_GLAB);
    process.env.FAKE_GLAB_LOG = log;
    process.env.ZARK_GLAB = JSON.stringify([process.execPath, join(tmp, 'fake-glab.mjs')]);
    const { startServer } = await import('../src/index.js');

    const running = await startServer({ dir, port: 0, uiDir: UI });
    try {
      const { service } = running;
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

      const preview = await service.prPreview();
      expect(preview.blockers).toEqual([]);
      expect(preview.provider).toEqual({ name: 'gitlab', noun: 'MR' });

      const mr = await service.createPr();
      expect(mr.url).toBe('https://gitlab.com/acme/zark/-/merge_requests/1');
      expect(git('ls-remote', '--heads', 'origin', mr.branch)).toContain(mr.commit);

      const calls = (await readFile(log, 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as string[]);
      expect(calls.some((c) => c[0] === 'mr' && c[1] === 'list' && c.includes(mr.branch))).toBe(true);
      const create = calls.find((c) => c[0] === 'mr' && c[1] === 'create')!;
      const body = create[create.indexOf('--description') + 1];
      expect(create[create.indexOf('--title') + 1]).toBe(preview.title);
      expect(create[create.indexOf('--target-branch') + 1]).toBe('main');
      expect(create[create.indexOf('--source-branch') + 1]).toBe(mr.branch);
      expect(create).toContain('--yes');
      expect(body).toContain('## Summary\n- Entity added: Spam filter (system, external)');
      expect(body).toContain(`https://gitlab.com/acme/zark/-/raw/${mr.commit}/architecture/rendered/context.png`);
    } finally {
      await running.stop();
      delete process.env.ZARK_GLAB;
    }
  }, 180_000);
});
