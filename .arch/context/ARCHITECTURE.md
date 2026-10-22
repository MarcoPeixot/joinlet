# Arquitetura — Joinlet

> Gerado pelo Joinlet a partir de `.arch/`. Não edite à mão: mude os diagramas e os documentos no Joinlet e este arquivo se atualiza.

Cada diagrama traz o código JSON do Joinlet, que é a fonte da verdade, seguido das tabelas de componentes e conexões e de trechos dos documentos ligados aos componentes.

## Diagramas

- [Arquitetura do Joinlet](diagrams/arquitetura-do-joinlet.md) — 11 componentes, 14 conexões
- [Distribuição do código Joinlet](diagrams/distribuicao-do-codigo-joinlet.md) — 5 componentes, 4 conexões
- [Fluxo de release proposto](diagrams/fluxo-de-release-proposto.md) — 9 componentes, 9 conexões

## Arquitetura do Joinlet

`.arch/diagrams/arquitetura-do-joinlet.strukt.json` · 11 componentes, 14 conexões

```json
{
  "$schema": "./strukt.schema.json",
  "version": 1,
  "style": {
    "direction": "down",
    "colorMode": "outline",
    "styleMode": "plain"
  },
  "nodes": [
    {
      "id": "Web",
      "label": "Editor web",
      "presentation": "card",
      "layoutRole": "entry",
      "icon": "browser",
      "tech": "React · Vite",
      "description": "Canvas, documentos, sketches e adaptadores; prévia pública browser-preview abre um workspace sem conta em IndexedDB, com contas adicionais futuras. O modo remoto autenticado permanece separado. Landing e documentação estática bilíngue oferecem acesso ao repositório público; guias seguem os grupos do menu também na paginação. Tema escuro e inglês por padrão, preservando escolhas salvas. A configuração de IA na prévia pública explica a limitação e orienta a execução local sem tentar carregar provedores indisponíveis. Métricas opcionais e explícitas dependem da configuração do operador e consentimento do visitante, sem conteúdo dos projetos."
    },
    {
      "id": "Local",
      "label": "API local",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "terminal",
      "tech": "Hono · Bun",
      "description": "IA, Git, filesystem e integrações locais; self-hosted sem cotas comerciais, com limites técnicos e origem local."
    },
    {
      "id": "Remote",
      "label": "Backend hospedável",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "server",
      "tech": "Express · Bun",
      "description": "OAuth, contas, workspaces hospedados, convites, MCP remoto e admissão; política self-hosted por padrão ou Cloud escolhida no ambiente confiável."
    },
    {
      "id": "Agents",
      "label": "CLI e MCP",
      "presentation": "card",
      "layoutRole": "entry",
      "icon": "bot",
      "description": "Leitura e escrita de arquitetura, contexto, evidências, importação e validação."
    },
    {
      "id": "Extension",
      "label": "Extensão VS Code",
      "presentation": "card",
      "layoutRole": "entry",
      "icon": "code",
      "description": "Comandos e diagnósticos de diagramas no editor."
    },
    {
      "id": "Domain",
      "label": "Modelo e operações",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "layers",
      "description": "Core, formatos JSON/DSL, operações validadas, layout e Git."
    },
    {
      "id": "Workspace",
      "label": "Workspace",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "folder",
      "description": "Manifesto, versões, contexto, evidências e Yjs; política self-hosted separada das cotas da Cloud, isoladas por requisição."
    },
    {
      "id": "Browser",
      "label": "Armazenamento local",
      "presentation": "card",
      "layoutRole": "shared",
      "icon": "hard-drive",
      "tech": "IndexedDB · File System Access",
      "description": "Dados no navegador ou pasta controlada pelo usuário."
    },
    {
      "id": "SQLite",
      "label": "Persistência hospedada",
      "presentation": "card",
      "layoutRole": "shared",
      "icon": "database",
      "tech": "SQLite",
      "description": "Dados e segredos de runtime pertencem ao operador e ficam fora do Git."
    },
    {
      "id": "GitHub",
      "label": "GitHub",
      "presentation": "card",
      "layoutRole": "shared",
      "icon": "github",
      "description": "OAuth e workspace por branch/PR quando um repositório está conectado."
    },
    {
      "id": "AI",
      "label": "Providers de IA",
      "presentation": "card",
      "layoutRole": "shared",
      "icon": "sparkles",
      "description": "BYOK; hosted usa chaves pessoais cifradas e origens públicas permitidas."
    }
  ],
  "connections": [
    {
      "from": "Web",
      "to": "Local",
      "label": "API local opcional"
    },
    {
      "from": "Web",
      "to": "Remote",
      "label": "HTTP e WebSocket"
    },
    {
      "from": "Web",
      "to": "Browser",
      "label": "persistência local"
    },
    {
      "from": "Local",
      "to": "Domain",
      "label": "operações e formatos"
    },
    {
      "from": "Web",
      "to": "Workspace",
      "label": "arquivos e estado"
    },
    {
      "from": "Remote",
      "to": "Workspace",
      "label": "admissão e persistência"
    },
    {
      "from": "Agents",
      "to": "Workspace",
      "label": ".arch e contexto"
    },
    {
      "from": "Extension",
      "to": "Domain",
      "label": "schema e diagnósticos"
    },
    {
      "from": "Workspace",
      "to": "Domain",
      "label": "modelo compartilhado"
    },
    {
      "from": "Remote",
      "to": "SQLite",
      "label": "arquivos, sessões e salas"
    },
    {
      "from": "Remote",
      "to": "GitHub",
      "label": "OAuth e branch/PR"
    },
    {
      "from": "Local",
      "to": "AI",
      "label": "credenciais do operador"
    },
    {
      "from": "Remote",
      "to": "AI",
      "label": "credenciais pessoais"
    },
    {
      "from": "Local",
      "to": "Workspace",
      "label": "pasta local"
    }
  ]
}
```

