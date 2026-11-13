# Zark

Documentação de arquitetura as code. Os arquivos YAML em `architecture/` são o único estado. A UI web, o MCP server e a CLI leem e escrevem esses mesmos arquivos, então não há sync entre ferramenta e repositório. A colaboração acontece por pull request.

- **Entidades** (`entities/<id>.yaml`): atores, sistemas, apps, stores e componentes, na hierarquia do C4. As conexões de saída ficam no arquivo da origem.
- **Desenhos** (`drawings/<id>.yaml`): posição das caixas e traçado dos conectores. Só apresentação, sempre por referência ao modelo.
- **Fluxos** (`flows/<id>.yaml`): passo a passo sobre as conexões, com paralelos, alternativas e subfluxos, reproduzido sobre um desenho.
- **Validação**: todo problema tem código (`E001`…`W030`), arquivo e linha. Erros falham o CI e bloqueiam escrita pela UI e pelo MCP.

Veja `examples/ecommerce/architecture/` para um modelo completo (13 entidades, 17 conexões, 2 desenhos, 1 fluxo).

## Instalação

Requer Node 22 ou mais recente.

```sh
npm i -D zark          # ou: pnpm add -D zark
npx zark init          # cria architecture/ com zark.yaml, catalog.yaml e um desenho vazio
npx zark dev           # sobe UI, API e MCP em http://127.0.0.1:4317
```

O Chromium usado para gerar PNGs é baixado na primeira chamada de render, não na instalação.

## Comandos

| Comando | Função |
| --- | --- |
| `zark init` | Cria `architecture/`, acrescenta `.zark/` ao `.gitignore` e força LF nos YAML via `.gitattributes` |
| `zark dev [--port 4317] [--no-open]` | Servidor local, UI editável e MCP por HTTP em `/mcp` |
| `zark mcp` | MCP por stdio. Delega a um `zark dev` rodando na mesma pasta, se houver |
| `zark validate [--format json]` | Lista problemas. Sai com 1 se houver erro |
| `zark fmt [--check]` | Reescreve no formato canônico, ou só verifica |
| `zark render [--check] [id...]` | Gera PNGs em `architecture/rendered/`, ou verifica se estão atualizados |
| `zark diff [--base ref] [--format text\|markdown]` | Diff semântico contra uma ref git (padrão: `origin/<baseBranch>`) |
| `zark pr [--yes] [--title t]` | Branch, render, commit de `architecture/`, push e `gh pr create`, com prévia e confirmação |
| `zark build --out dir` | Site estático somente leitura (desenhos e player de fluxos) |
| `zark export <mermaid\|json> [fluxo]` | Exporta fluxos como Mermaid `sequenceDiagram` ou o modelo em JSON |
| `zark schema --out dir` | Grava os JSON Schemas dos arquivos |

Todos aceitam `--dir <pasta>` (padrão: `architecture`).

Git e PR usam o `git` e o `gh` já autenticados na máquina. O Zark nunca pede, lê ou guarda token, e nunca faz `push --force`.

## MCP

Configuração por stdio em qualquer cliente MCP:

```json
{
  "mcpServers": {
    "zark": { "command": "npx", "args": ["zark", "mcp", "--dir", "architecture"] }
  }
}
```

Com `zark dev` rodando, o mesmo servidor está em `http://127.0.0.1:4317/mcp`, com o token de sessão impresso no terminal (`Authorization: Bearer <token>`). Toda escrita do agente aparece na UI em tempo real. `open_pr` só cria o PR numa segunda chamada com `confirm: true`.

## CI

`.github/workflows/architecture.yml` é o exemplo para o repositório que versiona `architecture/`: roda `validate`, `fmt --check`, `render --check` e publica o diff semântico no resumo do job.

## Desenvolvimento

Monorepo pnpm, TypeScript de ponta a ponta.

```text
packages/
  core/    modelo, schemas (Zod), loader, writer canônico, validador, operações, diff
  server/  HTTP (Hono) + SSE, file watcher, git/gh, renderer (Playwright)
  mcp/     tools, resources e prompts sobre o core
  ui/      React + React Flow
  cli/     comandos; o build embute server, mcp e a UI
```

```sh
pnpm install
pnpm test                 # Vitest
pnpm typecheck
pnpm build                # UI e depois a CLI (packages/cli/dist)
pnpm zark validate --dir examples/ecommerce/architecture   # CLI direto do código-fonte
```

Para trabalhar na UI, rode `pnpm build` (ou `pnpm --filter @zark/ui build`) e `pnpm zark dev --dir examples/ecommerce/architecture`.
