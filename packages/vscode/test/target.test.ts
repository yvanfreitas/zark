import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { drawingUrl, findArchitectureDir, fragmentFor, webviewHtml } from '../src/target.js';

const arch = join('/repo', 'architecture');
const model = {
  config: { defaultDrawing: 'context' },
  drawings: [
    { id: 'context', nodes: { platform: {}, auth: {} } },
    { id: 'platform', nodes: { 'bot-queue': {}, auth: {} } },
  ],
};

describe('VS Code extension: file -> drawing URL', () => {
  it('finds the architecture dir by walking up to zark.yaml', () => {
    const exists = (p: string) => p === join(arch, 'zark.yaml');
    expect(findArchitectureDir(join(arch, 'entities', 'auth.yaml'), exists)).toBe(arch);
    expect(findArchitectureDir(join('/elsewhere', 'x.yaml'), exists)).toBeUndefined();
  });

  it('maps drawings, flows and entities to the UI hash', () => {
    expect(fragmentFor(arch, join(arch, 'drawings', 'platform.yaml'), model)).toBe('#drawing=platform');
    expect(fragmentFor(arch, join(arch, 'flows', 'history-is-saved.yaml'), model)).toBe('#flow=history-is-saved');
    expect(fragmentFor(arch, join(arch, 'entities', 'bot-queue.yaml'), model)).toBe('#drawing=platform');
    expect(fragmentFor(arch, join(arch, 'entities', 'auth.yaml'), model)).toBe('#drawing=context');
    expect(fragmentFor(arch, join(arch, 'entities', 'orphan.yaml'), model)).toBe('#drawing=context');
    expect(fragmentFor(arch, join(arch, 'zark.yaml'), model)).toBe('#drawing=context');
    expect(fragmentFor(arch, join(arch, 'entities', 'x.yaml'))).toBe('');
  });

  it('builds a loopback URL and a webview locked to that server', () => {
    const url = drawingUrl(4317, 'a b', '#drawing=platform');
    expect(url).toBe('http://127.0.0.1:4317/?token=a%20b#drawing=platform');
    const html = webviewHtml(url, 4317);
    expect(html).toContain("frame-src http://127.0.0.1:4317;");
    expect(html).toContain('src="http://127.0.0.1:4317/?token=a%20b#drawing=platform"');
    expect(html).not.toContain('script-src');
  });
});