### Componentes

| Componente | Tipo | Tecnologia | Descrição | Grupo |
| --- | --- | --- | --- | --- |
| Editor web (`Web`) | nó | React · Vite | Canvas, documentos, sketches e adaptadores; prévia pública browser-preview abre um workspace sem conta em IndexedDB, com contas adicionais futuras. O modo remoto autenticado permanece separado. Landing e documentação estática bilíngue oferecem acesso ao repositório público; guias seguem os grupos do menu também na paginação. Tema escuro e inglês por padrão, preservando escolhas salvas. A configuração de IA na prévia pública explica a limitação e orienta a execução local sem tentar carregar provedores indisponíveis. Métricas opcionais e explícitas dependem da configuração do operador e consentimento do visitante, sem conteúdo dos projetos. | — |
| API local (`Local`) | nó | Hono · Bun | IA, Git, filesystem e integrações locais; self-hosted sem cotas comerciais, com limites técnicos e origem local. | — |
| Backend hospedável (`Remote`) | nó | Express · Bun | OAuth, contas, workspaces hospedados, convites, MCP remoto e admissão; política self-hosted por padrão ou Cloud escolhida no ambiente confiável. | — |
| CLI e MCP (`Agents`) | nó | — | Leitura e escrita de arquitetura, contexto, evidências, importação e validação. | — |
| Extensão VS Code (`Extension`) | nó | — | Comandos e diagnósticos de diagramas no editor. | — |
| Modelo e operações (`Domain`) | nó | — | Core, formatos JSON/DSL, operações validadas, layout e Git. | — |
| `Workspace` | nó | — | Manifesto, versões, contexto, evidências e Yjs; política self-hosted separada das cotas da Cloud, isoladas por requisição. | — |
| Armazenamento local (`Browser`) | nó | IndexedDB · File System Access | Dados no navegador ou pasta controlada pelo usuário. | — |
| Persistência hospedada (`SQLite`) | nó | SQLite | Dados e segredos de runtime pertencem ao operador e ficam fora do Git. | — |
| `GitHub` | nó | — | OAuth e workspace por branch/PR quando um repositório está conectado. | — |
| Providers de IA (`AI`) | nó | — | BYOK; hosted usa chaves pessoais cifradas e origens públicas permitidas. | — |

### Evidências no código

