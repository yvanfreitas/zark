// Pure helpers (no `vscode` import) so they can be unit tested.
import { dirname, join, relative, sep } from 'node:path';

/** Nearest ancestor of `file` holding a zark.yaml (the architecture dir). */
export function findArchitectureDir(file: string, exists: (path: string) => boolean): string | undefined {
  let dir = dirname(file);
  for (;;) {
    if (exists(join(dir, 'zark.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** The bits of the /api/model snapshot the mapping needs. */
export interface ModelSummary {
  config: { defaultDrawing?: string };
  drawings: { id: string; nodes?: Record<string, unknown> }[];
}

/**
 * Hash fragment the UI understands for a YAML file:
 * drawings/<id> -> #drawing=<id>, flows/<id> -> #flow=<id>,
 * entities/<id> -> first drawing that places it (else the default drawing).
 */
export function fragmentFor(archDir: string, file: string, model?: ModelSummary): string {
  const rel = relative(archDir, file).split(sep).join('/');
  const m = /^(drawings|flows|entities)\/([^/]+)\.yaml$/.exec(rel);
  if (!m) return model?.config.defaultDrawing ? `#drawing=${encodeURIComponent(model.config.defaultDrawing)}` : '';
  const [, kind, id] = m;
  if (kind === 'drawings') return `#drawing=${encodeURIComponent(id)}`;
  if (kind === 'flows') return `#flow=${encodeURIComponent(id)}`;
  const where = model?.drawings.find((d) => d.nodes && id in d.nodes)?.id ?? model?.config.defaultDrawing;
  return where ? `#drawing=${encodeURIComponent(where)}` : '';
}

/** Only the loopback server; the token travels in the query, as `zark dev` prints it. */
export function drawingUrl(port: number, token: string, fragment: string): string {
  return `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}${fragment}`;
}

/** Webview page: a full-size iframe; CSP allows only the local Zark server. */
export function webviewHtml(url: string, port: number): string {
  const esc = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://127.0.0.1:${port}; style-src 'unsafe-inline';">
<style>html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100%;overflow:hidden}</style>
</head>
<body><iframe src="${esc}" title="Zark"></iframe></body>
</html>`;
}
