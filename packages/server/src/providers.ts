import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export class ProviderError extends Error {}

export interface OpenPr {
  url: string;
  number: number;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
}

/** The hosting side of a pull/merge request. Git itself stays in git.ts. */
export interface PrProvider {
  name: 'github' | 'gitlab';
  /** "PR" on GitHub, "MR" on GitLab, for user-facing text. */
  noun: 'PR' | 'MR';
  cli: string;
  authOk(dir: string): Promise<boolean>;
  repoSlug(dir: string): Promise<string>;
  openPr(dir: string, pr: { title: string; body: string; base: string; head: string }): Promise<string>;
  findOpenPr(dir: string, branch: string): Promise<OpenPr | undefined>;
  editPr(dir: string, number: number, body: string): Promise<void>;
  /** URL that serves the raw file at a fixed commit (images in the description). */
  blobUrl(slug: string, sha: string, path: string): string;
}

async function run(cmd: string[], args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await exec(cmd[0], [...cmd.slice(1), ...args], { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    return stdout.trimEnd();
  } catch (err: any) {
    const detail = String(err.stderr || err.message).trim().split('\n')[0];
    throw new ProviderError(`${cmd[cmd.length - 1]} ${args.slice(0, 2).join(' ')}: ${detail}`);
  }
}

/**
 * `ZARK_GH` / `ZARK_GLAB` (JSON array, e.g. ["node","fake-gh.mjs"]) swap the CLI
 * for another executable; used by the end-to-end tests. Read per call.
 */
const cliFrom = (env: string, fallback: string): string[] => (process.env[env] ? JSON.parse(process.env[env]!) : [fallback]);

export const github: PrProvider = {
  name: 'github',
  noun: 'PR',
  cli: 'gh',
  authOk: (dir) => run(cliFrom('ZARK_GH', 'gh'), ['auth', 'status'], dir).then(() => true, () => false),
  repoSlug: async (dir) => JSON.parse(await run(cliFrom('ZARK_GH', 'gh'), ['repo', 'view', '--json', 'nameWithOwner'], dir)).nameWithOwner,
  openPr: async (dir, pr) =>
    (await run(cliFrom('ZARK_GH', 'gh'), ['pr', 'create', '--title', pr.title, '--body', pr.body, '--base', pr.base, '--head', pr.head], dir)).split('\n').pop()!,
  findOpenPr: async (dir) => {
    const json = await run(cliFrom('ZARK_GH', 'gh'), ['pr', 'view', '--json', 'url,number,state'], dir).catch(() => undefined);
    return json ? (JSON.parse(json) as OpenPr) : undefined;
  },
  editPr: async (dir, number, body) => {
    await run(cliFrom('ZARK_GH', 'gh'), ['pr', 'edit', String(number), '--body', body], dir);
  },
  blobUrl: (slug, sha, path) => `https://github.com/${slug}/blob/${sha}/${path}?raw=true`,
};

/** Host of a git remote: https://host/..., ssh://git@host/..., git@host:group/repo. */
export function remoteHost(remote: string): string | undefined {
  const url = /^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)/i.exec(remote);
  if (url) return url[1];
  return /^[^@\s]+@([^:]+):/.exec(remote)?.[1];
}

export function gitlab(host = 'gitlab.com'): PrProvider {
  const glab = () => cliFrom('ZARK_GLAB', 'glab');
  const STATE: Record<string, OpenPr['state']> = { opened: 'OPEN', closed: 'CLOSED', merged: 'MERGED', locked: 'CLOSED' };
  return {
    name: 'gitlab',
    noun: 'MR',
    cli: 'glab',
    authOk: (dir) => run(glab(), ['auth', 'status'], dir).then(() => true, () => false),
    repoSlug: async (dir) => JSON.parse(await run(glab(), ['repo', 'view', '-F', 'json'], dir)).path_with_namespace,
    openPr: async (dir, pr) => {
      const out = await run(glab(), ['mr', 'create', '--title', pr.title, '--description', pr.body, '--target-branch', pr.base, '--source-branch', pr.head, '--yes'], dir);
      return out.split('\n').map((l) => l.trim()).filter((l) => /^https?:\/\//.test(l)).pop() ?? out.split('\n').pop()!;
    },
    findOpenPr: async (dir, branch) => {
      const json = await run(glab(), ['mr', 'list', '--source-branch', branch, '-F', 'json'], dir).catch(() => undefined);
      const list = json ? (JSON.parse(json) as { iid: number; web_url: string; state: string }[]) : [];
      const mr = list.find((m) => m.state === 'opened') ?? list[0];
      return mr && { url: mr.web_url, number: mr.iid, state: STATE[mr.state] ?? 'CLOSED' };
    },
    editPr: async (dir, number, body) => {
      await run(glab(), ['mr', 'update', String(number), '--description', body], dir);
    },
    blobUrl: (slug, sha, path) => `https://${host}/${slug}/-/raw/${sha}/${path}`,
  };
}

/** `git.provider` from zark.yaml wins; otherwise a remote host with "gitlab" picks GitLab. */
export function providerFor(remote: string | undefined, configured?: 'github' | 'gitlab'): PrProvider {
  const host = remote ? remoteHost(remote) : undefined;
  if (configured === 'gitlab' || (!configured && host?.includes('gitlab'))) return gitlab(host ?? 'gitlab.com');
  return github;
}
