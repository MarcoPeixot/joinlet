# Arquitetura do Joinlet

> Parte da arquitetura de “Joinlet” (visão completa em [ARCHITECTURE.md](../ARCHITECTURE.md)). Gerado pelo Joinlet: não edite à mão.

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
      "description": "Canvas, documentos, sketches e adaptadores; prévia pública browser-preview abre um workspace sem conta em IndexedDB, com contas adicionais futuras. O modo remoto autenticado permanece separado. Landing e documentação estática bilíngue oferecem acesso ao repositório público; guias seguem os grupos do menu também na paginação. Tema escuro e inglês por padrão, preservando escolhas salvas. A configuração de IA na prévia pública explica a limitação e orienta a execução local sem tentar carregar provedores indisponíveis."
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

## Componentes

| Componente | Tipo | Tecnologia | Descrição | Grupo |
| --- | --- | --- | --- | --- |
| Editor web (`Web`) | nó | React · Vite | Canvas, documentos, sketches e adaptadores; prévia pública browser-preview abre um workspace sem conta em IndexedDB, com contas adicionais futuras. O modo remoto autenticado permanece separado. Landing e documentação estática bilíngue oferecem acesso ao repositório público; guias seguem os grupos do menu também na paginação. Tema escuro e inglês por padrão, preservando escolhas salvas. A configuração de IA na prévia pública explica a limitação e orienta a execução local sem tentar carregar provedores indisponíveis. | — |
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

## Evidências no código

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
- `Web`: `apps/web/src/workspace/workspace.ts#L27` — trecho esperado: `export interface Workspace`
- `Web`: `apps/web/src/settings/publicAccess.ts#L2` — trecho esperado: `export function isBrowserPreview`
- `Web`: `apps/web/src/landing/Nav.tsx#L23` — trecho esperado: `export function SiteNav`
- `Web`: `apps/web/docs/site.mjs#L21` — trecho esperado: `export function renderPage`
- `Web`: `apps/web/src/brand/project.json#L2` — trecho esperado: `https://github.com/MarcoPeixot/joinlet`
- `Web`: `apps/web/src/ui/uiStore.ts#L121` — trecho esperado: `function initialThemePref`
- `Web`: `apps/web/src/settings/store.ts#L41` — trecho esperado: `export async function refreshSettings`
- `Web`: `apps/web/src/settings/AiSetupGuide.tsx#L9` — trecho esperado: `export function AiSetupGuide`
- `Workspace`: `packages/workspace/src/workspace.ts#L32` — trecho esperado: `export interface WorkspaceData`
- `Workspace`: `packages/workspace/src/beta.ts#L24` — trecho esperado: `SELF_HOSTED_PLAN`

## Conexões

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
