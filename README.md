# Zark

[![npm](https://img.shields.io/npm/v/@ewcodes/zark)](https://www.npmjs.com/package/@ewcodes/zark) [![ci](https://github.com/yvanfreitas/zark/actions/workflows/ci.yml/badge.svg)](https://github.com/yvanfreitas/zark/actions/workflows/ci.yml) [![license](https://img.shields.io/npm/l/@ewcodes/zark)](LICENSE)

Architecture documentation as code. The YAML files in `architecture/` are the only state. The web UI, the MCP server and the CLI read and write those same files, so there is no sync between the tool and the repository. Collaboration happens through pull requests.

- **Entities** (`entities/<id>.yaml`): actors, systems, apps, stores and components, in the C4 hierarchy. Outgoing connections live in the source entity's file.
- **Drawings** (`drawings/<id>.yaml`): box positions and connector routing. Presentation only, always by reference to the model.
- **Flows** (`flows/<id>.yaml`): step-by-step walks over the connections, with parallel branches, alternatives and subflows, played back on a drawing.
- **Validation**: every problem has a code (`E001`…`W040`), a file and a line. Errors fail CI and block writes from the UI and the MCP server.

The CLI, the MCP server, PR texts and validation messages are in English. The web UI is in English by default and can be switched to Portuguese with the **EN | PT** control in the top bar (the choice is kept per browser). Rendered PNGs are always drawn in English, since they are committed artifacts.

## Example: Papo, an AI chat app on AWS

`examples/ai-chat/architecture/` is a complete, fictional model: **Papo**, a chat app whose messages go through an Amazon API Gateway WebSocket API, fan out on an SNS topic to SQS queues, and wake up an AI bot running on AWS Lambda (18 entities, 20 connections, 3 drawings, 2 flows). Its two components, `reply-builder` and `moderation-client`, have generated code graphs (`code/*.yaml`, from the sample TypeScript in `examples/ai-chat/src`).

- **Context** drawing: the user, the Papo app, Auth (Amazon Cognito), the Papo platform and two external services (an LLM provider and a moderation service).
- **Papo platform** drawing (drill-down into the platform): WebSocket API, message handler (Lambda), messages topic (SNS), bot and history queues plus a dead-letter queue (SQS), bot orchestrator and history writer (Lambda), conversation history (DynamoDB) and attachments (S3).
- **User chats with the bot** flow: parallel delivery to history and bot, alternatives for approved or blocked content, a reply step and the answer pushed back over the WebSocket.
- **History is saved** flow: the history queue, its writer and the dead-letter path.

The example lives in this repository (it is not part of the npm package). From a clone:

```bash
git clone https://github.com/yvanfreitas/zark && cd zark
npx @ewcodes/zark dev --dir examples/ai-chat/architecture
```

## Install

Requires Node 22 or newer.

```sh
npm i -D @ewcodes/zark   # or: pnpm add -D @ewcodes/zark
npx zark init          # creates architecture/ with zark.yaml, catalog.yaml and an empty drawing
npx zark dev           # starts the UI, API and MCP at http://127.0.0.1:4317
```

The Chromium used to render PNGs is downloaded on the first render, not at install time.

## Commands

| Command | What it does |
| --- | --- |
| `zark init` | Creates `architecture/`, adds `.zark/` to `.gitignore` and forces LF on the YAML files via `.gitattributes` |
| `zark dev [--port 4317] [--no-open]` | Local server, editable UI and MCP over HTTP at `/mcp` |
| `zark mcp` | MCP over stdio. Delegates to a `zark dev` running on the same folder, if any |
| `zark validate [--format json]` | Lists problems. Exits with 1 when there are errors |
| `zark fmt [--check]` | Rewrites files in canonical format, or only checks |
| `zark render [--check] [id...]` | Renders PNGs into `architecture/rendered/`, or checks they are up to date |
| `zark scan [--check] [component...]` | (alpha) Generates `architecture/code/<component>.yaml` (C4 level 4) for components with `source`, or checks the files are up to date |
| `zark diff [--base ref] [--format text\|markdown]` | Semantic diff against a git ref (default: `origin/<baseBranch>`) |
| `zark pr [--yes] [--title t]` | Branch, render, commit of `architecture/`, push and `gh pr create`, with preview and confirmation |
| `zark build --out dir` | Read-only static site (drawings and flow player) |
| `zark export <format> [flow] [--out file]` | `mermaid` (flows), `json` (model), `structurizr` (workspace JSON) or `icepanel-yaml` (IcePanel model) |
| `zark migrate [--check]` | Updates the files to the current format version (`schema` in `zark.yaml`) |
| `zark import [format] <file> [--yes]` | Imports a Structurizr workspace or an IcePanel model (JSON/YAML). Without a format, detects it from the content |
| `zark schema --out dir` | Writes the JSON Schemas of the files |

Every command accepts `--dir <folder>` (default: `architecture`).

Git and PRs use the `git` and provider CLI already authenticated on the machine: `gh` on GitHub, `glab` on GitLab (where the PR becomes an MR). The provider comes from `git.provider: github | gitlab` in `zark.yaml`; without it, a remote whose host contains `gitlab` picks GitLab. Zark never asks for, reads or stores a token, and never runs `push --force`.

## Code level (TypeScript, alpha)

> **Alpha.** Opt-in and off by default: nothing is scanned, parsed or generated until a component has `source`, so projects that do not use it pay nothing. The file format and the counts may still change between minor versions; regenerate with `zark scan` after upgrading.

Set `source` on a component (a folder, a file, or a list of them, relative to the repository root) and `zark scan` writes `architecture/code/<component>.yaml`: its modules, the pieces in them (functions, classes, types) and the calls and imports between them. The files are generated, never edit them. `zark scan --check` exits with 1 when one is out of date, and `zark pr` runs `zark scan` first so the graphs land in the same PR.

Calls that cannot be pinned to a piece are counted, not guessed:

- `unresolved`: calls whose target the scanner cannot determine: dynamic or untyped receivers, globals such as `console.log` and built-in methods such as `items.map(...)`. Calls to non-exported local declarations are internal: they are neither drawn nor counted
- `external`: call sites into packages outside the repository (counted per call, not per import). Workspace packages count as external
- `unowned`: call sites into repository files that no component claims in `source` (also per call)

Run `zark scan --check` on every PR, not only on changes under `architecture/`: a source-only change is what makes a graph stale. Use a separate workflow without a `paths` filter (a filter applies to the whole workflow), with `@ewcodes/zark` as a devDependency:

```yaml
name: architecture-scan
on: pull_request
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: npx zark scan --check
```

`source` entries are paths or globs relative to the repository root; absolute paths and `..` are rejected (E014). Optional `code.tsconfig` and `code.exclude` in `zark.yaml` pick the tsconfig used for path aliases (a `code.tsconfig` that cannot be read is reported by `zark scan`) and the globs to skip (default: `**/*.{test,spec}.*`, `**/__tests__/**`, `**/*.d.ts`, `**/generated/**`).

## Icons

Entities accept `icon: <set>:<name>`: generic icons from [Lucide](https://lucide.dev) (`lucide:database`), brands, languages and frameworks from [Simple Icons](https://simpleicons.org) (`si:python`, `si:kubernetes`), and your own packs declared in `zark.yaml` (`aws:sqs`). The inspector suggests icons from the entity's technologies, name and kind; the MCP server has `search_icons` and `suggest_icons`. The official AWS, Azure and Google Cloud sets are not bundled because their terms do not allow redistribution inside third-party software: download one and point a pack at it. Licenses and details in [ICONS.md](ICONS.md).

## Import and export

The UI (empty project or command palette) and the CLI accept the same files. An import goes through the same validation as any write: if it would introduce an error, nothing is written. Ids that already exist in the project get a suffix (`auth-2`).

**Structurizr** (workspace JSON): `person` becomes `actor`, `softwareSystem` becomes `system` (`location: External` becomes `external`), `container` becomes `app`, or `store` when it has the `Database` tag, and `component` stays `component`. Relationships become connections on the source; implied ones (`linkedRelationshipId`) are not duplicated. Landscape, context, container and component views become drawings with the matching scope; positions are divided by 2 (Structurizr boxes are larger) and snapped to the grid. Views without positions are laid out automatically. Dynamic and deployment views are not imported. On export, Zark fields that Structurizr lacks go into `properties` with a `zark:` prefix, and an export followed by an import reproduces the model.

**IcePanel** (`LandscapeImportData`, schema at `https://api.icepanel.io/v1/schemas/LandscapeImportData`): the `actor`, `system`, `app`, `store` and `component` types map one to one. Domains do not exist in Zark, so their children go to the root; IcePanel groups are ignored (in Zark, groups are frames of each drawing). The format has no diagrams: the import creates an `icepanel` drawing with the root items laid out automatically. In IcePanel, `technologyIds` and `teamIds` must be ids from IcePanel's own catalog and organization (the official guide fetches them from `api.icepanel.io/v1/catalog/technologies`). So the export does not use those fields: it writes technologies and team into `labels` (`zark:technologies`, `zark:owner`, `id=Name` pairs), which the import reads back losslessly. A `technologyIds`/`teamIds` coming from a real IcePanel export becomes a `catalog.yaml` item named after its id, to adjust later. IcePanel requires actors and systems to sit inside a domain, so the export wraps the root in a domain named after the project. Conformance is tested against the official JSON Schema, kept in `packages/core/test/fixtures/icepanel-schema`.

## MCP

Stdio configuration for any MCP client:

```json
{
  "mcpServers": {
    "zark": { "command": "npx", "args": ["@ewcodes/zark", "mcp", "--dir", "architecture"] }
  }
}
```

With `zark dev` running, the same server is at `http://127.0.0.1:4317/mcp`, using the session token printed in the terminal (`Authorization: Bearer <token>`). Every agent write shows up in the UI in real time. `open_pr` only creates the PR (or MR) on a second call with `confirm: true`. Prompts: `document-repository` and `review-model` (the former Portuguese names `documentar-repositorio` and `revisar-modelo` still work as aliases).

## VS Code extension

`packages/vscode` adds the **Zark: Open drawing beside** command (also an editor title button) for YAML files inside `architecture/`. It reuses a `zark dev` already running on the folder (`.zark/server.json`) or starts one on a free port (the workspace `node_modules/.bin/zark`, otherwise `npx zark`), and opens the UI beside the editor:

- `drawings/<id>.yaml` opens that drawing;
- `flows/<id>.yaml` opens the flow in flow mode;
- `entities/<id>.yaml` opens the first drawing that places the entity.

No `vsce` needed: `pnpm --filter zark-vscode build` produces `dist/extension.cjs`. To use it locally, point VS Code at the folder (`code --extensionDevelopmentPath=packages/vscode`) or copy `packages/vscode` (with `dist/`) to `~/.vscode/extensions/zark-vscode`. `pnpm --filter zark-vscode smoke` loads the bundle with a fake `vscode` and checks that the command is registered.

## CI

`.github/workflows/architecture.yml` is the example for the repository that versions `architecture/` (with `@ewcodes/zark` as a devDependency, installed by `npm ci`): it runs `validate`, `fmt --check`, `render --check` and posts the semantic diff in the job summary. The `scan --check` gate is the separate workflow shown under [Code level](#code-level-typescript), since it must run without a `paths` filter.

### Architecture diff as a pull request comment

`.github/workflows/architecture-comment.yml` keeps one comment on each pull request that touches the architecture, rewritten on every push:

- the semantic diff (`zark diff --format markdown`) against the merge base;
- a **Before | After** table for every drawing whose PNG in `rendered/` changed (a new drawing shows only the new picture, a removed one only the old).

The image URLs are pinned to commit SHAs, so a comment never changes under the reader. Nothing is rendered in the workflow: it shows the committed PNGs, which `render --check` keeps current, so commit `zark render` output together with the model change.

This repository runs it on `examples/ai-chat/architecture`. To use it in the repository that versions `architecture/`, copy the file and change four things:

1. `paths` to `["architecture/**"]` and `DIR` to `architecture`;
2. the `pnpm/action-setup` step and `cache: pnpm`: remove them;
3. `pnpm install --frozen-lockfile` to `npm ci`;
4. `./node_modules/.bin/tsx packages/cli/src/main.ts diff` to `npx zark diff`.

It needs `pull-requests: write` (already in the file) and skips pull requests from forks, whose token is read-only. In a private repository the pinned image URLs only load for readers signed in with access to it.

To keep the code graphs current instead of failing the build, run `npx zark scan` in a job and open a PR with the result:

```yaml
- run: npm ci
- run: npx zark scan
- uses: peter-evans/create-pull-request@v6
  with: { add-paths: architecture/code, title: "chore: update code graphs" }
```

## Development

pnpm monorepo, TypeScript end to end.

```text
packages/
  core/    model, schemas (Zod), loader, canonical writer, validator, operations, diff, messages
  server/  HTTP (Hono) + SSE, file watcher, git/gh, renderer (Playwright)
  mcp/     tools, resources and prompts over the core
  ui/      React + React Flow, i18n (en default, pt)
  cli/     commands; the build bundles server, mcp and the UI
  vscode/  extension that opens the drawing beside the YAML
```

```sh
pnpm install
pnpm test                 # Vitest
pnpm typecheck
pnpm build                # UI, then the CLI (packages/cli/dist)
pnpm zark validate --dir examples/ai-chat/architecture   # CLI straight from source
```

To work on the UI, run `pnpm build` (or `pnpm --filter @zark/ui build`) and `pnpm zark dev --dir examples/ai-chat/architecture`.

Releases: see [RELEASING.md](RELEASING.md) (tag `vX.Y.Z`; CI publishes to npm with provenance). `scripts/smoke-pack.mjs` installs the packed tarball in an empty project and follows this README on Linux, macOS and Windows.

UI strings live in `packages/ui/src/i18n-dict.ts` (`en` and `pt`, same keys) and messages from the core (problems, semantic changes, cascade impact) carry a `key` + `params`, rendered in Portuguese by `packages/ui/src/i18n-messages.ts`. `packages/ui/test/i18n.test.ts` fails when a key or placeholder is missing in either language.

## Publish on GitHub Pages

`zark build` produces a read-only static site: the same UI, without editing controls, reading a `model.json` next to `index.html`. Paths are relative, so it works from any subfolder. Optional job for the main branch:

```yaml
# .github/workflows/architecture-pages.yml
name: architecture-pages
on:
  push:
    branches: [main]
    paths: ["architecture/**"]
permissions: { contents: read, pages: write, id-token: write }
jobs:
  pages:
    runs-on: ubuntu-latest
    environment: { name: github-pages }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci   # installs @ewcodes/zark (devDependency); a bare npx zark is another package
      - run: npx zark build --out site
      - uses: actions/upload-pages-artifact@v3
        with: { path: site }
      - uses: actions/deploy-pages@v4
```

## Português

A interface web tem versão em português: use o seletor **EN | PT** na barra superior. A CLI, o MCP, os textos de PR e as mensagens de validação ficam em inglês.

## License

MIT. See [LICENSE](LICENSE).