- `AI`: `apps/remote/src/hostedAi.ts#L149` — trecho esperado: `export function createHostedAi`
- `Agents`: `apps/mcp/src/server.ts#L39` — trecho esperado: `export function createStruktServer`
- `Browser`: `apps/web/src/workspace/idb.ts#L56` — trecho esperado: `createIdbAdapter`
- `Domain`: `packages/core/src/model.ts#L127` — trecho esperado: `export interface DiagramModel`
- `Extension`: `apps/vscode/src/extension.ts#L22` — trecho esperado: `export function activate`
- `GitHub`: `apps/remote/src/githubWorkspace.ts#L54` — trecho esperado: `export async function openGithubWorkspace`
- `Local`: `apps/server/src/app.ts#L163` — trecho esperado: `export function createApp`
- `Remote`: `apps/remote/src/app.ts#L22` — trecho esperado: `export function createRemoteApp`
- `Remote`: `apps/remote/src/config.ts#L35` — trecho esperado: `JOINLET_DEPLOYMENT_MODE`
- `SQLite`: `apps/remote/src/hostedStore.ts#L51` — trecho esperado: `export function createHostedStore`
- `Web`: `apps/web/src/workspace/workspace.ts#L28` — trecho esperado: `export interface Workspace`
- `Web`: `apps/web/src/settings/publicAccess.ts#L2` — trecho esperado: `export function isBrowserPreview`
- `Web`: `apps/web/src/analytics/client.ts` — trecho esperado: `export function trackAnalytics`
- `Web`: `apps/web/src/landing/Nav.tsx` — trecho esperado: `export function SiteNav`
- `Web`: `apps/web/docs/site.mjs` — trecho esperado: `export function renderPage`
- `Web`: `apps/web/src/brand/project.json` — trecho esperado: `https://github.com/MarcoPeixot/joinlet`
- `Web`: `apps/web/src/ui/uiStore.ts` — trecho esperado: `function initialThemePref`
- `Web`: `apps/web/src/settings/store.ts` — trecho esperado: `export async function refreshSettings`
- `Web`: `apps/web/src/settings/AiSetupGuide.tsx` — trecho esperado: `export function AiSetupGuide`
- `Web`: `apps/web/src/landing/landing.css` — trecho esperado: `.site-header[aria-modal=`
- `Workspace`: `packages/workspace/src/workspace.ts#L32` — trecho esperado: `export interface WorkspaceData`
- `Workspace`: `packages/workspace/src/beta.ts#L24` — trecho esperado: `SELF_HOSTED_PLAN`

### Conexões

| De | Para | Tipo | Rótulo |
| --- | --- | --- | --- |
| `Web` | `Local` | `>` seta | API local opcional |
| `Web` | `Remote` | `>` seta | HTTP e WebSocket |
| `Web` | `Browser` | `>` seta | persistência local |
| `Local` | `Domain` | `>` seta | operações e formatos |
| `Web` | `Workspace` | `>` seta | arquivos e estado |
| `Remote` | `Workspace` | `>` seta | admissão e persistência |
| `Agents` | `Workspace` | `>` seta | .arch e contexto |
| `Extension` | `Domain` | `>` seta | schema e diagnósticos |
| `Workspace` | `Domain` | `>` seta | modelo compartilhado |
| `Remote` | `SQLite` | `>` seta | arquivos, sessões e salas |
| `Remote` | `GitHub` | `>` seta | OAuth e branch/PR |
| `Local` | `AI` | `>` seta | credenciais do operador |
| `Remote` | `AI` | `>` seta | credenciais pessoais |
| `Local` | `Workspace` | `>` seta | pasta local |

## Distribuição do código Joinlet

`.arch/diagrams/distribuicao-do-codigo-joinlet.strukt.json` · 5 componentes, 4 conexões

