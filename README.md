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
| `zark export <formato> [fluxo] [--out arquivo]` | `mermaid` (fluxos), `json` (modelo), `structurizr` (workspace JSON) ou `icepanel-yaml` (modelo do IcePanel) |
| `zark migrate [--check]` | Atualiza os arquivos para a versão de formato atual (`schema` no `zark.yaml`) |
| `zark import [formato] <arquivo> [--yes]` | Importa um workspace do Structurizr ou um modelo do IcePanel (JSON/YAML). Sem formato, detecta pelo conteúdo |
| `zark schema --out dir` | Grava os JSON Schemas dos arquivos |

Todos aceitam `--dir <pasta>` (padrão: `architecture`).

Git e PR usam o `git` e o CLI do provedor já autenticados na máquina: `gh` no GitHub, `glab` no GitLab (aí o PR vira MR). O provedor vem de `git.provider: github | gitlab` no `zark.yaml`; sem isso, um remoto cujo host contém `gitlab` escolhe o GitLab. O Zark nunca pede, lê ou guarda token, e nunca faz `push --force`.

## Importar e exportar

A UI (projeto vazio ou paleta de comandos) e a CLI aceitam os mesmos arquivos. A importação passa pela mesma validação de qualquer escrita: se introduzir erro, nada é gravado. Ids que já existem no projeto ganham sufixo (`vtex-2`).

**Structurizr** (workspace JSON): `person` vira `actor`, `softwareSystem` vira `system` (`location: External` vira `external`), `container` vira `app`, ou `store` quando tem a tag `Database`, e `component` vira `component`. Relacionamentos viram conexões na origem; os implícitos (`linkedRelationshipId`) não são duplicados. Views de paisagem, contexto, contêiner e componente viram desenhos com o escopo correspondente; as posições são divididas por 2 (as caixas do Structurizr são maiores) e encaixadas no grid. Views sem posição são organizadas automaticamente. Views dinâmicas e de implantação não são importadas. No export, os campos do Zark que o Structurizr não tem vão em `properties` com prefixo `zark:`, e um export seguido de import reproduz o modelo.

**IcePanel** (`LandscapeImportData`, schema em `https://api.icepanel.io/v1/schemas/LandscapeImportData`): os tipos `actor`, `system`, `app`, `store` e `component` mapeiam um a um. Domínios não existem no Zark, então seus filhos vão para a raiz; grupos do IcePanel são ignorados (no Zark grupos são molduras de cada desenho). O formato não tem diagramas: a importação cria o desenho `icepanel` com os itens da raiz organizados automaticamente. `technologyIds` e `teamIds` são ids do catálogo de cada ferramenta; ao importar, viram itens do `catalog.yaml` com o id como nome, para ajustar depois.

## MCP

Configuração por stdio em qualquer cliente MCP:

```json
{
  "mcpServers": {
    "zark": { "command": "npx", "args": ["zark", "mcp", "--dir", "architecture"] }
  }
}
```

Com `zark dev` rodando, o mesmo servidor está em `http://127.0.0.1:4317/mcp`, com o token de sessão impresso no terminal (`Authorization: Bearer <token>`). Toda escrita do agente aparece na UI em tempo real. `open_pr` só cria o PR (ou MR) numa segunda chamada com `confirm: true`.

## Extensão do VS Code

`packages/vscode` adiciona o comando **Zark: Abrir desenho ao lado** (também um botão na barra do editor) para arquivos YAML dentro de `architecture/`. Ele reaproveita um `zark dev` já rodando na pasta (`.zark/server.json`) ou sobe um em porta livre (o `zark` do `node_modules/.bin` do workspace, senão `npx zark`), e abre a UI ao lado:

- `drawings/<id>.yaml` abre aquele desenho;
- `flows/<id>.yaml` abre o fluxo no modo fluxo;
- `entities/<id>.yaml` abre o primeiro desenho que posiciona a entidade.

Sem `vsce`: `pnpm --filter zark-vscode build` gera `dist/extension.cjs`. Para usar localmente, aponte o VS Code para a pasta (`code --extensionDevelopmentPath=packages/vscode`) ou copie `packages/vscode` (com `dist/`) para `~/.vscode/extensions/zark-vscode`. `pnpm --filter zark-vscode smoke` carrega o bundle com um `vscode` falso e confere que o comando é registrado.

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
  vscode/  extensão que abre o desenho ao lado do YAML
```

```sh
pnpm install
pnpm test                 # Vitest
pnpm typecheck
pnpm build                # UI e depois a CLI (packages/cli/dist)
pnpm zark validate --dir examples/ecommerce/architecture   # CLI direto do código-fonte
```

Para trabalhar na UI, rode `pnpm build` (ou `pnpm --filter @zark/ui build`) e `pnpm zark dev --dir examples/ecommerce/architecture`.

## Publicar no GitHub Pages

`zark build` gera um site estático somente leitura: a mesma UI, sem controles de edição, lendo um `model.json` ao lado do `index.html`. Os caminhos são relativos, então funciona em qualquer subpasta. Job opcional para a branch principal:

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
      - run: npx zark build --out site
      - uses: actions/upload-pages-artifact@v3
        with: { path: site }
      - uses: actions/deploy-pages@v4
```

## Licença

MIT. Veja [LICENSE](LICENSE).
