import { describe, expect, it } from 'vitest';
import { gitlab, github, providerFor, remoteHost } from '../src/providers.js';

describe('PR/MR providers', () => {
  it('reads the host of https, ssh and scp-style remotes', () => {
    expect(remoteHost('https://github.com/acme/zark.git')).toBe('github.com');
    expect(remoteHost('https://oauth2:tok@gitlab.example.com/group/sub/zark.git')).toBe('gitlab.example.com');
    expect(remoteHost('ssh://git@gitlab.com:2222/acme/zark.git')).toBe('gitlab.com');
    expect(remoteHost('git@gitlab.com:acme/zark.git')).toBe('gitlab.com');
    expect(remoteHost('/tmp/remote.git')).toBeUndefined();
  });

  it('picks GitLab from the remote host, GitHub otherwise, and zark.yaml wins', () => {
    expect(providerFor('git@gitlab.com:acme/zark.git').name).toBe('gitlab');
    expect(providerFor('https://github.com/acme/zark.git').name).toBe('github');
    expect(providerFor(undefined).name).toBe('github');
    expect(providerFor('https://git.acme.dev/acme/zark.git', 'gitlab').name).toBe('gitlab');
    expect(providerFor('git@gitlab.com:acme/zark.git', 'github').name).toBe('github');
  });

  it('builds raw image URLs pinned to a commit', () => {
    expect(github.blobUrl('acme/zark', 'abc', 'architecture/rendered/x.png')).toBe('https://github.com/acme/zark/blob/abc/architecture/rendered/x.png?raw=true');
    expect(providerFor('https://git.acme.dev/g/zark.git', 'gitlab').blobUrl('g/zark', 'abc', 'a/x.png')).toBe('https://git.acme.dev/g/zark/-/raw/abc/a/x.png');
    expect(gitlab().noun).toBe('MR');
  });
});
