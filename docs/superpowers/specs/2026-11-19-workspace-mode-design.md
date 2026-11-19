# Workspace mode: many repos in one `zark dev`

Date: 2026-11-19. Status: draft.

## Intent

Teams keep many repositories cloned side by side in one folder, each with its own `architecture/`. Today `zark dev` serves exactly one `architecture/` folder, so seeing the documentation of 20 repos means 20 terminals, 20 ports and 20 tabs. Workspace mode runs one `zark dev` on the parent folder and shows every repo in the same web UI, with editing.

Each repo stays an independent Zark project: its own model, validation, git status, renders and PRs. The workspace only gathers them under one server and one UI.

## Goals

- `zark dev --workspace [folder]` (default: current folder) discovers the repos and serves all of them on one port with one session token.
- The UI lists the repos and switches between them; everything the single-repo UI does (edit, validate, render, diff, discard, PR) works per repo, unchanged.
- Each write goes to the repo that owns it; git and PRs run in that repo.
- Scale target: about 20 repos at once.
- `zark mcp` and the VS Code extension run inside one of the repos and reuse the workspace process, the same way they reuse a `zark dev` today.

## Non-goals

- Connections or references between repos (the "unified model", path B). Ids stay per repo; two repos may both have `auth`.
- One drawing showing entities from several repos.
- A workspace-level CI, validation or PR. The parent folder is not a git repo.
- `zark build --workspace` (static site of all repos). It can come later.
- Recursive discovery, or a config file that lists the repos.

## Anti-goals

- Changing the single-repo behavior of `zark dev` or the file format. A repo must look exactly the same to its own CI whether or not someone also opens it through a workspace.
- An edit in the workspace writing to, or failing because of, a repo other than the one being edited.

## Constraints found in the code

- `startServer({ dir })` builds one `ProjectStore` + `ZarkService` + Hono app (`createApp`). The git, render, diff and PR calls all derive from `service.dir`, so per-repo correctness already exists if there is one service per repo.
- The UI calls absolute paths (`/api/...`, `/api/events`), the render route is `/render/(drawing|flow)/<id>`, and the server injects `<base href="/">` so assets resolve from the root.
- `Renderer` takes `baseUrl()` and opens `${baseUrl}/render/...` in its own lazily launched Chromium.
- `.zark/server.json` (next to `architecture/`) holds `{ port, token, pid }`. `findRunning` (server), `zark mcp` (stdio delegation to `/mcp`) and the VS Code extension (`/api/health`, `drawingUrl`) read it.
- Host/Origin check and token check are middleware inside `createApp`.

## Approaches considered

1. **One process, one sub-app per repo under a path prefix (chosen).** For each repo, the existing store + service + `createApp`, mounted at `/r/<repo>/`. One port, one token, one Chromium. Costs: the UI API client, the render URL, `server.json` and its readers all need to learn a path prefix.
2. **N processes, one port each, plus an index page.** Almost no code change, but N ports and tokens, switching repos changes origin (a new tab), and up to N Chromiums. Weak "together" view.
3. **One snapshot holding every repo.** Best combined view, but every write endpoint, the store, undo and SSE become multi-project. Close to the unified model, which was rejected.

Picked 1 with the user: it gives editing per repo while reusing the whole server, and switching repos stays inside one page.

## Design

### Discovery (`packages/server`)

`discoverWorkspace(root)`: every direct child folder `<root>/<name>` that contains `architecture/zark.yaml`. The repo key is the folder name. Folders are sorted by name. No repo found is an error with a clear message ("No repos with architecture/zark.yaml under <root>"). A folder name that is not URL-safe is used encoded with `encodeURIComponent` in the prefix.

A repo whose project fails to load is skipped with a warning naming the folder and the error; the others still start. (Invalid models that load with problems are not failures: the store already loads them and reports problems.)

### Server

`startWorkspace({ root, port, host, uiDir, mcp })`:

- One shared token and one listening port.
- For each repo: `ProjectStore(<repo>/architecture).load()`, `watch()`, a `ZarkService` whose `baseUrl()` is `http://127.0.0.1:<port>/r/<repo>`, auto-render and render status enabled as in `zark dev`. Then `root.route('/r/<repo>', createApp({ service, mcp, port, ... }))` (without the UI catch-all; see below).
- All loaded eagerly at start (20 repos: YAML parse plus one chokidar watcher each is cheap). Lazy loading is left out until it is measured to matter.
- Shared Chromium: `Renderer` gets an optional shared browser so the 20 services launch at most one browser. Each service still renders only its own repo. A service's `close()` must not close a shared browser; only the workspace stop does.
- The workspace root app has its own Host/Origin and token middleware (the sub-apps keep theirs).
- Workspace endpoints, behind the same Host/Origin and token checks:
  - `GET /api/workspace`: `[{ key, name (zark.yaml name), dir, drawings, errors, warnings }]`, from each store.
  - `GET /api/events` at the root is not needed; each repo keeps its own `/r/<repo>/api/events`.
- UI static files and the SPA fallback are served once at the root for every path, including `/r/<repo>/...` (keep `<base href="/">` so assets come from `/assets`).
- Single-repo `startServer` and `createApp` keep working as today; `createApp` gets an option to skip its UI catch-all when mounted.

### `server.json` and the tools that read it

