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
      "description": "Canvas, documentos, sketches e adaptadores; prévia pública browser-preview abre um workspace sem conta em IndexedDB, com contas adicionais futuras. O modo remoto autenticado permanece separado. Landing e documentação estática bilíngue oferecem acesso ao repositório público; guias seguem os grupos do menu também na paginação. Tema escuro e inglês por padrão, preservando escolhas salvas. A configuração de IA na prévia pública explica a limitação e orienta a execução local sem tentar carregar provedores indisponíveis. Métricas opcionais e explícitas dependem da configuração do operador e consentimento do visitante, sem conteúdo dos projetos. Analytics opcional v2 cobre landing, guias e editor com consentimento versionado, contexto categórico, IDs idempotentes e atribuição consentida entre origens do operador. Ativação exige alteração significativa seguida de gravação concluída; exportações têm formato explícito. Não envia conteúdo, nomes, caminhos ou erros livres. A entrada hospedada oferece cadastro, login e troca de senha; GitHub aparece apenas quando configurado. A tela de login exporta rascunhos antigos em IndexedDB sem apagá-los. O formulário é carregado sob demanda sem introduzir importação dinâmica do barrel completo de workspace, evitando ciclos de inicialização no build. Contas hospedadas podem editar nome e foto rasterizada em Configurações, com telas em português e inglês carregadas sob demanda. Em browser-preview, abre um workspace local sem login/cadastro; workspaces adicionais mostram indisponibilidade temporária sem oferecer autenticação. Contas hospedadas não são acessadas ou migradas por essa modalidade. Dono Cloud dispõe de catálogo com vários workspaces e escopo independente por aba; prévia sem conta continua limitada a um. Abrir pasta encaminha ao conector e comandos permitem seleção e cópia. Contexto é automático, sem modal manual. Jornada contextual v2 por workspace/revisão, sem dependência de analytics. Evidências mostram caminho, linha e trecho seguro. Progresso exige resultados; edição de código, documentos e catálogos completos carregam ao uso. Orçamento de abertura inclui imports dinâmicos e workers. Com JOINLET_OPTIONAL_LOGIN=1, visitante sem sessão abre o editor em IndexedDB e dispõe de Entrar na conta. A entrada explícita oferece Continuar sem conta; links de workspace e convites preservam autorização. Rascunhos locais e dados Cloud não são mesclados automaticamente. Serviços Cloud mantêm autenticação."
    },
    {
      "id": "Local",
      "label": "API local",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "terminal",
      "tech": "Hono · Bun",
      "description": "IA, Git, filesystem e integrações locais; self-hosted sem cotas comerciais, com limites técnicos e origem local. Serviço de repositório, diagnóstico Git, init e acompanhamento incremental; conector local ou pareado por conexão de saída.",
      "link": "doc:conexao-e-sincronizacao-de-repositorios"
    },
    {
      "id": "Remote",
      "label": "Backend hospedável",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "server",
      "tech": "Express · Bun",
      "description": "OAuth, contas, workspaces hospedados, convites, MCP remoto e admissão; política self-hosted por padrão ou Cloud escolhida no ambiente confiável. A autenticação por e-mail/senha usa Argon2id assíncrono, limites por IP/identificador, CSRF e sessões revogáveis por versão. O modo senha inicia sem credenciais GitHub. Confirmação, recuperação por e-mail e vínculo entre métodos ficam fora desta primeira entrega; o endereço não é identidade verificada. Analytics do HTML remoto permanece opcional por configuração explícita. Perfil pessoal exige sessão e CSRF, sem alterar e-mail ou privilégios. Diretório de contas é somente leitura, desabilitado sem credencial dedicada de serviço; o proxy público bloqueia /api/internal. A projeção paginada contém cadastro e métodos de acesso, sem senhas, sessões, chaves ou conteúdo de projetos. O painel administrativo do operador permanece separado. Conexões locais/GitHub, autorização vinculada à conta existente, fila SQLite, snapshots SHA e worker separado com publicação por lote em um PR. Múltiplos workspaces por dono, migração de IDs e convites preservados e autorização de escopo por requisição.",
      "link": "doc:conexao-e-sincronizacao-de-repositorios"
    },
    {
      "id": "Agents",
      "label": "CLI e MCP",
      "presentation": "card",
      "layoutRole": "entry",
      "icon": "bot",
      "description": "Leitura e escrita de arquitetura, contexto, evidências, importação e validação. CLI init/connect/watch e request_repository_sync; fontes autorizadas ampliam diagnóstico e encaminhamento, preservando o limite de não reescrever a aplicação. Blocos gerenciados em AGENTS.md e CLAUDE.md apontam ao contexto vivo, preservando instruções humanas.",
      "link": "doc:conexao-e-sincronizacao-de-repositorios"
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
      "description": "Manifesto, versões, contexto, evidências e Yjs; políticas isoladas por requisição. Motor compartilhado de repositório com extração sintática de 18 linguagens/formatos, referências por módulo e dependências classificadas. Gramáticas WASM ficam no backend e em assets locais. Diagnósticos, mesclagem e escrita coordenada preservam autoria e explicitam cobertura parcial.",
      "link": "doc:conexao-e-sincronizacao-de-repositorios"
    },
    {
      "id": "Browser",
      "label": "Armazenamento local",
      "presentation": "card",
      "layoutRole": "shared",
      "icon": "hard-drive",
      "tech": "IndexedDB · File System Access",
      "description": "Persistência em IndexedDB ou pasta do usuário. O salvador distingue gravação efetiva, erro terminal, cancelamento e dados já conhecidos; telemetria de conteúdo salvo só acompanha gravações reais após interação significativa. Memória volátil não é tratada como persistência."
    },
    {
      "id": "SQLite",
      "label": "Persistência hospedada",
      "presentation": "card",
      "layoutRole": "shared",
      "icon": "database",
      "tech": "SQLite",
      "description": "Dados e segredos de runtime pertencem ao operador e ficam fora do Git. Contas têm IDs internos independentes de subjects GitHub; migração versionada reserva IDs legados e preserva dados. Senhas são hashes; trocar senha invalida sessões antigas. A ferramenta recovery invalida acessos e convites em snapshots restaurados sem apagar workspaces. Migração v2 adiciona foto e datas sem inventar datas históricas. Nome/foto pertencem ao ID interno; sessões existentes leem o nome atual. Cadastros novos e logins passam a registrar seus instantes."
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
| Editor web (`Web`) | nó | React · Vite | Canvas, documentos, sketches e adaptadores; prévia pública browser-preview abre um workspace sem conta em IndexedDB, com contas adicionais futuras. O modo remoto autenticado permanece separado. Landing e documentação estática bilíngue oferecem acesso ao repositório público; guias seguem os grupos do menu também na paginação. Tema escuro e inglês por padrão, preservando escolhas salvas. A configuração de IA na prévia pública explica a limitação e orienta a execução local sem tentar carregar provedores indisponíveis. Métricas opcionais e explícitas dependem da configuração do operador e consentimento do visitante, sem conteúdo dos projetos. Analytics opcional v2 cobre landing, guias e editor com consentimento versionado, contexto categórico, IDs idempotentes e atribuição consentida entre origens do operador. Ativação exige alteração significativa seguida de gravação concluída; exportações têm formato explícito. Não envia conteúdo, nomes, caminhos ou erros livres. A entrada hospedada oferece cadastro, login e troca de senha; GitHub aparece apenas quando configurado. A tela de login exporta rascunhos antigos em IndexedDB sem apagá-los. O formulário é carregado sob demanda sem introduzir importação dinâmica do barrel completo de workspace, evitando ciclos de inicialização no build. Contas hospedadas podem editar nome e foto rasterizada em Configurações, com telas em português e inglês carregadas sob demanda. Em browser-preview, abre um workspace local sem login/cadastro; workspaces adicionais mostram indisponibilidade temporária sem oferecer autenticação. Contas hospedadas não são acessadas ou migradas por essa modalidade. Dono Cloud dispõe de catálogo com vários workspaces e escopo independente por aba; prévia sem conta continua limitada a um. Abrir pasta encaminha ao conector e comandos permitem seleção e cópia. Contexto é automático, sem modal manual. Jornada contextual v2 por workspace/revisão, sem dependência de analytics. Evidências mostram caminho, linha e trecho seguro. Progresso exige resultados; edição de código, documentos e catálogos completos carregam ao uso. Orçamento de abertura inclui imports dinâmicos e workers. Com JOINLET\_OPTIONAL\_LOGIN=1, visitante sem sessão abre o editor em IndexedDB e dispõe de Entrar na conta. A entrada explícita oferece Continuar sem conta; links de workspace e convites preservam autorização. Rascunhos locais e dados Cloud não são mesclados automaticamente. Serviços Cloud mantêm autenticação. | — |
| API local (`Local`) | nó | Hono · Bun | IA, Git, filesystem e integrações locais; self-hosted sem cotas comerciais, com limites técnicos e origem local. Serviço de repositório, diagnóstico Git, init e acompanhamento incremental; conector local ou pareado por conexão de saída. | — |
| Backend hospedável (`Remote`) | nó | Express · Bun | OAuth, contas, workspaces hospedados, convites, MCP remoto e admissão; política self-hosted por padrão ou Cloud escolhida no ambiente confiável. A autenticação por e-mail/senha usa Argon2id assíncrono, limites por IP/identificador, CSRF e sessões revogáveis por versão. O modo senha inicia sem credenciais GitHub. Confirmação, recuperação por e-mail e vínculo entre métodos ficam fora desta primeira entrega; o endereço não é identidade verificada. Analytics do HTML remoto permanece opcional por configuração explícita. Perfil pessoal exige sessão e CSRF, sem alterar e-mail ou privilégios. Diretório de contas é somente leitura, desabilitado sem credencial dedicada de serviço; o proxy público bloqueia /api/internal. A projeção paginada contém cadastro e métodos de acesso, sem senhas, sessões, chaves ou conteúdo de projetos. O painel administrativo do operador permanece separado. Conexões locais/GitHub, autorização vinculada à conta existente, fila SQLite, snapshots SHA e worker separado com publicação por lote em um PR. Múltiplos workspaces por dono, migração de IDs e convites preservados e autorização de escopo por requisição. | — |
| CLI e MCP (`Agents`) | nó | — | Leitura e escrita de arquitetura, contexto, evidências, importação e validação. CLI init/connect/watch e request\_repository\_sync; fontes autorizadas ampliam diagnóstico e encaminhamento, preservando o limite de não reescrever a aplicação. Blocos gerenciados em AGENTS.md e CLAUDE.md apontam ao contexto vivo, preservando instruções humanas. | — |
| Extensão VS Code (`Extension`) | nó | — | Comandos e diagnósticos de diagramas no editor. | — |
| Modelo e operações (`Domain`) | nó | — | Core, formatos JSON/DSL, operações validadas, layout e Git. | — |
| `Workspace` | nó | — | Manifesto, versões, contexto, evidências e Yjs; políticas isoladas por requisição. Motor compartilhado de repositório com extração sintática de 18 linguagens/formatos, referências por módulo e dependências classificadas. Gramáticas WASM ficam no backend e em assets locais. Diagnósticos, mesclagem e escrita coordenada preservam autoria e explicitam cobertura parcial. | — |
| Armazenamento local (`Browser`) | nó | IndexedDB · File System Access | Persistência em IndexedDB ou pasta do usuário. O salvador distingue gravação efetiva, erro terminal, cancelamento e dados já conhecidos; telemetria de conteúdo salvo só acompanha gravações reais após interação significativa. Memória volátil não é tratada como persistência. | — |
| Persistência hospedada (`SQLite`) | nó | SQLite | Dados e segredos de runtime pertencem ao operador e ficam fora do Git. Contas têm IDs internos independentes de subjects GitHub; migração versionada reserva IDs legados e preserva dados. Senhas são hashes; trocar senha invalida sessões antigas. A ferramenta recovery invalida acessos e convites em snapshots restaurados sem apagar workspaces. Migração v2 adiciona foto e datas sem inventar datas históricas. Nome/foto pertencem ao ID interno; sessões existentes leem o nome atual. Cadastros novos e logins passam a registrar seus instantes. | — |
| `GitHub` | nó | — | OAuth e workspace por branch/PR quando um repositório está conectado. | — |
| Providers de IA (`AI`) | nó | — | BYOK; hosted usa chaves pessoais cifradas e origens públicas permitidas. | — |

## Evidências no código

- `Agents`: `apps/mcp/src/server.ts#L41` — trecho esperado: `export function createStruktServer`
- `AI`: `apps/remote/src/hostedAi.ts#L149` — trecho esperado: `export function createHostedAi`
- `Browser`: `apps/web/src/workspace/idb.ts#L56` — trecho esperado: `createIdbAdapter`
- `Browser`: `packages/workspace/src/saver.ts` — trecho esperado: `onSettled`
- `Browser`: `packages/workspace/src/saver.test.ts` — trecho esperado: `reports completed writes`
- `Domain`: `packages/core/src/model.ts#L127` — trecho esperado: `export interface DiagramModel`
- `Extension`: `apps/vscode/src/extension.ts#L22` — trecho esperado: `export function activate`
- `GitHub`: `apps/remote/src/githubWorkspace.ts#L57` — trecho esperado: `export async function openGithubWorkspace`
- `Local`: `apps/server/src/app.ts#L168` — trecho esperado: `export function createApp`
- `Remote`: `apps/remote/src/app.ts#L24` — trecho esperado: `export function createRemoteApp`
- `Remote`: `apps/remote/src/config.ts#L40` — trecho esperado: `JOINLET_DEPLOYMENT_MODE`
- `Remote`: `apps/remote/src/passwordAuth.ts#L7` — trecho esperado: `export function createPasswordAuth`
- `Remote`: `apps/remote/src/passwordSmoke.ts#L130` — trecho esperado: `Joinlet password smoke passed:`
- `Remote`: `apps/remote/src/accountDirectory.ts#L7` — trecho esperado: `export function accountDirectory`
- `Remote`: `apps/remote/src/profileSmoke.ts#L57` — trecho esperado: `Joinlet profile smoke passed:`
- `Remote`: `apps/remote/src/hostedWorkspacesSmoke.ts#L79` — trecho esperado: `Joinlet multiple workspaces smoke passed`
- `Remote`: `apps/remote/src/hostedStore.ts#L189` — trecho esperado: `const createWorkspace = db.transaction`
- `SQLite`: `apps/remote/src/hostedStore.ts#L53` — trecho esperado: `export function createHostedStore`
- `SQLite`: `apps/remote/src/accounts.ts` — trecho esperado: `export function createAccounts`
- `SQLite`: `apps/remote/src/recovery.ts` — trecho esperado: `export function invalidateRestoredAccess`
- `SQLite`: `apps/remote/src/profile.ts` — trecho esperado: `export function validateProfile`
- `Web`: `apps/web/src/workspace/workspace.ts#L28` — trecho esperado: `export interface WorkspaceState {`
- `Web`: `apps/web/src/settings/publicAccess.ts#L2` — trecho esperado: `export function isBrowserPreview`
- `Web`: `apps/web/src/analytics/client.ts` — trecho esperado: `export function trackAnalytics`
- `Web`: `apps/web/src/landing/Nav.tsx` — trecho esperado: `export function SiteNav`
- `Web`: `apps/web/docs/site.mjs` — trecho esperado: `export function renderPage`
- `Web`: `apps/web/src/brand/project.json` — trecho esperado: `https://github.com/MarcoPeixot/joinlet`
- `Web`: `apps/web/src/ui/uiStore.ts` — trecho esperado: `function initialThemePref`
- `Web`: `apps/web/src/settings/store.ts` — trecho esperado: `export async function refreshSettings`
- `Web`: `apps/web/src/settings/AiSetupGuide.tsx` — trecho esperado: `export function AiSetupGuide`
- `Web`: `apps/web/src/landing/landing.css` — trecho esperado: `.site-header[aria-modal=`
- `Web`: `apps/web/src/docs/markdown.ts` — trecho esperado: `export function renderMarkdown`
- `Web`: `apps/web/package.json` — trecho esperado: `"dompurify": "^3.4.17"`
- `Web`: `apps/web/src/analytics/docs.ts` — trecho esperado: `void startAnalytics()`
- `Web`: `apps/web/e2e/analytics.spec.ts` — trecho esperado: `content_saved`
- `Web`: `apps/web/src/analytics/runtime.ts` — trecho esperado: `export function trackAnalytics`
- `Web`: `apps/web/src/analytics/ConsentView.tsx` — trecho esperado: `export function AnalyticsConsent`
- `Web`: `apps/web/src/auth/AuthForm.tsx` — trecho esperado: `export function AuthForm`
- `Web`: `apps/web/src/auth/BrowserDraftBackup.tsx` — trecho esperado: `export function BrowserDraftBackup`
- `Web`: `apps/web/e2e/password.spec.ts` — trecho esperado: `exports the existing preview draft`
- `Web`: `apps/web/src/auth/AccountProfile.tsx` — trecho esperado: `export function AccountProfile`
- `Web`: `apps/web/src/workspace/ProjectsView.tsx` — trecho esperado: `Um workspace por enquanto`
- `Web`: `apps/web/e2e/publicPreview.spec.ts` — trecho esperado: `name: 'One workspace for now'`
- `Web`: `apps/web/src/onboarding/journey.ts#L10` — trecho esperado: `export function createJourney`
- `Web`: `apps/web/src/workspace/boot.ts#L214` — trecho esperado: `if (optional && query.get('account') === 'local')`
- `Web`: `apps/web/src/workspace/boot.ts#L217` — trecho esperado: `if (optional && query.get('account') !== 'login'`
- `Web`: `apps/remote/src/config.ts#L44` — trecho esperado: `optionalLogin: env.JOINLET_OPTIONAL_LOGIN === '1'`
- `Web`: `apps/web/src/auth/AuthForm.tsx#L54` — trecho esperado: `{allowsOptionalLogin() && \<Button`
- `Web`: `apps/web/e2e/optional-login.spec.ts#L13` — trecho esperado: `test('opens without login`
- `Workspace`: `packages/workspace/src/workspace.ts#L32` — trecho esperado: `export interface WorkspaceData`
- `Workspace`: `packages/workspace/src/beta.ts#L29` — trecho esperado: `SELF_HOSTED_PLAN`

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

## Documentos ligados

### Conexão e sincronização de repositórios

`.arch/docs/conexao-e-sincronizacao-de-repositorios.md` · ligado a: `Local`, `Remote`, `Agents`, `Workspace`

> # Conexão e sincronização de repositórios
>
> Implementação disponível no código. A ativação do serviço oficial e a homologação com GitHub real dependem do operador; os testes locais não comprovam publicação em produção.
>
> ## Conectar uma pasta
>
> […]
