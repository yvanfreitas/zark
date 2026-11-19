/** `/r/<repo>` (still URL-encoded) when served by the workspace server, else ''. */
export function repoPrefix(pathname: string): string {
  return /^\/r\/[^/]+/.exec(pathname)?.[0] ?? '';
}

/** Panel-less route the renderer screenshots, with an optional `/r/<repo>` prefix. */
export function renderRoute(pathname: string): { kind: 'drawing' | 'flow'; id: string } | undefined {
  const m = /^(?:\/r\/[^/]+)?\/render\/(drawing|flow)\/([^/]+)\/?$/.exec(pathname);
  return m ? { kind: m[1] as 'drawing' | 'flow', id: decodeURIComponent(m[2]) } : undefined;
}

/** Browser URL for a server-returned root-relative render file URL (`/api/render/file?path=...`). */
export function renderFileUrl(prefix: string, url: string, token: string): string {
  return `${prefix}${url}&token=${encodeURIComponent(token)}`;
}