```json
{
  "$schema": "./strukt.schema.json",
  "version": 1,
  "style": {
    "direction": "down",
    "styleMode": "plain"
  },
  "nodes": [
    {
      "id": "Product",
      "label": "Código do produto",
      "presentation": "card",
      "layoutRole": "entry",
      "icon": "code",
      "description": "Produto completo AGPL-3.0-only: editor, servidores, CLI, MCP, extensão, testes e implantação genérica, sem edição proprietária reservada."
    },
    {
      "id": "Operations",
      "label": "Operação privada",
      "presentation": "card",
      "layoutRole": "entry",
      "icon": "lock",
      "description": "Runbooks, decisões comerciais e materiais internos. Não contém credenciais reais nem dados de clientes."
    },
    {
      "id": "Deployment",
      "label": "Runtime do operador",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "server",
      "description": "Executa a release revisada com domínios e credenciais próprios. O diagrama não comprova uma instalação publicada."
    },
    {
      "id": "Configuration",
      "label": "Configuração e dados privados",
      "presentation": "card",
      "layoutRole": "shared",
      "icon": "database",
      "description": "Variáveis de ambiente, SQLite, backups e logs; ficam fora dos dois repositórios."
    },
    {
      "id": "Checks",
      "label": "Limites de publicação",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "shield",
      "description": "Git index sem arquivos privados; scan do histórico e checkout, testes e evidências."
    }
  ],
  "connections": [
    {
      "from": "Product",
      "to": "Deployment",
      "label": "build da release"
    },
    {
      "from": "Operations",
      "to": "Deployment",
      "label": "procedimentos e SHA"
    },
    {
      "from": "Configuration",
      "to": "Deployment",
      "label": "somente runtime"
    },
    {
      "from": "Checks",
      "to": "Product",
      "label": "revisão antes da publicação"
    }
  ]
}
```

### Componentes

| Componente | Tipo | Tecnologia | Descrição | Grupo |
| --- | --- | --- | --- | --- |
| Código do produto (`Product`) | nó | — | Produto completo AGPL-3.0-only: editor, servidores, CLI, MCP, extensão, testes e implantação genérica, sem edição proprietária reservada. | — |
| Operação privada (`Operations`) | nó | — | Runbooks, decisões comerciais e materiais internos. Não contém credenciais reais nem dados de clientes. | — |
| Runtime do operador (`Deployment`) | nó | — | Executa a release revisada com domínios e credenciais próprios. O diagrama não comprova uma instalação publicada. | — |
| Configuração e dados privados (`Configuration`) | nó | — | Variáveis de ambiente, SQLite, backups e logs; ficam fora dos dois repositórios. | — |
| Limites de publicação (`Checks`) | nó | — | Git index sem arquivos privados; scan do histórico e checkout, testes e evidências. | — |

### Evidências no código

- `Checks`: `scripts/check-publication.py#L2` — trecho esperado: `Reject runtime/private files`
- `Checks`: `scripts/check-secrets.py#L2` — trecho esperado: `without trusting repository-provided suppressions`
- `Checks`: `scripts/test_secret_scanner.py#L1` — trecho esperado: `Integration regression`
- `Deployment`: `deploy/compose.yml#L1` — trecho esperado: `name: joinlet`
- `Product`: `package.json#L2` — trecho esperado: `joinlet`

### Conexões

| De | Para | Tipo | Rótulo |
| --- | --- | --- | --- |
| `Product` | `Deployment` | `>` seta | build da release |
| `Operations` | `Deployment` | `>` seta | procedimentos e SHA |
| `Configuration` | `Deployment` | `>` seta | somente runtime |
| `Checks` | `Product` | `>` seta | revisão antes da publicação |

## Fluxo de release proposto

`.arch/diagrams/fluxo-de-release-proposto.strukt.json` · 9 componentes, 9 conexões

