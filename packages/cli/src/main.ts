#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { commands } from './commands.js';

const USAGE = `zark <command> [options]

Commands:
  init                         Creates architecture/ with zark.yaml, catalog.yaml and an empty drawing
  dev [--port 4317] [--no-open] Starts the server, UI and MCP over HTTP
  dev --workspace [folder]     Serves every repo with architecture/ under folder
  mcp                          MCP over stdio
  validate [--format json]     Lists problems. Exits with 1 when there are errors
  fmt [--check]                Rewrites files in canonical format, or only checks
  render [--check] [id...]     Renders PNGs, or checks they are up to date
  scan [--check] [component...] (alpha) Generates code graphs for components with source, or checks them
  diff [--base ref] [--format text|markdown]
  pr [--yes] [--title t]       Opens a PR with preview and confirmation
  build --out dir              Read-only static site
  export <format> [id] [--out file]  mermaid, json, structurizr, icepanel-yaml
  import [format] <file> [--yes]     structurizr, icepanel-json, icepanel-yaml (default: detect)
  migrate [--check]            Updates the files to the current format version
  schema --out dir             Writes the JSON Schemas

Global options:
  --dir <folder>               Architecture folder (default: architecture)`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: 'string' },
      workspace: { type: 'boolean' },
      format: { type: 'string' },
      check: { type: 'boolean' },
      write: { type: 'boolean' },
      base: { type: 'string' },
      port: { type: 'string' },
      host: { type: 'string' },
      'no-open': { type: 'boolean' },
      out: { type: 'string' },
      yes: { type: 'boolean' },
      title: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [name, ...args] = positionals;
  if (!name || values.help) {
    console.log(USAGE);
    return 0;
  }
  const command = commands[name];
  if (!command) {
    console.error(`Unknown command: ${name}\n\n${USAGE}`);
    return 2;
  }
  return command({ ...values, dir: resolve(values.dir ?? 'architecture'), dirGiven: values.dir !== undefined, args });
}

main().then(
  (code) => {
    if (typeof code === 'number') process.exitCode = code;
  },
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  },
);
