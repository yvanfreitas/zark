# Code-level documentation (C4 level 4), generated from TypeScript

Status: draft for approval · 2026-11-16

## Intent

Zark documents architecture down to C4 level 3 today: `system` → `app`/`store` → `component`, all hand-written YAML (`ALLOWED_PARENTS` in `packages/core/src/schema.ts`). The user wants one level deeper: what each component is made of (modules, classes, functions, the other code pieces) and which pieces call which.

Hand-written docs at that level go stale within weeks, so this level is **generated from source code by a deterministic script (no AI)** and runs in **CI/CD**, so it never drifts. The upper levels stay hand-written: they carry intent and change rarely. The `component` is the seam between the two.

## Goals

1. A hand-written `component` can point at the source folder(s) that implement it.
2. `zark scan` reads the TypeScript in those folders and writes a generated code graph per component into `architecture/`, committed like everything else.
3. `zark scan --check` fails CI when the code changed and the generated graph didn't (same model as `zark render --check`).
4. The UI drills down Component → modules of that component → pieces of a module, with the calls between them, read-only.
5. The PR diff of the generated file reads as a code-architecture change ("`BotOrchestrator.handle` now calls `ModerationClient.classify`").

## Non-goals (v1)

- Languages other than TypeScript/JavaScript (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`). Later languages plug in behind the same extractor function signature; no plugin system now.
- Type-checker precision (see Approaches). No dependency on the scanned project's own `typescript` install or `node_modules`.
- Runtime / dynamic call tracing, dependency injection containers resolved by string tokens, reflection.
- Hand-editing generated files, or placing code-level boxes by hand (code views are auto-laid out; no positions persisted).
- PNG rendering of code views.
- Checking that code-level calls match declared hand-written connections (good follow-up, see Later).

## Anti-goals (failure even if it "works")

- **Non-determinism**: the same source tree must produce a byte-identical file on every OS (Windows dev, Linux CI). No timestamps, no absolute paths, no map-order dependence, `/` separators, LF.
- **Guessed arrows**: an arrow the code doesn't support is worse than a missing one. Unresolved calls are counted, never drawn.
- **Noisy diffs**: line numbers or formatting churn must not rewrite unrelated parts of the file (see file format: line numbers are kept but the file is sorted so a moved function changes only its own entry).
- **Breaking existing projects**: models that don't use `source` behave exactly as today; no schema version bump required for them.

## Constraints

- Node ≥ 22; CLI published as `@ewcodes/zark` (esbuild bundle in `packages/cli`). Native parser binaries must cover win32/darwin/linux × x64/arm64 and be kept external to the bundle.
- Scan must run in CI without installing the scanned project's dependencies.
- Generated files go through the existing canonical writer (`packages/core/src/writer.ts`) so `zark fmt --check` stays green.
- Performance target: ~1,000 source files scanned in under 10 s on a CI runner.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | TypeScript compiler API with the type checker (using the scanned project's TS 5.x) | Most precise (resolves `this.repo.save()` through types), but needs the project's `typescript` and installed deps, slower. |
| **B (chosen)** | Fast syntax-only parser (oxc / swc / tree-sitter) + import resolution + syntactic type hints | Fast, self-contained, works in CI with no project install. Instance-method calls resolve only when the syntax names the type. |
| C | External tool (`dependency-cruiser`) | Least code, but only file-level imports: no pieces, no calls. Doesn't meet the goal. |

**User picked B.** Precision gap is handled by the "never guess" rule plus an unresolved-call count shown in the CLI summary and the UI.

## Design

### 1. Linking components to code

New optional field on entities of kind `component`: `source`, a path or list of paths/globs **relative to the repository root** (the git root containing `architecture/`):

```yaml
id: bot-orchestrator
kind: component
parent: bot-service
source: services/bot/src/orchestrator        # or [ "services/bot/src/orchestrator", "services/bot/src/shared/llm.ts" ]
```

Optional project-level settings in `zark.yaml`:

```yaml
code:
  tsconfig: tsconfig.json           # for `paths`/`baseUrl` aliases; default: nearest tsconfig.json per file
  exclude: ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**", "**/*.d.ts", "**/generated/**"]   # these are the defaults
```

A file claimed by two components belongs to the one whose `source` is the longest (most specific) match; a tie is a validation error.

### 2. What gets extracted

Per **module** (one source file): its path and its top-level **pieces**:

| Piece kind | From |
|---|---|
| `class` | `class` / `abstract class`, with its public methods and constructor-injected dependencies listed as members |
| `function` | `function` declarations and `const x = (...) => …` / `function` expressions |
| `const` | other exported top-level `const`/`let` (objects, config, instances) |
| `interface`, `type`, `enum` | the respective declarations |

v1 records **exported** pieces only (including `export default`, re-exports resolved to their origin). Calls made from non-exported code are attributed to the module, not to a piece.

### 3. Edges (who calls / uses whom)

Edge kinds: `calls`, `instantiates` (`new X`), `extends`, `implements`. Type-only references (`import type`, annotations) are **not** edges (too noisy); exception: they feed the type hints below.

Resolution rules, applied in order; anything not resolved is counted as unresolved and not drawn:

1. **Imports**: relative paths with extension/`index` resolution; `tsconfig` `paths`/`baseUrl` aliases (read from the tsconfig JSON, including `extends` chains); bare package imports are **external** and ignored (count reported). **Workspace packages** (`@acme/moderation` in a pnpm/yarn/npm monorepo) are external too, by user decision: no workspace or `package.json` resolution in v1. Cross-component edges therefore appear only through relative paths or tsconfig aliases.
2. **Direct calls**: `foo()` where `foo` is an imported binding or a top-level declaration in the same module; `ns.foo()` for namespace imports; `X.staticMethod()`.
3. **Instantiation**: `new X()` where `X` resolves by rule 1/2.
4. **Instance calls via syntactic type hints**: `this.dep.m()` when `dep` is a constructor parameter property or class property with a type annotation naming a resolvable class/interface; `const s = new X(); s.m()` within the same scope; `p.m()` where parameter `p` has such an annotation. A call on an interface type points at the interface (implementations are not guessed).
5. Edges are recorded at **method granularity** where the syntax gives it: endpoints are `piece` or `Class.method` (`from` is the enclosing function or method; `to` is the called function, `Class.method`, or the class for `new`/`extends`/`implements`). One edge per (from, to, kind) with a `count`. Class-level and module-level edges in the UI are derived from these at read time, not stored. *(Builder-check call: storing the finest level keeps goal 5 possible without a later format change.)*
6. A call into a repo file that no component claims is **not parsed** and counts under `unresolved.unowned`. A scan of one component therefore never needs to parse the rest of the repo, except files claimed by other components that it calls into (needed to confirm the target piece exists).

Cross-component calls (module of component A calls a module claimed by component B) are kept, with the target written as `<component-id>:<module path>#<piece>`.

### 4. Generated file

One file per scanned component: `architecture/code/<component-id>.yaml`. Shape (exact field names left to the builder, constraints are fixed):

```yaml
# Generated by `zark scan` from services/bot/src/orchestrator. Do not edit.
component: bot-orchestrator
modules:
  - path: services/bot/src/orchestrator/handler.ts
    pieces:
      - { name: handle, kind: function }
  - path: services/bot/src/orchestrator/orchestrator.ts
    pieces:
      - name: BotOrchestrator
        kind: class
        members: [handle, retry]
edges:
  - { from: services/bot/src/orchestrator/handler.ts#handle, to: services/bot/src/orchestrator/orchestrator.ts#BotOrchestrator, kind: instantiates, count: 1 }
  - { from: services/bot/src/orchestrator/orchestrator.ts#BotOrchestrator.handle, to: moderation:services/moderation/src/client.ts#ModerationClient.classify, kind: calls, count: 2 }
unresolved: { calls: 7, external: 23, unowned: 2 }
```

Rules: modules sorted by path, pieces by name, edges by (from, to, kind); paths repo-relative with `/`; no timestamps; written via the canonical writer. Stale files (component removed or `source` dropped) are deleted by `zark scan`.

**No line numbers in the committed file** *(builder-check call)*: with lines, every edit that shifts code would change the file and `--check` would fail on almost every code PR. The file changes only when structure changes (pieces, members, edges, counts). `count` changing is a real structural signal and stays.

### 5. CLI

- `zark scan [component...]`: scans all components with `source` (or the listed ones), writes/deletes files, prints per component: modules, pieces, edges, unresolved calls, external imports.
- `zark scan --check`: exits 1 listing components whose generated file differs from a fresh scan (like `render --check`).
- `zark pr` runs `scan` before `render`, so the generated files land in the same PR.
- README gets a CI snippet: `npx zark scan --check` as the recommended gate (developers run `zark scan` locally, as with `render`), plus an alternative job that runs `zark scan` and opens a PR.

### 5b. Schema compatibility *(builder-check call)*

`source` and `code:` are **additive under `schema: 1`**: no version bump, no `migrate` step, projects that don't use them see no change. Added to `Entity`/`Config` zod schemas, `KEY_ORDER` and the published JSON schemas. An older CLI reading a project that uses them fails with E001 on the unknown key; acceptable because teams pin the CLI as a devDependency. The generated `code/*.yaml` files get their own zod schema and are loaded by the project loader as a new file kind.

### 6. Validation (new codes, numbering per existing scheme)

Where they run *(builder-check call)*: checks that only read YAML (`source` on a non-component, generated file for an unknown component, component with `source` but no generated file) run in the normal `validate` everywhere. Checks that **read the filesystem** (`source` matches nothing, two components tie for a file) run only in `zark validate` and `zark scan`, not inside `applyOps` (UI/MCP edits) and not on historical refs (`projectAtRef`), so a stale `source` never blocks UI edits and history isn't checked against the current tree.

- Error: `source` on an entity that is not a `component`.
- Error: a `source` path/glob that matches nothing.
- Error: two components tie for the same file.
- Warning: a component with `source` but no generated file (run `zark scan`).
- Warning: a generated file whose `component` doesn't exist (stale).

### 7. UI

- A component that has a generated file shows a code indicator on its box (next to the existing drill-down magnifier). Clicking it opens a **code view** in the main area (same slot as the Dependencies view).
- **Module level**: one box per module of the component, plus faded boxes for modules of other components it calls or is called by; arrows aggregated from piece edges, labelled with counts. Auto-laid out with the existing ELK worker (`packages/ui/src/deps/layout.worker.ts`).
- **Module drill-down**: one box per piece of that module and the pieces it touches, edges per kind (`extends`/`implements` styled differently from `calls`).
- Read-only: no dragging persisted, no create/delete. Hover highlight and edge direction animation behave as on the canvas.
- Right panel shows the selected module/piece: kind, file path, members, incoming/outgoing edges, unresolved count for the component.
- Sidebar tree: no change in v1 (code views are reached from components, not listed as drawings).

### 8. MCP

One read-only tool, `get_code_graph(component)`, returning the generated file's content, so agents can answer "what calls X" without parsing source.

### 9. Packaging

- Parser: a fast native TS parser with prebuilt binaries for all target platforms (oxc-parser is the suggestion; swc or tree-sitter acceptable if they meet the determinism and platform constraints). Added to `packages/cli` dependencies and kept external in the esbuild bundle.
- The extractor lives in a new `packages/core/src/code/` (pure: files in → graph out) so it's unit-testable without the CLI.

### 10. Tests

- A fixture TS mini-project under `packages/core/test/fixtures/code/` exercising every resolution rule, including the negative cases (untyped instance call → unresolved, package import → external, interface call → interface not implementation).
- Determinism: scan twice → identical bytes; scan with Windows-style paths → identical output.
- `--check` returns 1 after a fixture edit and 0 after re-scan.
- UI: unit test for the module-edge aggregation; one browser test that opens a code view from a component.

## Left to the builder

- Exact YAML field names and how members are represented, within the constraints in §4.
- Parser choice among the candidates in §9.
- Grouping very large module graphs (e.g. by folder) once a component exceeds ~150 modules.
- UI styling of piece kinds and edge kinds, consistent with the existing CSS variables.

## Later (not v1)

- Validation that cross-component code calls match declared connections (warn on undeclared dependencies): keeps the hand-written level honest.
- Other languages (Python next) behind the same extractor signature.
- Non-exported pieces, search over pieces, PNG export of code views.