```json
{
  "$schema": "./strukt.schema.json",
  "version": 1,
  "style": {
    "direction": "down",
    "styleMode": "plain"
  },
  "nodes": [
    {
      "id": "Contribution",
      "label": "Contribuição",
      "presentation": "card",
      "layoutRole": "entry",
      "icon": "users",
      "description": "Pessoa propõe uma mudança no repositório do produto."
    },
    {
      "id": "PR",
      "label": "Pull request",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "git-pull-request",
      "description": "Mudança revisável; contribuidores não recebem credenciais de produção."
    },
    {
      "id": "CI",
      "label": "CI e segurança",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "shield",
      "description": "Implementado: tipos, build, testes, arquitetura, navegador, container e fronteiras de publicação."
    },
    {
      "id": "Main",
      "label": "Commit revisado em main",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "git-branch",
      "description": "Escolher revisão completa cujos checks obrigatórios passaram; proteção depende das regras habilitadas."
    },
    {
      "id": "Image",
      "label": "Imagem de release",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "package",
      "description": "Proposto: build uma vez a partir de git archive, atestar procedência e registrar digest imutável."
    },
    {
      "id": "Staging",
      "label": "Homologação",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "flask-conical",
      "description": "Proposto: testar o mesmo digest com credenciais e dados separados."
    },
    {
      "id": "Approval",
      "label": "Aprovação do operador",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "check",
      "description": "Proposto: decisão explícita de promover o artefato validado."
    },
    {
      "id": "Official",
      "label": "Joinlet oficial",
      "presentation": "card",
      "layoutRole": "shared",
      "icon": "server",
      "description": "Proposto: executar a release aprovada com volume e segredos privados. Este diagrama não comprova um deploy."
    },
    {
      "id": "Operations",
      "label": "Registro privado de release",
      "presentation": "card",
      "layoutRole": "entry",
      "icon": "lock",
      "description": "Proposto: SHA, digest, evidências de validação e caminho de rollback, sem duplicar código."
    }
  ],
  "connections": [
    {
      "from": "Contribution",
      "to": "PR"
    },
    {
      "from": "PR",
      "to": "CI"
    },
    {
      "from": "CI",
      "to": "Main"
    },
    {
      "from": "Main",
      "to": "Image"
    },
    {
      "from": "Image",
      "to": "Staging"
    },
    {
      "from": "Staging",
      "to": "Approval"
    },
    {
      "from": "Approval",
      "to": "Official"
    },
    {
      "from": "Operations",
      "to": "Approval"
    },
    {
      "from": "Operations",
      "to": "Official"
    }
  ]
}
```

### Componentes

| Componente | Tipo | Tecnologia | Descrição | Grupo |
| --- | --- | --- | --- | --- |
| Contribuição (`Contribution`) | nó | — | Pessoa propõe uma mudança no repositório do produto. | — |
| Pull request (`PR`) | nó | — | Mudança revisável; contribuidores não recebem credenciais de produção. | — |
| CI e segurança (`CI`) | nó | — | Implementado: tipos, build, testes, arquitetura, navegador, container e fronteiras de publicação. | — |
| Commit revisado em main (`Main`) | nó | — | Escolher revisão completa cujos checks obrigatórios passaram; proteção depende das regras habilitadas. | — |
| Imagem de release (`Image`) | nó | — | Proposto: build uma vez a partir de git archive, atestar procedência e registrar digest imutável. | — |
| Homologação (`Staging`) | nó | — | Proposto: testar o mesmo digest com credenciais e dados separados. | — |
| Aprovação do operador (`Approval`) | nó | — | Proposto: decisão explícita de promover o artefato validado. | — |
| Joinlet oficial (`Official`) | nó | — | Proposto: executar a release aprovada com volume e segredos privados. Este diagrama não comprova um deploy. | — |
| Registro privado de release (`Operations`) | nó | — | Proposto: SHA, digest, evidências de validação e caminho de rollback, sem duplicar código. | — |

### Conexões

| De | Para | Tipo | Rótulo |
| --- | --- | --- | --- |
| `Contribution` | `PR` | `>` seta | — |
| `PR` | `CI` | `>` seta | — |
| `CI` | `Main` | `>` seta | — |
| `Main` | `Image` | `>` seta | — |
| `Image` | `Staging` | `>` seta | — |
| `Staging` | `Approval` | `>` seta | — |
| `Approval` | `Official` | `>` seta | — |
| `Operations` | `Approval` | `>` seta | — |
| `Operations` | `Official` | `>` seta | — |

## Documentos

- Funcionamento do Joinlet — `.arch/docs/funcionamento-do-joinlet.md`
- Código aberto e limites de publicação — `.arch/docs/codigo-aberto-e-limites-de-publicacao.md`
- Distribuição e operação — `.arch/docs/distribuicao-e-operacao.md`
- Release do Joinlet — `.arch/docs/release-do-joinlet.md`
- Site público e documentação — `.arch/docs/site-publico-e-documentacao.md`
