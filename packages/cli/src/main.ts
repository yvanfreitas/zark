#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { commands } from './commands.js';

const USAGE = `zark <comando> [opções]

Comandos:
  init                         Cria architecture/ com zark.yaml, catalog.yaml e um desenho vazio
  dev [--port 4317] [--no-open] Sobe servidor, UI e MCP por HTTP
  mcp                          MCP por stdio
  validate [--format json]     Lista problemas. Sai com 1 se houver erro
  fmt [--check]                Reescreve no formato canônico, ou só verifica
  render [--check] [id...]     Gera PNGs, ou verifica se estão atualizados
  diff [--base ref] [--format text|markdown]
  pr [--yes] [--title t]       Abre PR com prévia e confirmação
  build --out dir              Site estático somente leitura
  export <mermaid|json> [id]   Exporta modelo ou fluxo
  schema --out dir             Grava os JSON Schemas

Opções globais:
  --dir <pasta>                Pasta da arquitetura (padrão: architecture)`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: 'string', default: 'architecture' },
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
    console.error(`Comando desconhecido: ${name}\n\n${USAGE}`);
    return 2;
  }
  return command({ ...values, dir: resolve(values.dir!), args });
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
