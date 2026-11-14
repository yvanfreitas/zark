import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { drawingUrl, findArchitectureDir, fragmentFor, webviewHtml } from '../src/target.js';

const arch = join('/repo', 'architecture');
const model = {
  config: { defaultDrawing: 'contexto' },
  drawings: [
    { id: 'contexto', nodes: { vtex: {}, sintese: {} } },
    { id: 'vtex', nodes: { gateway: {}, sintese: {} } },
  ],
};

describe('VS Code extension: file -> drawing URL', () => {
  it('finds the architecture dir by walking up to zark.yaml', () => {
    const exists = (p: string) => p === join(arch, 'zark.yaml');
    expect(findArchitectureDir(join(arch, 'entities', 'vtex.yaml'), exists)).toBe(arch);
    expect(findArchitectureDir(join('/elsewhere', 'x.yaml'), exists)).toBeUndefined();
  });

  it('maps drawings, flows and entities to the UI hash', () => {
    expect(fragmentFor(arch, join(arch, 'drawings', 'vtex.yaml'), model)).toBe('#drawing=vtex');
    expect(fragmentFor(arch, join(arch, 'flows', 'compra.yaml'), model)).toBe('#flow=compra');
    expect(fragmentFor(arch, join(arch, 'entities', 'gateway.yaml'), model)).toBe('#drawing=vtex');
    expect(fragmentFor(arch, join(arch, 'entities', 'sintese.yaml'), model)).toBe('#drawing=contexto');
    expect(fragmentFor(arch, join(arch, 'entities', 'orfa.yaml'), model)).toBe('#drawing=contexto');
    expect(fragmentFor(arch, join(arch, 'zark.yaml'), model)).toBe('#drawing=contexto');
    expect(fragmentFor(arch, join(arch, 'entities', 'x.yaml'))).toBe('');
  });

  it('builds a loopback URL and a webview locked to that server', () => {
    const url = drawingUrl(4317, 'a b', '#drawing=vtex');
    expect(url).toBe('http://127.0.0.1:4317/?token=a%20b#drawing=vtex');
    const html = webviewHtml(url, 4317);
    expect(html).toContain("frame-src http://127.0.0.1:4317;");
    expect(html).toContain('src="http://127.0.0.1:4317/?token=a%20b#drawing=vtex"');
    expect(html).not.toContain('script-src');
  });
});