- In workspace mode each repo gets its own `<repo>/.zark/server.json` with `{ port, token, pid, base: "/r/<repo>" }`. `base` is optional; absent means `""` (today's single-repo file stays valid).
- If a repo already has a live `zark dev` (`findRunning` succeeds), the workspace does **not** load or watch it (two watchers and two auto-renderers on the same folder would see each other's writes as external edits). It appears in `/api/workspace` with `running: { url }` pointing at the existing server (`http://127.0.0.1:<port>/?token=<token>`, from its `server.json`), and the UI list links there. Its `server.json` is left alone. (Builder-check call, not discussed with the user.)
- `findRunning` returns `base`. `zark mcp` delegates to `${base}/mcp`. The VS Code extension uses `${base}/api/health` and builds the drawing URL with the prefix.
- On stop, the workspace removes only the `server.json` files it wrote.

### UI (`packages/ui`)

- API base: when `location.pathname` starts with `/r/<repo>/`, every API path, the SSE URL and the render route get the `/r/<repo>` prefix. Otherwise the prefix is empty (single repo, `zark build`).
- The render route match accepts the optional prefix: `/r/<repo>/render/drawing/<id>`. The same goes for the `/render/` checks in `readToken` and `readOnly` in `api.ts`.
- Workspace root `/`: when `GET /api/workspace` answers (it 404s on a single-repo server), the page shows the repo list (name, folder, drawing count, error/warning counts) and each entry opens `/r/<repo>/`.
- Inside a repo, the top bar shows a repo switcher (the same list) when running in a workspace. Switching navigates to the other `/r/<repo>/`; the token is already in `sessionStorage`, so no new token in the URL.
- Strings in the i18n dictionaries (EN and PT).

### CLI

- `zark dev --workspace [folder]`: mutually exclusive with `--dir`. Prints the root URL with the token, the list of repos with their prefixes, and the MCP URLs (`/r/<repo>/mcp`). `--host` and `--no-open` behave as in `zark dev`. Port: an explicit `--port` that is taken fails as today; without `--port`, the workspace tries 4317 and falls back to a free port (a single-repo `zark dev` often holds 4317, and readers find the port through `server.json`). (Builder-check call.)
- `parseArgs` has no optional-value flags: `--workspace` is a boolean and the folder is the first positional. `--dir` defaults to `architecture` in `cli/src/main.ts`, so the exclusivity check looks at whether `--dir` was actually passed.
- Other commands (`validate`, `render`, `pr`, ...) do not get `--workspace`; they run inside a repo as today.

## Errors and edge cases

- Empty folder or no repos: exit 1 with the message above.
- Repo folder removed while running: its watcher reports errors; the workspace keeps serving the others (no restart logic).
- New repo cloned while running: not picked up until restart (stated in the CLI output).
- Same token for all repos: a client with the token can edit any repo in the workspace. Acceptable: it is the same local user, and today's token already grants writes and PRs.

## Testing

- `discoverWorkspace`: finds direct children only, skips folders without `architecture/zark.yaml`, errors when none.
- Server: two fixture repos, the same entity id in both; a write through `/r/a/api/...` changes only repo `a`'s files; `/api/workspace` lists both; token and Host checks apply under the prefix.
- `server.json` with `base`: `findRunning` and `zark mcp` delegation use it; a file without `base` still works.
- UI: API path prefixing from `location.pathname` (unit test of the path helper).

## Left to the builder

- Exact component layout of the repo list page and the switcher, following the existing UI style.
- How the shared Chromium is passed into `Renderer` (constructor option or module-level singleton).
- Whether `/api/workspace` counts come from cached store problems or are recomputed on request.

## Amendment 2026-11-19: sidebar tree and recursive discovery

Requested by the user after validating on a real folder of 48 repos.

**What changed and why.** The first version kept discovery to direct children and a repo dropdown in the top bar. The user wants the workspace to read as one tree: every Zark doc under the folder, at any depth, laid out by folder hierarchy in the sidebar, with the workspace folder's name as the title. The non-goal "recursive discovery" no longer holds.

**Discovery.**
- Walk every descendant folder of the root and collect each folder `F` that has `F/architecture/zark.yaml`. Keep walking inside `F` too (a monorepo may hold nested docs), but never descend into `architecture/` folders.
- Skip folders whose name starts with `.` and folders named `node_modules`. Stop at depth 8. Unreadable folders are skipped silently. Symlinked folders are not followed.
- The repo key is the path relative to the root with `/` separators (`clients/acme/api`). The prefix is `/r/${encodeURIComponent(key)}` (the `/` becomes `%2F`), so the URL stays a single segment and the UI's `repoPrefix` regex is unchanged. Sorted by key.
- The root folder itself is not a repo, even if it has `architecture/`.

**`GET /api/workspace`.** Returns `{ name, repos }`, where `name` is the root folder's base name. Each entry gains `roots: { id, name }[]`: the drawings with no scope (the first level of that repo's tree), in model order. A `running` entry has `roots: []`.

**Sidebar (workspace mode only, `prefix !== ''`).**
- The title in the top bar shows the workspace `name` instead of the project name. The repo dropdown is removed.
- The left panel shows a tree built from the repo keys: intermediate folders are collapsible group nodes (no link), and repos are nodes labelled by their last path segment.
- The open repo is expanded and shows its full drawing tree, editable as today, nested under its repo node.
- Other repos start collapsed. Expanding one lists its `roots`; clicking a root opens `/r/<prefix>/#drawing=<id>`, and clicking the repo name opens `/r/<prefix>/`. Both are full page loads. A `running` repo links to `running.url`.
- The ancestor folders of the open repo start expanded. No persisted expand state.
- Single-repo mode and the `/` repo list page are unchanged.
