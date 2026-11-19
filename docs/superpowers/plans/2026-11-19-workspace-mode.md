# Workspace Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `zark dev --workspace [folder]` serves every repo under a folder (each with its own `architecture/`) on one port and one token, with the full editable UI per repo under `/r/<repo>/`.

**Architecture:** One Hono root app. For each repo, the existing `ProjectStore` + `ZarkService` + `createApp`, mounted at `/r/<repo>` with `app.route()`. One shared Chromium. The UI derives an API prefix from `location.pathname`. `.zark/server.json` gains an optional `base` so `zark mcp` and the VS Code extension reach the right sub-app.

**Tech Stack:** TypeScript, Node 22+, Hono + @hono/node-server, chokidar, playwright-core, React (UI), vitest.

**Spec:** `docs/superpowers/specs/2026-11-19-workspace-mode-design.md`

## Global Constraints

- Single-repo `zark dev`, `startServer`, `createApp` and the file format behave exactly as today. Every existing test keeps passing unchanged.
- Repo = direct child `<root>/<name>` containing `architecture/zark.yaml`. No recursion. Sorted by name. Key = folder name. URL prefix = `/r/${encodeURIComponent(name)}`.
- No repos found: error `No repos with architecture/zark.yaml under <root>`.
- `server.json` shape: `{ port, token, pid, base? }`. A missing `base` means `""`.
- Without `--port`: try 4317, then fall back to a free port. An explicit `--port` that is taken fails as today.
- CLI, MCP and validation strings are in English. UI strings go in both EN and PT dictionaries (`packages/ui/src/i18n-dict.ts`).
- Run all tests with `pnpm test` and types with `pnpm typecheck`. UI-in-browser tests need `pnpm --filter @zark/ui build` first (they skip otherwise).

## Review Focus

1. Repo folder name with a space or non-ASCII character (`my repo`, `serviço`). Expect it to be listed, open at its encoded prefix, and accept edits. Test in Task 3.
2. The same entity id (`user`) in two repos. Expect an edit through `/r/a` to change only repo `a`'s file and only repo `a`'s SSE stream to emit. Test in Task 3.
3. A repo whose model has validation errors. Expect it to load and report its error count in `/api/workspace`, and not block the other repos. Test in Task 3.
4. Requests under the prefix without a token, or with a foreign `Host`. Expect 401/403, just like at the root. Test in Task 3.
5. A render triggered from a workspace repo. Expect Chromium to open `/r/<repo>/render/...` with the token, and the PNG to land in that repo's `rendered/`. Test in Task 6 (browser test).

---

### Task 1: Discover the workspace repos

**Files:**
- Create: `packages/server/src/workspace.ts`
- Modify: `packages/server/src/index.ts` (add `export * from './workspace.js'`)
- Test: `packages/server/test/workspace.test.ts`

**Interfaces:**
- Produces: `interface WorkspaceRepo { key: string; prefix: string; root: string; dir: string }` (`root` = repo folder, `dir` = `<root>/architecture`). `discoverWorkspace(root: string): Promise<WorkspaceRepo[]>`.

- [ ] **Step 1: Write the failing tests** in `workspace.test.ts`. Make a temp folder with `b/architecture/zark.yaml`, `a/architecture/zark.yaml`, `my repo/architecture/zark.yaml`, `no-arch/README.md`, and `deep/x/architecture/zark.yaml`.
  - `finds direct children only, sorted`: the keys are `['a', 'b', 'my repo']`, and the prefix of `my repo` is `/r/my%20repo`.
  - `errors when there are no repos`: an empty temp folder rejects with `/No repos with architecture\/zark.yaml under/`.
- [ ] **Step 2: Run** `pnpm vitest run packages/server/test/workspace.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `discoverWorkspace`.** Use `readdir(root, { withFileTypes: true })`, keep the directories, check `existsSync(join(root, name, 'architecture', 'zark.yaml'))`, then sort with `localeCompare`.
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): discover workspace repos`.

### Task 2: Shared Chromium for renderers

**Files:**
- Modify: `packages/server/src/render.ts` (`Renderer`)
- Modify: `packages/server/src/service.ts` (constructor and `close()`)
- Test: `packages/server/test/workspace.test.ts`

**Interfaces:**
- Produces: `class SharedBrowser { constructor(launch?: () => Promise<Browser>); get(): Promise<Browser>; close(): Promise<void> }`. It launches lazily, at most once. The default `launch` is the existing download-on-first-use logic, moved out of `Renderer.launch`.
- `new Renderer(baseUrl, token, shared?: SharedBrowser)`: without `shared`, the renderer owns a private `SharedBrowser` and `close()` closes it (today's behavior). With `shared`, `Renderer.close()` does not close the browser.
- `new ZarkService(store, baseUrl, token, opts?: { browser?: SharedBrowser })` passes `opts.browser` to the `Renderer`.

- [ ] **Step 1: Write the failing test** `shared browser launches once and survives a renderer close`. Use a fake `launch` that counts calls and returns `{ close: vi.fn() } as any`. Call `get()` on two renderers' browser source in parallel and expect `launch` to have been called once. Close one renderer and expect the fake `close` not to have been called. `shared.close()` calls it once.
- [ ] **Step 2: Run the test.** Expected: FAIL.
- [ ] **Step 3: Implement** `SharedBrowser` in `render.ts` and wire it into `Renderer` and `ZarkService`.
- [ ] **Step 4: Run** `pnpm vitest run packages/server/test/workspace.test.ts packages/server/test/render-status.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): renderers can share one Chromium`.

### Task 3: `startWorkspace`: mount the repos under one server

**Files:**
- Modify: `packages/server/src/http.ts`. Extract the Host/Origin + token middleware into `guard(app: Hono, port: () => number, token: string)`, and add `AppOptions.serveUi?: boolean` (default `true`; `false` skips the `app.get('*')` UI catch-all).
- Modify: `packages/server/src/workspace.ts` (`startWorkspace`)
- Modify: `packages/server/src/index.ts`. Export `serverFile`. `findRunning` returns `{ port, token, base }`, with `base` defaulting to `''`.
- Test: `packages/server/test/workspace-http.test.ts`

**Interfaces:**
- Consumes: `discoverWorkspace` (Task 1), `SharedBrowser` and the `ZarkService` opts (Task 2).
- Produces:
  - `interface WorkspaceOptions { root: string; port?: number; host?: string; uiDir?: string; mcp?: (s: ZarkService) => McpHttpHandler; watch?: boolean; advertise?: boolean }`.
  - `interface WorkspaceEntry { key: string; prefix: string; name: string; dir: string; drawings: number; errors: number; warnings: number; running?: { url: string } }`.
  - `interface RunningWorkspace extends Started { token: string; repos: WorkspaceEntry[]; services: Map<string, ZarkService>; stop(): Promise<void> }`.
  - `startWorkspace(opts: WorkspaceOptions): Promise<RunningWorkspace>`.
- Behavior to pin:
  - The port is 4317 when `opts.port` is `undefined`, with a retry on `0` after `EADDRINUSE`. An explicit port does not retry.
  - Each sub-app gets `baseUrl = () => \`http://127.0.0.1:${port}${prefix}\``.
  - `GET /api/workspace` → `{ repos: WorkspaceEntry[] }`. `name` comes from `project.config.name`, and the counts come from `store.problems` by severity.
  - A repo for which `findRunning(dir)` succeeds is not loaded. It is listed with `running.url = http://127.0.0.1:<p>/?token=<t>` and zero counts, and its `server.json` is not touched.
  - A repo whose `store.load()` throws is left out with a `console.warn` naming the folder and the error.
  - With `advertise`, write `{ port, token, pid, base: prefix }` to each loaded repo's `serverFile(dir)`, and on `stop()` remove only those files. `stop()` closes every service, then the `SharedBrowser`, then the server.
  - The root app applies `guard`, mounts each sub-app at its prefix, then adds the UI catch-all for every other path (the same `<base href="/">` HTML as today). The simplest route is to build the UI handler with `createApp({ ..., serveUi: true })` logic factored into `serveUi(app, uiDir)`.

- [ ] **Step 1: Write the failing tests.** Copy `examples/ai-chat/architecture` into `<tmp>/a/architecture` and `<tmp>/my repo/architecture`. In `<tmp>/bad/architecture`, copy it as well, then corrupt one connection target so validation reports an error. Start with `startWorkspace({ root: tmp, port: 0, watch: true, advertise: true })`.
  - `lists the repos`: `GET /api/workspace` returns the keys `['a', 'bad', 'my repo']`, `bad.errors > 0` and `a.errors === 0`.
  - `edits only the addressed repo`: apply an `entity.update` (same shape as the existing `http.test.ts` edit) to `user` through `/r/a/api/...`. Expect `a/architecture/entities/user.yaml` to change and `my repo/architecture/entities/user.yaml` to be byte-identical to before. Open an SSE on `/r/my%20repo/api/events` beforehand and expect no `model.changed` event within 500 ms.
  - `guards prefixed routes`: `GET /r/a/api/model` without a token returns 401, and with `Host: evil:1` returns 403.
  - `advertises base`: `a/.zark/server.json` has `base: '/r/a'`, and `findRunning(<tmp>/a/architecture)` returns `base: '/r/a'`. After `stop()`, the file is gone.
  - `skips a repo with a live server`: run `startServer({ dir: <tmp2>/c/architecture, port: 0, advertise: true })` first, then `startWorkspace` on `<tmp2>`. Expect the entry `c` to have `running.url` containing that server's port, and `services.has('c')` to be false.
  - `falls back from a taken default port`: occupy 4317 with a bare `net` server, start without `port`, and expect `port !== 4317`. Skip the test if 4317 was already taken before the test.
- [ ] **Step 2: Run** `pnpm vitest run packages/server/test/workspace-http.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `guard`, `serveUi`, `serveUi?: boolean` and `startWorkspace`, and extend `findRunning`.
- [ ] **Step 4: Run** `pnpm vitest run packages/server`. Expected: PASS (the existing `http.test.ts` included).
- [ ] **Step 5: Commit** `feat(server): startWorkspace serves many repos under /r/<repo>`.

### Task 4: `zark mcp` and the VS Code extension honor `base`

**Files:**
- Modify: `packages/mcp/src/index.ts:30-36` (delegate to `` `http://127.0.0.1:${running.port}${running.base}/mcp` ``)
- Modify: `packages/vscode/src/extension.ts`: `ServerInfo.base?: string`, used in `healthy`, `modelSummary` and every other `/api/...` fetch
- Modify: `packages/vscode/src/target.ts`: `drawingUrl(port: number, token: string, fragment: string, base = ''): string` → `` `http://127.0.0.1:${port}${base}/?token=...${fragment}` ``
- Test: `packages/vscode/test/target.test.ts`, `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `drawingUrl with base`: `drawingUrl(9, 't', '#d=x', '/r/a')` returns `'http://127.0.0.1:9/r/a/?token=t#d=x'`. Without `base`, the URL is unchanged from today.
  - In `mcp.test.ts`, following its existing delegation test (if there is none, start a `startWorkspace` with one repo): `zark mcp` delegation lists tools through the workspace prefix.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm vitest run packages/vscode packages/mcp && pnpm --filter zark-vscode smoke`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: zark mcp and VS Code reuse a workspace server`.

### Task 5: UI API prefix

**Files:**
- Create: `packages/ui/src/route.ts`
- Modify: `packages/ui/src/api.ts` (`api()`, `getModel`, `subscribe`, `readToken`, `readOnly`)
- Modify: `packages/ui/src/main.tsx:55` (render route match)
- Test: `packages/ui/test/route.test.ts`

**Interfaces:**
- Produces (pure, no `window`):
  - `repoPrefix(pathname: string): string`: `'/r/a'` for `/r/a/` or `/r/a/render/drawing/x`, `'/r/my%20repo'` kept encoded, and `''` otherwise.
  - `renderRoute(pathname: string): { kind: 'drawing' | 'flow'; id: string } | undefined`: accepts an optional `/r/<repo>` prefix.
- In `api.ts`: `export const prefix = repoPrefix(location.pathname)`. `api()` fetches `prefix + path`, and so do the SSE URL and `getModel`. `readToken` and `readOnly` use `renderRoute(location.pathname)` instead of `startsWith('/render/')`.

- [ ] **Step 1: Write the failing tests** for `repoPrefix` (the four cases above plus `/` → `''`) and for `renderRoute` (`/render/flow/f` → flow f, `/r/a/render/drawing/x` → drawing x, `/r/a/` → `undefined`).
- [ ] **Step 2: Run** `pnpm vitest run packages/ui/test/route.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `route.ts` and switch `api.ts` and `main.tsx` over to it.
- [ ] **Step 4: Run** `pnpm vitest run packages/ui && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): API and render routes accept a /r/<repo> prefix`.

### Task 6: UI workspace list and repo switcher

**Files:**
- Create: `packages/ui/src/panels/Workspace.tsx` (`WorkspaceHome` for `/` and `RepoSwitcher` for the top bar)
- Modify: `packages/ui/src/api.ts`: `getWorkspace(): Promise<WorkspaceEntry[] | undefined>`. It calls `GET /api/workspace` without the prefix and returns `undefined` on 404 (single repo) or when `readOnly`.
- Modify: `packages/ui/src/main.tsx` (at `/`, when `getWorkspace()` returns a list, render `WorkspaceHome` instead of `App`), `packages/ui/src/App.tsx` (mount `RepoSwitcher` in the top bar when `prefix !== ''`)
- Modify: `packages/ui/src/i18n-dict.ts` (EN + PT keys: `workspace.title`, `workspace.drawings`, `workspace.errors`, `workspace.warnings`, `workspace.runningElsewhere`, `workspace.switch`)
- Modify: `packages/ui/src/types.ts` (`WorkspaceEntry`, same shape as Task 3)
- Test: `packages/server/test/workspace-ui.test.ts` (browser, same skip pattern as `lang-ui.test.ts`)

- [ ] **Step 1: Write the failing browser test.** Start a `startWorkspace` over two copies of the example (`a`, `b`) with `uiDir: UI`.
  - Open `/?token=…`. The list shows `a` and `b`. Click `b` and expect the URL `/r/b/`, with the `New drawing` button visible.
  - Use the repo switcher to choose `a`. The URL is `/r/a/` and the model loads without a token in the URL.
  - `POST /r/a/api/render` for the `context` drawing writes `a/architecture/rendered/context.png` and leaves `b/architecture/rendered/context.png` unchanged (Review Focus 5).
- [ ] **Step 2: Run** `pnpm --filter @zark/ui build && pnpm vitest run packages/server/test/workspace-ui.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the components. Follow the existing panel style and `tr()` for every string. A repo with `running` links to `running.url` and shows `workspace.runningElsewhere`.
- [ ] **Step 4: Run** the same command plus `pnpm vitest run packages/ui/test/i18n.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): workspace repo list and switcher`.

### Task 7: CLI `zark dev --workspace` and README

**Files:**
- Modify: `packages/cli/src/main.ts`. Add the `workspace: { type: 'boolean' }` option. Remove `default: 'architecture'` from `dir` and apply the default inside `main` (`dir: resolve(values.dir ?? 'architecture')`), passing `dirGiven: values.dir !== undefined` in `Ctx`. Add the USAGE line `dev --workspace [folder]   Serves every repo with architecture/ under folder`.
- Modify: `packages/cli/src/commands.ts` (`dev`): with `workspace`, `--dir` passed → error `--workspace and --dir cannot be used together` (exit 2). The root is `resolve(args[0] ?? '.')`. Call `startWorkspace({ root, port: port ? Number(port) : undefined, host, uiDir, watch: true, advertise: true, mcp: mcpHttpHandler })`. Print the root URL with the token, then one line per repo (`  a  ${url}/r/a/   MCP ${url}/r/a/mcp`, or `  c  running elsewhere: <url>`), then `New repos are picked up on restart.`
- Modify: `README.md`. Add a "Workspace (many repos)" section after Commands, plus the commands table row.
- Test: `packages/server/test/cli-workspace.test.ts`, following the `cli-scan.test.ts` pattern for running the CLI.

- [ ] **Step 1: Write the failing tests.**
  - `dev --workspace --dir x` exits 2 with `--workspace and --dir cannot be used together`.
  - `dev --workspace <empty tmp>` exits 1 with `No repos with architecture/zark.yaml under`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** the CLI changes and the README.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: all PASS.
- [ ] **Step 5: Manual check.** Run `pnpm zark dev --workspace <tmp with two example copies>`, open the printed URL, edit an entity in one repo, and confirm that only that repo's `git status` changes.
- [ ] **Step 6: Commit** `feat(cli): zark dev --workspace`.
