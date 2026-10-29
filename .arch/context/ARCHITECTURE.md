# Arquitetura — Joinlet

> Gerado pelo Joinlet a partir de `.arch/`. Não edite à mão: mude os diagramas e os documentos no Joinlet e este arquivo se atualiza.

Cada diagrama traz o código JSON do Joinlet, que é a fonte da verdade, seguido das tabelas de componentes e conexões e de trechos dos documentos ligados aos componentes.

## Diagramas

- [Arquitetura do Joinlet](diagrams/arquitetura-do-joinlet.md) — 11 componentes, 14 conexões
- [Distribuição do código Joinlet](diagrams/distribuicao-do-codigo-joinlet.md) — 5 componentes, 4 conexões
- [Fluxo de release proposto](diagrams/fluxo-de-release-proposto.md) — 9 componentes, 9 conexões
- [Sincronização de repositórios](diagrams/sincronizacao-de-repositorios.md) — 14 componentes, 17 conexões
- [Visão geral — Joinlet](diagrams/repository.md) — 16 componentes, 44 conexões

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
      "description": "Canvas, documentos, sketches e adaptadores; prévia pública browser-preview abre um workspace sem conta em IndexedDB, com contas adicionais futuras. O modo remoto autenticado permanece separado. Landing e documentação estática bilíngue oferecem acesso ao repositório público; guias seguem os grupos do menu também na paginação. Tema escuro e inglês por padrão, preservando escolhas salvas. A configuração de IA na prévia pública explica a limitação e orienta a execução local sem tentar carregar provedores indisponíveis. Métricas opcionais e explícitas dependem da configuração do operador e consentimento do visitante, sem conteúdo dos projetos. Analytics opcional v2 cobre landing, guias e editor com consentimento versionado, contexto categórico, IDs idempotentes e atribuição consentida entre origens do operador. Ativação exige alteração significativa seguida de gravação concluída; exportações têm formato explícito. Não envia conteúdo, nomes, caminhos ou erros livres. A entrada hospedada oferece cadastro, login e troca de senha; GitHub aparece apenas quando configurado. A tela de login exporta rascunhos antigos em IndexedDB sem apagá-los. O formulário é carregado sob demanda sem introduzir importação dinâmica do barrel completo de workspace, evitando ciclos de inicialização no build. Contas hospedadas podem editar nome e foto rasterizada em Configurações, com telas em português e inglês carregadas sob demanda. Em browser-preview, abre um workspace local sem login/cadastro; workspaces adicionais mostram indisponibilidade temporária sem oferecer autenticação. Contas hospedadas não são acessadas ou migradas por essa modalidade. Dono Cloud dispõe de catálogo com vários workspaces e escopo independente por aba; prévia sem conta continua limitada a um. Abrir pasta encaminha ao conector e comandos permitem seleção e cópia. Contexto é automático, sem modal manual. Jornada contextual v2 por workspace/revisão, sem dependência de analytics. Evidências mostram caminho, linha e trecho seguro. Progresso exige resultados; edição de código, documentos e catálogos completos carregam ao uso. Orçamento de abertura inclui imports dinâmicos e workers. Com JOINLET_OPTIONAL_LOGIN=1, visitante sem sessão abre o editor em IndexedDB e dispõe de Entrar na conta. A entrada explícita oferece Continuar sem conta; links de workspace e convites preservam autorização. Rascunhos locais e dados Cloud não são mesclados automaticamente. Serviços Cloud mantêm autenticação. DiagramCanvas e CanvasScope compartilham renderização, seleção, gestos e roteamento entre diagrama e Overview, com stores e históricos independentes. scene.ts traduz board.json sem alterar seu formato; chaves estáveis acompanham a renumeração de conexões e undo/redo."
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
      "description": "OAuth, contas, workspaces hospedados, convites, MCP remoto e admissão; política self-hosted por padrão ou Cloud escolhida no ambiente confiável. A autenticação por e-mail/senha usa Argon2id assíncrono, limites por IP/identificador, CSRF e sessões revogáveis por versão. O modo senha inicia sem credenciais GitHub. Confirmação, recuperação por e-mail e vínculo entre métodos ficam fora desta primeira entrega; o endereço não é identidade verificada. Analytics do HTML remoto permanece opcional por configuração explícita. Perfil pessoal exige sessão e CSRF, sem alterar e-mail ou privilégios. Diretório de contas é somente leitura, desabilitado sem credencial dedicada de serviço; o proxy público bloqueia /api/internal. A projeção paginada contém cadastro e métodos de acesso, sem senhas, sessões, chaves ou conteúdo de projetos. O painel administrativo do operador permanece separado. Conexões locais/GitHub, autorização vinculada à conta existente, fila SQLite, snapshots SHA e worker separado com publicação por lote em um PR. Múltiplos workspaces por dono, migração de IDs e convites preservados e autorização de escopo por requisição. Senhas novas no cadastro e na troca usam uma política compartilhada entre navegador e servidor: 8 a 128 caracteres Unicode, com pelo menos uma pontuação ou símbolo. A entrada e a confirmação da senha atual verificam credenciais existentes sem impor a nova composição; espaços não são removidos. Argon2id, CSRF, limites e revogação de sessões permanecem aplicados.",
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
      "description": "Persistência em IndexedDB ou pasta do usuário. O salvador distingue gravação efetiva, erro terminal, cancelamento e dados já conhecidos; telemetria de conteúdo salvo só acompanha gravações reais após interação significativa. Memória volátil não é tratada como persistência. O Overview grava arraste e redimensionamento ao concluir o gesto. A saída pede confirmação quando há memória volátil, gravação pendente ou falha, ou edição de código pendente/não aplicada. pagehide e visibilitychange tentam concluir gravações, sem garantia de durabilidade; um salvamento confirmado em adaptador persistente não exibe aviso."
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

### Componentes

| Componente | Tipo | Tecnologia | Descrição | Grupo |
| --- | --- | --- | --- | --- |
| Editor web (`Web`) | nó | React · Vite | Canvas, documentos, sketches e adaptadores; prévia pública browser-preview abre um workspace sem conta em IndexedDB, com contas adicionais futuras. O modo remoto autenticado permanece separado. Landing e documentação estática bilíngue oferecem acesso ao repositório público; guias seguem os grupos do menu também na paginação. Tema escuro e inglês por padrão, preservando escolhas salvas. A configuração de IA na prévia pública explica a limitação e orienta a execução local sem tentar carregar provedores indisponíveis. Métricas opcionais e explícitas dependem da configuração do operador e consentimento do visitante, sem conteúdo dos projetos. Analytics opcional v2 cobre landing, guias e editor com consentimento versionado, contexto categórico, IDs idempotentes e atribuição consentida entre origens do operador. Ativação exige alteração significativa seguida de gravação concluída; exportações têm formato explícito. Não envia conteúdo, nomes, caminhos ou erros livres. A entrada hospedada oferece cadastro, login e troca de senha; GitHub aparece apenas quando configurado. A tela de login exporta rascunhos antigos em IndexedDB sem apagá-los. O formulário é carregado sob demanda sem introduzir importação dinâmica do barrel completo de workspace, evitando ciclos de inicialização no build. Contas hospedadas podem editar nome e foto rasterizada em Configurações, com telas em português e inglês carregadas sob demanda. Em browser-preview, abre um workspace local sem login/cadastro; workspaces adicionais mostram indisponibilidade temporária sem oferecer autenticação. Contas hospedadas não são acessadas ou migradas por essa modalidade. Dono Cloud dispõe de catálogo com vários workspaces e escopo independente por aba; prévia sem conta continua limitada a um. Abrir pasta encaminha ao conector e comandos permitem seleção e cópia. Contexto é automático, sem modal manual. Jornada contextual v2 por workspace/revisão, sem dependência de analytics. Evidências mostram caminho, linha e trecho seguro. Progresso exige resultados; edição de código, documentos e catálogos completos carregam ao uso. Orçamento de abertura inclui imports dinâmicos e workers. Com JOINLET\_OPTIONAL\_LOGIN=1, visitante sem sessão abre o editor em IndexedDB e dispõe de Entrar na conta. A entrada explícita oferece Continuar sem conta; links de workspace e convites preservam autorização. Rascunhos locais e dados Cloud não são mesclados automaticamente. Serviços Cloud mantêm autenticação. DiagramCanvas e CanvasScope compartilham renderização, seleção, gestos e roteamento entre diagrama e Overview, com stores e históricos independentes. scene.ts traduz board.json sem alterar seu formato; chaves estáveis acompanham a renumeração de conexões e undo/redo. | — |
| API local (`Local`) | nó | Hono · Bun | IA, Git, filesystem e integrações locais; self-hosted sem cotas comerciais, com limites técnicos e origem local. Serviço de repositório, diagnóstico Git, init e acompanhamento incremental; conector local ou pareado por conexão de saída. | — |
| Backend hospedável (`Remote`) | nó | Express · Bun | OAuth, contas, workspaces hospedados, convites, MCP remoto e admissão; política self-hosted por padrão ou Cloud escolhida no ambiente confiável. A autenticação por e-mail/senha usa Argon2id assíncrono, limites por IP/identificador, CSRF e sessões revogáveis por versão. O modo senha inicia sem credenciais GitHub. Confirmação, recuperação por e-mail e vínculo entre métodos ficam fora desta primeira entrega; o endereço não é identidade verificada. Analytics do HTML remoto permanece opcional por configuração explícita. Perfil pessoal exige sessão e CSRF, sem alterar e-mail ou privilégios. Diretório de contas é somente leitura, desabilitado sem credencial dedicada de serviço; o proxy público bloqueia /api/internal. A projeção paginada contém cadastro e métodos de acesso, sem senhas, sessões, chaves ou conteúdo de projetos. O painel administrativo do operador permanece separado. Conexões locais/GitHub, autorização vinculada à conta existente, fila SQLite, snapshots SHA e worker separado com publicação por lote em um PR. Múltiplos workspaces por dono, migração de IDs e convites preservados e autorização de escopo por requisição. Senhas novas no cadastro e na troca usam uma política compartilhada entre navegador e servidor: 8 a 128 caracteres Unicode, com pelo menos uma pontuação ou símbolo. A entrada e a confirmação da senha atual verificam credenciais existentes sem impor a nova composição; espaços não são removidos. Argon2id, CSRF, limites e revogação de sessões permanecem aplicados. | — |
| CLI e MCP (`Agents`) | nó | — | Leitura e escrita de arquitetura, contexto, evidências, importação e validação. CLI init/connect/watch e request\_repository\_sync; fontes autorizadas ampliam diagnóstico e encaminhamento, preservando o limite de não reescrever a aplicação. Blocos gerenciados em AGENTS.md e CLAUDE.md apontam ao contexto vivo, preservando instruções humanas. | — |
| Extensão VS Code (`Extension`) | nó | — | Comandos e diagnósticos de diagramas no editor. | — |
| Modelo e operações (`Domain`) | nó | — | Core, formatos JSON/DSL, operações validadas, layout e Git. | — |
| `Workspace` | nó | — | Manifesto, versões, contexto, evidências e Yjs; políticas isoladas por requisição. Motor compartilhado de repositório com extração sintática de 18 linguagens/formatos, referências por módulo e dependências classificadas. Gramáticas WASM ficam no backend e em assets locais. Diagnósticos, mesclagem e escrita coordenada preservam autoria e explicitam cobertura parcial. | — |
| Armazenamento local (`Browser`) | nó | IndexedDB · File System Access | Persistência em IndexedDB ou pasta do usuário. O salvador distingue gravação efetiva, erro terminal, cancelamento e dados já conhecidos; telemetria de conteúdo salvo só acompanha gravações reais após interação significativa. Memória volátil não é tratada como persistência. O Overview grava arraste e redimensionamento ao concluir o gesto. A saída pede confirmação quando há memória volátil, gravação pendente ou falha, ou edição de código pendente/não aplicada. pagehide e visibilitychange tentam concluir gravações, sem garantia de durabilidade; um salvamento confirmado em adaptador persistente não exibe aviso. | — |
| Persistência hospedada (`SQLite`) | nó | SQLite | Dados e segredos de runtime pertencem ao operador e ficam fora do Git. Contas têm IDs internos independentes de subjects GitHub; migração versionada reserva IDs legados e preserva dados. Senhas são hashes; trocar senha invalida sessões antigas. A ferramenta recovery invalida acessos e convites em snapshots restaurados sem apagar workspaces. Migração v2 adiciona foto e datas sem inventar datas históricas. Nome/foto pertencem ao ID interno; sessões existentes leem o nome atual. Cadastros novos e logins passam a registrar seus instantes. | — |
| `GitHub` | nó | — | OAuth e workspace por branch/PR quando um repositório está conectado. | — |
| Providers de IA (`AI`) | nó | — | BYOK; hosted usa chaves pessoais cifradas e origens públicas permitidas. | — |

### Evidências no código

- `Agents`: `apps/mcp/src/server.ts#L41` — trecho esperado: `export function createStruktServer`
- `AI`: `apps/remote/src/hostedAi.ts#L149` — trecho esperado: `export function createHostedAi`
- `Browser`: `apps/web/src/workspace/idb.ts#L56` — trecho esperado: `createIdbAdapter`
- `Browser`: `packages/workspace/src/saver.ts` — trecho esperado: `onSettled`
- `Browser`: `packages/workspace/src/saver.test.ts` — trecho esperado: `reports completed writes`
- `Browser`: `apps/web/src/workspace/boot.ts#L586` — trecho esperado: `export function shouldWarnOnUnload`
- `Browser`: `apps/web/src/workspace/boot.test.ts#L437` — trecho esperado: `warns for the actual memory fallback`
- `Domain`: `packages/core/src/model.ts#L127` — trecho esperado: `export interface DiagramModel`
- `Extension`: `apps/vscode/src/extension.ts#L22` — trecho esperado: `export function activate`
- `GitHub`: `apps/remote/src/githubWorkspace.ts#L57` — trecho esperado: `export async function openGithubWorkspace`
- `Local`: `apps/server/src/app.ts#L168` — trecho esperado: `export function createApp`
- `Remote`: `apps/remote/src/app.ts#L24` — trecho esperado: `export function createRemoteApp`
- `Remote`: `apps/remote/src/config.ts#L40` — trecho esperado: `JOINLET_DEPLOYMENT_MODE`
- `Remote`: `apps/remote/src/passwordAuth.ts#L8` — trecho esperado: `export function createPasswordAuth`
- `Remote`: `apps/remote/src/passwordSmoke.ts#L143` — trecho esperado: `Joinlet password smoke passed:`
- `Remote`: `apps/remote/src/accountDirectory.ts#L7` — trecho esperado: `export function accountDirectory`
- `Remote`: `apps/remote/src/profileSmoke.ts#L57` — trecho esperado: `Joinlet profile smoke passed:`
- `Remote`: `apps/remote/src/hostedWorkspacesSmoke.ts#L79` — trecho esperado: `Joinlet multiple workspaces smoke passed`
- `Remote`: `apps/remote/src/hostedStore.ts#L189` — trecho esperado: `const createWorkspace = db.transaction`
- `Remote`: `packages/workspace/src/passwordPolicy.ts#L11` — trecho esperado: `export function isNewPassword`
- `Remote`: `apps/remote/src/passwordAuth.ts#L79` — trecho esperado: `if (req.path === '/api/auth/register') validatePassword`
- `Remote`: `apps/remote/src/passwordSmoke.ts#L120` — trecho esperado: `const legacyPassword = 'ExistingPasswordWithoutPunctuation'`
- `Remote`: `apps/web/src/auth/AuthForm.tsx#L23` — trecho esperado: `if (mode === 'register' && !isNewPassword(password))`
- `Remote`: `apps/web/src/auth/AccountPassword.tsx#L20` — trecho esperado: `if (!isNewPassword(password))`
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
- `Web`: `apps/web/src/workspace/boot.ts#L232` — trecho esperado: `if (optional && query.get('account') === 'local')`
- `Web`: `apps/web/src/workspace/boot.ts#L235` — trecho esperado: `if (optional && query.get('account') !== 'login'`
- `Web`: `apps/remote/src/config.ts#L44` — trecho esperado: `optionalLogin: env.JOINLET_OPTIONAL_LOGIN === '1'`
- `Web`: `apps/web/src/auth/AuthForm.tsx#L56` — trecho esperado: `{allowsOptionalLogin() && \<Button`
- `Web`: `apps/web/e2e/optional-login.spec.ts#L13` — trecho esperado: `test('opens without login`
- `Web`: `apps/web/src/canvas/scope.tsx#L26` — trecho esperado: `export interface CanvasScope`
- `Web`: `apps/web/src/canvas/DiagramCanvas.tsx#L124` — trecho esperado: `export function DiagramCanvas`
- `Workspace`: `packages/workspace/src/workspace.ts#L32` — trecho esperado: `export interface WorkspaceData`
- `Workspace`: `packages/workspace/src/beta.ts#L29` — trecho esperado: `SELF_HOSTED_PLAN`

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

### Documentos ligados

#### Conexão e sincronização de repositórios

`.arch/docs/conexao-e-sincronizacao-de-repositorios.md` · ligado a: `Local`, `Remote`, `Agents`, `Workspace`

> # Conexão e sincronização de repositórios
>
> Implementação disponível no código. A ativação do serviço oficial e a homologação com GitHub real dependem do operador; os testes locais não comprovam publicação em produção.
>
> ## Conectar uma pasta
>
> […]

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

## Sincronização de repositórios

`.arch/diagrams/sincronizacao-de-repositorios.strukt.json` · 14 componentes, 17 conexões

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
      "id": "Editor",
      "label": "Editor web",
      "presentation": "card",
      "layoutRole": "entry",
      "icon": "browser",
      "description": "Conexão, progresso, conflitos e sincronização contínua. Overview com filtros e aviso de aprofundamento: IA do Joinlet recebe fontes reais delimitadas por revisão/política; agente local recebe tarefa e MCP. Documentos de fonte preservam autoria. Na reconexão, a abertura automática espera estado concluído (ready/review/paused) com revisão persistida. Resposta 409 de inicialização pendente mantém a intenção de abertura para a próxima consulta concluída, sem aberturas simultâneas.",
      "link": "doc:conexao-e-sincronizacao-de-repositorios"
    },
    {
      "id": "CLI",
      "label": "CLI e MCP",
      "presentation": "card",
      "layoutRole": "entry",
      "icon": "terminal",
      "description": "init/connect/watch/sync/context/verify e MCP. Aprofundamento por inventário/leitura paginados, plano de análise, organização de pastas e vínculos no Overview, com revisão explícita e escrita coordenada.",
      "link": "doc:conexao-e-sincronizacao-de-repositorios"
    },
    {
      "id": "Connector",
      "label": "Conector pareado",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "plug",
      "description": "Pasta confinada, Git, observação e conexão autenticada de saída com o Cloud. Encaminha snapshots de contexto, revisão/política e páginas de fontes ao editor e MCP sem endpoints privilegiados públicos em localhost.",
      "link": "doc:conexao-e-sincronizacao-de-repositorios"
    },
    {
      "id": "Local",
      "label": "Serviço local",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "server",
      "description": "Conexões limitadas à pasta, diagnóstico Git, tarefas, eventos e acompanhamento incremental. Mantém blocos de referência ao contexto em AGENTS.md e CLAUDE.md, preservando conteúdo manual e sinalizando conflitos.",
      "link": "doc:conexao-e-sincronizacao-de-repositorios"
    },
    {
      "id": "Hub",
      "label": "API hospedada",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "server",
      "description": "Autorização GitHub na conta existente, pairing, revisão e outbox para a pasta. Conexões isoladas por workspace selecionado e retorno OAuth ao projeto de origem.",
      "link": "doc:conexao-e-sincronizacao-de-repositorios"
    },
    {
      "id": "Worker",
      "label": "Worker GitHub",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "workflow",
      "description": "Tarefas com lease; snapshots SHA, revisão antes de publicação e um PR atualizado. Inclui as instruções de agentes no mesmo commit da arquitetura e do contexto.",
      "link": "doc:conexao-e-sincronizacao-de-repositorios"
    },
    {
      "id": "Engine",
      "label": "Análise e mesclagem",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "layers",
      "description": "Extração sintática, propriedade de arquivos, classificação de dependências e mesclagem de três versões. Descrições de IA exigem referências do próprio módulo; inferências cruzadas viram propostas. Diagnósticos sem chamadas de IA preservam metadados e ignoram providers quando ai=false.",
      "link": "doc:conexao-e-sincronizacao-de-repositorios"
    },
    {
      "id": "Importers",
      "label": "Importadores",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "git-merge",
      "description": "Detecta fontes reconhecidas e mantém mapeamentos e bases.",
      "link": "doc:conexao-e-sincronizacao-de-repositorios"
    },
    {
      "id": "AI",
      "label": "IA BYOK",
      "presentation": "card",
      "layoutRole": "shared",
      "icon": "sparkles",
      "description": "Interpretação BYOK de responsabilidades com referências verificadas. A mesma chamada pode escolher a tecnologia principal entre sinais comprovados no próprio módulo. O motor valida o catálogo e as evidências; inferências de componentes e relações vão para revisão.",
      "link": "doc:conexao-e-sincronizacao-de-repositorios"
    },
    {
      "id": "Architecture",
      "label": ".arch",
      "presentation": "card",
      "layoutRole": "shared",
      "icon": "file-json",
      "description": "Modelo, layout, docs, evidências, fontes, base gerenciada e contexto. Gravações com versões esperadas.",
      "link": "doc:conexao-e-sincronizacao-de-repositorios"
    },
    {
      "id": "Runtime",
      "label": "Estado de execução",
      "presentation": "card",
      "layoutRole": "shared",
      "icon": "database",
      "description": "SQLite, tarefas, outbox e leases. API, worker e colaboração aguardam locks por até 5 segundos antes das migrações/WAL. Segredos e journals ficam fora do Git.",
      "link": "doc:conexao-e-sincronizacao-de-repositorios"
    },
    {
      "id": "GitHub",
      "label": "GitHub",
      "presentation": "card",
      "layoutRole": "shared",
      "icon": "github",
      "description": "Árvores/blobs imutáveis, branch de trabalho e PR; sem execução de código do projeto.",
      "link": "doc:conexao-e-sincronizacao-de-repositorios"
    },
    {
      "id": "Knowledge",
      "label": "Documentação e Overview",
      "presentation": "card",
      "icon": "file-text",
      "tech": "Markdown · pastas · vínculos",
      "description": "Projeções de Markdown com origem, hashes e conflitos; pastas por caminho, vínculos explícitos e visão principal. O Overview traduz board.json em modelo/layout para DiagramCanvas com CanvasScope e store próprios. Cards viram nós e seções viram grupos; filtros preservam itens ocultos. IDs persistentes e curvas das conexões sobrevivem à renumeração de arestas, exclusão e undo/redo por chaves estáveis no histórico e metadados lembrados. Arrastes e redimensionamentos são gravados ao fim do gesto. Cards novos têm corredores de 120 px; Espaçar amplia intervalos sem reordenar cards, mantém conteúdo/conexões e expande seções, usando o mesmo núcleo via MCP. O roteador compartilhado calcula rotas automáticas; curvas manuais usam connectionPath. Preserva autoria, exclusões e posições até ação explícita.",
      "link": "doc:conexao-e-sincronizacao-de-repositorios"
    },
    {
      "id": "Syntax",
      "label": "Parsers sintáticos",
      "presentation": "card",
      "icon": "code",
      "tech": "Tree-sitter · WASM",
      "description": "Gramáticas locais verificadas para 18 linguagens e formatos. Scripts/frontmatter preservam linhas. Não executa fontes; tipos/desenvolvimento e limitações ficam separados do mapa principal. Assets acompanham conectores e imagem.",
      "link": "doc:confiabilidade-analise-sintatica-e-onboarding"
    }
  ],
  "connections": [
    {
      "from": "Editor",
      "to": "Local",
      "label": "pasta local"
    },
    {
      "from": "Editor",
      "to": "Hub",
      "label": "conta e repositório"
    },
    {
      "from": "CLI",
      "to": "Engine",
      "label": "comandos"
    },
    {
      "from": "Connector",
      "to": "Hub",
      "label": "saída HTTPS autenticada"
    },
    {
      "from": "Connector",
      "to": "Local",
      "label": "pasta autorizada"
    },
    {
      "from": "Local",
      "to": "Engine",
      "label": "eventos incrementais"
    },
    {
      "from": "Hub",
      "to": "Runtime",
      "label": "fila e alterações pendentes"
    },
    {
      "from": "Worker",
      "to": "Runtime",
      "label": "deduplicação e lease"
    },
    {
      "from": "Worker",
      "to": "Engine",
      "label": "análise fixada por SHA"
    },
    {
      "from": "Worker",
      "to": "GitHub",
      "label": "commit por lote e PR"
    },
    {
      "from": "Engine",
      "to": "Importers",
      "label": "fontes reconhecidas"
    },
    {
      "from": "Engine",
      "to": "AI",
      "label": "interpretação e propostas"
    },
    {
      "from": "Engine",
      "to": "Architecture",
      "label": "mesclagem e evidências"
    },
    {
      "from": "CLI",
      "to": "Architecture",
      "label": "MCP e revisão CAS"
    },
    {
      "from": "Engine",
      "to": "Knowledge",
      "label": "Markdown e metadados"
    },
    {
      "from": "Knowledge",
      "to": "Architecture",
      "label": "documentos, pastas e vínculos"
    },
    {
      "from": "Engine",
      "to": "Syntax",
      "label": "declarações e referências"
    }
  ]
}
```

### Componentes

| Componente | Tipo | Tecnologia | Descrição | Grupo |
| --- | --- | --- | --- | --- |
| Editor web (`Editor`) | nó | — | Conexão, progresso, conflitos e sincronização contínua. Overview com filtros e aviso de aprofundamento: IA do Joinlet recebe fontes reais delimitadas por revisão/política; agente local recebe tarefa e MCP. Documentos de fonte preservam autoria. Na reconexão, a abertura automática espera estado concluído (ready/review/paused) com revisão persistida. Resposta 409 de inicialização pendente mantém a intenção de abertura para a próxima consulta concluída, sem aberturas simultâneas. | — |
| CLI e MCP (`CLI`) | nó | — | init/connect/watch/sync/context/verify e MCP. Aprofundamento por inventário/leitura paginados, plano de análise, organização de pastas e vínculos no Overview, com revisão explícita e escrita coordenada. | — |
| Conector pareado (`Connector`) | nó | — | Pasta confinada, Git, observação e conexão autenticada de saída com o Cloud. Encaminha snapshots de contexto, revisão/política e páginas de fontes ao editor e MCP sem endpoints privilegiados públicos em localhost. | — |
| Serviço local (`Local`) | nó | — | Conexões limitadas à pasta, diagnóstico Git, tarefas, eventos e acompanhamento incremental. Mantém blocos de referência ao contexto em AGENTS.md e CLAUDE.md, preservando conteúdo manual e sinalizando conflitos. | — |
| API hospedada (`Hub`) | nó | — | Autorização GitHub na conta existente, pairing, revisão e outbox para a pasta. Conexões isoladas por workspace selecionado e retorno OAuth ao projeto de origem. | — |
| Worker GitHub (`Worker`) | nó | — | Tarefas com lease; snapshots SHA, revisão antes de publicação e um PR atualizado. Inclui as instruções de agentes no mesmo commit da arquitetura e do contexto. | — |
| Análise e mesclagem (`Engine`) | nó | — | Extração sintática, propriedade de arquivos, classificação de dependências e mesclagem de três versões. Descrições de IA exigem referências do próprio módulo; inferências cruzadas viram propostas. Diagnósticos sem chamadas de IA preservam metadados e ignoram providers quando ai=false. | — |
| Importadores (`Importers`) | nó | — | Detecta fontes reconhecidas e mantém mapeamentos e bases. | — |
| IA BYOK (`AI`) | nó | — | Interpretação BYOK de responsabilidades com referências verificadas. A mesma chamada pode escolher a tecnologia principal entre sinais comprovados no próprio módulo. O motor valida o catálogo e as evidências; inferências de componentes e relações vão para revisão. | — |
| .arch (`Architecture`) | nó | — | Modelo, layout, docs, evidências, fontes, base gerenciada e contexto. Gravações com versões esperadas. | — |
| Estado de execução (`Runtime`) | nó | — | SQLite, tarefas, outbox e leases. API, worker e colaboração aguardam locks por até 5 segundos antes das migrações/WAL. Segredos e journals ficam fora do Git. | — |
| `GitHub` | nó | — | Árvores/blobs imutáveis, branch de trabalho e PR; sem execução de código do projeto. | — |
| Documentação e Overview (`Knowledge`) | nó | Markdown · pastas · vínculos | Projeções de Markdown com origem, hashes e conflitos; pastas por caminho, vínculos explícitos e visão principal. O Overview traduz board.json em modelo/layout para DiagramCanvas com CanvasScope e store próprios. Cards viram nós e seções viram grupos; filtros preservam itens ocultos. IDs persistentes e curvas das conexões sobrevivem à renumeração de arestas, exclusão e undo/redo por chaves estáveis no histórico e metadados lembrados. Arrastes e redimensionamentos são gravados ao fim do gesto. Cards novos têm corredores de 120 px; Espaçar amplia intervalos sem reordenar cards, mantém conteúdo/conexões e expande seções, usando o mesmo núcleo via MCP. O roteador compartilhado calcula rotas automáticas; curvas manuais usam connectionPath. Preserva autoria, exclusões e posições até ação explícita. | — |
| Parsers sintáticos (`Syntax`) | nó | Tree-sitter · WASM | Gramáticas locais verificadas para 18 linguagens e formatos. Scripts/frontmatter preservam linhas. Não executa fontes; tipos/desenvolvimento e limitações ficam separados do mapa principal. Assets acompanham conectores e imagem. | — |

### Evidências no código

- `AI`: `apps/server/src/repositoryAi.ts#L6` — trecho esperado: `export function repositoryAnalyzer(client: AiClient, model: string): RepositoryAnalyzer {`
- `AI`: `apps/server/src/repositoryAi.test.ts#L5` — trecho esperado: `it('sends detected stack`
- `Architecture`: `packages/workspace/src/repository/transaction.ts#L14` — trecho esperado: `export async function writeBatch(adapter: StorageAdapter, changes: FileMutation[]): Promise\<void\> {`
- `CLI`: `apps/cli/src/commands/repository.ts#L12` — trecho esperado: `export async function runRepository(args: CliArgs, io: CliIo): Promise\<number\> {`
- `CLI`: `apps/mcp/src/repositoryKnowledge.ts#L13` — trecho esperado: `export function registerRepositoryKnowledge`
- `CLI`: `apps/mcp/src/repositoryKnowledge.test.ts#L9` — trecho esperado: `it('offers grounded analysis`
- `Connector`: `apps/server/src/connector.ts#L47` — trecho esperado: `async function connectCloud(cloud:string,pair:string|undefined,directory:string|null,io:Io) {`
- `Connector`: `apps/server/src/connectorCredentials.ts#L28` — trecho esperado: `export async function loadConnectorCredentials`
- `Connector`: `apps/server/src/connectorCredentials.test.ts#L8` — trecho esperado: `it('resumes the connection`
- `Connector`: `packages/workspace/src/repository/sourceAccess.ts#L31` — trecho esperado: `export async function repositorySourceContext`
- `Connector`: `packages/workspace/src/repository/sourceAccess.test.ts#L12` — trecho esperado: `it('respects shared include/exclude`
- `edge:CLI→Architecture`: `apps/mcp/src/workspace.ts#L71` — trecho esperado: `await writeBatch(ws.adapter`
- `edge:CLI→Engine`: `apps/cli/src/commands/repository.ts#L23` — trecho esperado: `new RepositoryEngine(reader, adapter, analyzer)`
- `edge:CLI→Engine`: `apps/cli/src/commands/repository.ts#L25` — trecho esperado: `const instructions=args.check?`
- `edge:CLI→Engine`: `apps/cli/src/commands/repository.ts#L26` — trecho esperado: `locale: repositoryLocale(Intl.DateTimeFormat()`
- `edge:Connector→Hub`: `apps/server/src/connector.ts#L79` — trecho esperado: `post('/api/repository-connector/update'`
- `edge:Connector→Local`: `apps/server/src/connector.ts#L69` — trecho esperado: `service=createRepositoryService`
- `edge:Editor→Hub`: `apps/web/src/panels/RepositoryConnection.tsx#L62` — trecho esperado: `request('/api/repositories/github',{repo,branch,locale:getLocale()})`
- `edge:Editor→Local`: `apps/web/src/panels/RepositoryConnection.tsx#L25` — trecho esperado: `request('/api/repositories',{dir,locale:getLocale()})`
- `edge:Engine→AI`: `packages/workspace/src/repository/engine.ts#L137` — trecho esperado: `analyzer!.analyze`
- `edge:Engine→AI`: `apps/server/src/connector.ts#L64` — trecho esperado: `path==='/api/repository-connector/analyze'`
- `edge:Engine→AI`: `apps/remote/src/repositoryConnectorSmoke.ts#L30` — trecho esperado: `assert.equal(initial.connections[0]!.phase,'paused')`
- `edge:Engine→Architecture`: `packages/workspace/src/repository/engine.ts#L238` — trecho esperado: `await writeBatch(this.adapter`
- `edge:Engine→Importers`: `packages/workspace/src/repository/engine.ts#L224` — trecho esperado: `await synchronizeDiscoveredSources`
- `edge:Engine→Knowledge`: `packages/workspace/src/repository/engine.ts#L168` — trecho esperado: `const projected=projectRepositoryDocuments`
- `edge:Hub→Runtime`: `apps/remote/src/repositoryHub.ts#L280` — trecho esperado: `queue.command(c.id,{type:'apply'`
- `edge:Knowledge→Architecture`: `packages/workspace/src/repository/knowledge.ts#L55` — trecho esperado: `export function connectRepositoryKnowledge`
- `edge:Local→Engine`: `apps/server/src/repositories.ts#L53` — trecho esperado: `new RepositoryEngine(reader, storage, analyzer())`
- `edge:Worker→Engine`: `apps/remote/src/repositoryHub.ts#L259` — trecho esperado: `new RepositoryEngine(source,adapter,analyzer)`
- `edge:Worker→Engine`: `apps/remote/src/repositoryHub.ts#L260` — trecho esperado: `const instructions=target.syncAgentInstructions()`
- `edge:Worker→GitHub`: `apps/remote/src/repositoryHub.ts#L266` — trecho esperado: `const pullRequest=await target.flush()`
- `edge:Worker→Runtime`: `apps/remote/src/repositoryHub.ts#L242` — trecho esperado: `const job=queue.claim()`
- `Editor`: `apps/web/src/panels/RepositoryConnection.tsx#L17` — trecho esperado: `export function RepositoryConnection`
- `Editor`: `apps/web/src/workspace/remote.ts#L22` — trecho esperado: `export function matchesRemoteSource`
- `Editor`: `apps/web/src/app/CollaborationBridge.tsx#L27` — trecho esperado: `!matchesRemoteSource(session, source)`
- `Editor`: `apps/web/src/docs/DocView.tsx#L174` — trecho esperado: `matchesRemoteSource(session, source)`
- `Editor`: `apps/web/src/workspace/workspace.test.ts#L905` — trecho esperado: `'Joinlet Cloud'])('loads`
- `Editor`: `apps/web/src/workspace/openRepositoryFolder.ts#L11` — trecho esperado: `export async function openRepositoryFolder`
- `Editor`: `apps/web/src/ui/CopyCode.tsx#L8` — trecho esperado: `export function CopyCode`
- `Editor`: `apps/web/e2e/cloud-workspaces-real.spec.ts#L23` — trecho esperado: `test('uses real Cloud sessions`
- `Editor`: `apps/web/src/app/AppShell.tsx#L120` — trecho esperado: `function RepositoryDock()`
- `Editor`: `apps/web/src/github/session.ts#L42` — trecho esperado: `if(catalogStore.getState().cloud)`
- `Editor`: `apps/web/e2e/repository-real.spec.ts#L59` — trecho esperado: `test('opens a compact monorepo overview`
- `Editor`: `apps/web/src/panels/RepositoryEnrichmentNotice.tsx#L19` — trecho esperado: `export function RepositoryEnrichmentNotice`
- `Editor`: `apps/web/src/workspace/repositoryAnalysis.ts#L14` — trecho esperado: `export async function verifyRepositoryAnalysisContext`
- `Editor`: `apps/web/e2e/repository-real.spec.ts#L81` — trecho esperado: `test('offers source-backed enrichment`
- `Editor`: `apps/web/e2e/repository-real.spec.ts#L125` — trecho esperado: `test('rejects a delayed AI edit`
- `Editor`: `apps/web/src/panels/RepositoryConnection.tsx#L27` — trecho esperado: `const job=connections.find(c=\>c.id===pendingOpen.current`
- `Editor`: `apps/web/src/panels/RepositoryConnection.tsx#L36` — trecho esperado: `if((error as {status?:number}).status===409)return;`
- `Editor`: `apps/web/e2e/repository-real.spec.ts#L100` — trecho esperado: `test('waits for a completed analysis`
- `Engine`: `packages/workspace/src/repository/engine.ts#L53` — trecho esperado: `export class RepositoryEngine`
- `Engine`: `packages/workspace/src/repository/presentation.ts#L11` — trecho esperado: `export function repositoryPresentation`
- `Engine`: `packages/workspace/src/repository/presentation.ts#L40` — trecho esperado: `export function repositoryReadme`
- `Engine`: `packages/workspace/src/repository/layout.ts#L31` — trecho esperado: `export async function repositoryLayout`
- `Engine`: `packages/workspace/src/repository/presentation.test.ts#L23` — trecho esperado: `it('defaults to grouped modules`
- `Engine`: `packages/workspace/src/repository/technologies.ts#L59` — trecho esperado: `export function detectRepositoryTechnologies`
- `Engine`: `packages/workspace/src/repository/technologies.test.ts#L21` — trecho esperado: `it('detects frameworks`
- `Engine`: `packages/workspace/src/repository/facts.ts#L23` — trecho esperado: `export async function extractRepositoryFacts`
- `GitHub`: `apps/remote/src/repositorySnapshot.ts#L9` — trecho esperado: `export async function githubSnapshot(token: string, repo: string, branch: string, fetcher?: typeof fetch): Promise\<RepositoryReader & { sha: string }\> {`
- `Hub`: `apps/remote/src/repositoryHub.ts#L30` — trecho esperado: `export function createRepositoryHub(options: RemoteAuthOptions, auth: RemoteAuth, hosted: HostedBackend) {`
- `Hub`: `apps/remote/src/hostedStore.ts#L189` — trecho esperado: `const createWorkspace = db.transaction`
- `Hub`: `apps/remote/src/repositoryHub.ts#L91` — trecho esperado: `session.workspace;res.json({connections:`
- `Importers`: `packages/workspace/src/repository/importers.ts#L13` — trecho esperado: `export async function synchronizeDiscoveredSources(texts: Map\<string,string\>, data: WorkspaceData, before: Map\<string,string|null\>) {`
- `Knowledge`: `packages/workspace/src/repository/knowledge.ts#L21` — trecho esperado: `export function projectRepositoryDocuments`
- `Knowledge`: `packages/workspace/src/repository/knowledge.ts#L55` — trecho esperado: `export function connectRepositoryKnowledge`
- `Knowledge`: `packages/workspace/src/repository/knowledge.test.ts#L7` — trecho esperado: `it('imports every recognized Markdown`
- `Knowledge`: `apps/web/src/board/boardFlow.ts#L5` — trecho esperado: `export function boardInFolder`
- `Knowledge`: `packages/workspace/src/board.ts#L208` — trecho esperado: `export function spaceBoard`
- `Knowledge`: `apps/web/src/board/BoardView.tsx#L195` — trecho esperado: `const spaceOverview`
- `Knowledge`: `apps/mcp/src/repositoryKnowledge.ts#L28` — trecho esperado: `server.registerTool('space_overview'`
- `Knowledge`: `apps/web/e2e/overview-spacing.spec.ts#L3` — trecho esperado: `test('spaces existing Overview cards`
- `Knowledge`: `apps/web/src/board/scene.ts#L41` — trecho esperado: `export function boardToScene`
- `Knowledge`: `apps/web/src/state/diagramStore.ts#L56` — trecho esperado: `function followEdgeKeys`
- `Knowledge`: `apps/web/src/board/BoardView.tsx#L93` — trecho esperado: `const before = prev.pending ?? prev`
- `Knowledge`: `apps/web/src/board/connectionPath.ts#L60` — trecho esperado: `export function connectionRoute`
- `Knowledge`: `apps/web/e2e/overview-persistence.spec.ts#L27` — trecho esperado: `test('an Overview drag`
- `Local`: `apps/server/src/repositories.ts#L24` — trecho esperado: `export function createRepositoryService`
- `Local`: `packages/workspace/src/repository/agentInstructions.ts#L17` — trecho esperado: `export async function syncAgentInstructions`
- `Local`: `packages/workspace/src/repository/agentInstructions.test.ts#L21` — trecho esperado: `it('preserves malformed markers`
- `Runtime`: `apps/remote/src/repositoryQueue.ts#L5` — trecho esperado: `export function repositoryQueue`
- `Runtime`: `apps/remote/src/auth.ts#L94` — trecho esperado: `configureRuntimeDatabase(db)`
- `Runtime`: `apps/remote/src/collaboration.ts#L20` — trecho esperado: `configureRuntimeDatabase(db)`
- `Runtime`: `apps/remote/src/database.ts#L5` — trecho esperado: `db.exec('PRAGMA busy_timeout=5000')`
- `Runtime`: `apps/remote/src/repositoryStartupSmoke.ts#L29` — trecho esperado: `for(let round=0;round\<3;round++)`
- `Syntax`: `packages/workspace/src/repository/syntax.ts#L44` — trecho esperado: `export async function parseSource`
- `Worker`: `apps/remote/src/repositoryHub.ts#L240` — trecho esperado: `async function runNext() {`

### Conexões

| De | Para | Tipo | Rótulo |
| --- | --- | --- | --- |
| `Editor` | `Local` | `>` seta | pasta local |
| `Editor` | `Hub` | `>` seta | conta e repositório |
| `CLI` | `Engine` | `>` seta | comandos |
| `Connector` | `Hub` | `>` seta | saída HTTPS autenticada |
| `Connector` | `Local` | `>` seta | pasta autorizada |
| `Local` | `Engine` | `>` seta | eventos incrementais |
| `Hub` | `Runtime` | `>` seta | fila e alterações pendentes |
| `Worker` | `Runtime` | `>` seta | deduplicação e lease |
| `Worker` | `Engine` | `>` seta | análise fixada por SHA |
| `Worker` | `GitHub` | `>` seta | commit por lote e PR |
| `Engine` | `Importers` | `>` seta | fontes reconhecidas |
| `Engine` | `AI` | `>` seta | interpretação e propostas |
| `Engine` | `Architecture` | `>` seta | mesclagem e evidências |
| `CLI` | `Architecture` | `>` seta | MCP e revisão CAS |
| `Engine` | `Knowledge` | `>` seta | Markdown e metadados |
| `Knowledge` | `Architecture` | `>` seta | documentos, pastas e vínculos |
| `Engine` | `Syntax` | `>` seta | declarações e referências |

### Documentos ligados

#### Conexão e sincronização de repositórios

`.arch/docs/conexao-e-sincronizacao-de-repositorios.md` · ligado a: `Editor`, `CLI`, `Connector`, `Local`, `Hub`, `Worker`, `Engine`, `Importers`, `AI`, `Architecture`, `Runtime`, `GitHub`, `Knowledge`

> # Conexão e sincronização de repositórios
>
> Implementação disponível no código. A ativação do serviço oficial e a homologação com GitHub real dependem do operador; os testes locais não comprovam publicação em produção.
>
> ## Conectar uma pasta
>
> […]

#### Confiabilidade, análise sintática e onboarding

`.arch/docs/confiabilidade-analise-sintatica-e-onboarding.md` · ligado a: `Syntax`

> # Confiabilidade, análise sintática e onboarding
>
> O Joinlet extrai declarações sintáticas com Tree-sitter WebAssembly nos processos locais, CLI/MCP e worker hospedado. Os assets são locais, verificados por SHA-256 e acompanham conectores e imagem; não são carregados no frontend nem baixados durante a análise. O manifesto registra versão, integridade dos pacotes e avisos das gramáticas. Fontes analisadas nunca são executadas.
>
> ## Cobertura
>
> […]

## Visão geral — Joinlet

`.arch/diagrams/repository.strukt.json` · 16 componentes, 44 conexões

```json
{
  "$schema": "./strukt.schema.json",
  "version": 1,
  "style": {
    "styleMode": "plain"
  },
  "nodes": [
    {
      "id": "repo_8c5967fd8486f3",
      "label": "scripts",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "si:python",
      "tech": "Python · TypeScript",
      "description": "scripts · scripts · Python · TypeScript · Node.js"
    },
    {
      "id": "repo_group_d56f6359d240f6",
      "type": "group",
      "label": "Aplicações · apps",
      "layoutRole": "entry",
      "icon": "folder",
      "children": [
        {
          "id": "repo_09e11a52066c67",
          "label": "vscode",
          "presentation": "card",
          "icon": "si:typescript",
          "tech": "TypeScript · Node.js",
          "description": "strukt-vscode · apps/vscode · TypeScript · Node.js",
          "link": "doc:joinlet-para-vs-code"
        },
        {
          "id": "repo_3b4e3efd29cd13",
          "label": "web",
          "presentation": "card",
          "icon": "si:react",
          "tech": "React · TypeScript",
          "description": "@strukt/web · apps/web · React · TypeScript · JavaScript · Python · Node.js · Tailwind CSS · Vite"
        },
        {
          "id": "repo_484fb1e9cea553",
          "label": "server",
          "presentation": "card",
          "icon": "si:hono",
          "tech": "Hono · TypeScript",
          "description": "@strukt/server · apps/server · Hono · TypeScript · MCP · Bun · Node.js · SQLite"
        },
        {
          "id": "repo_4c5a34d0f0b789",
          "label": "mcp",
          "presentation": "card",
          "icon": "si:modelcontextprotocol",
          "tech": "MCP · TypeScript",
          "description": "@strukt/mcp · apps/mcp · MCP · TypeScript · Node.js"
        },
        {
          "id": "repo_86104d06094ed0",
          "label": "remote",
          "presentation": "card",
          "icon": "si:express",
          "tech": "Express · TypeScript",
          "description": "@strukt/remote · apps/remote · Express · TypeScript · MCP · Bun · Node.js · Docker · SQLite"
        },
        {
          "id": "repo_bde7b76204809a",
          "label": "cli",
          "presentation": "card",
          "icon": "si:typescript",
          "tech": "TypeScript · Node.js",
          "description": "@strukt/cli · apps/cli · TypeScript · Node.js"
        }
      ]
    },
    {
      "id": "repo_group_b28b1ed9821f38",
      "type": "group",
      "label": "Pacotes compartilhados · packages",
      "layoutRole": "shared",
      "icon": "folder",
      "children": [
        {
          "id": "repo_41ba823706ed42",
          "label": "layout",
          "presentation": "card",
          "icon": "si:typescript",
          "tech": "TypeScript",
          "description": "@strukt/layout · packages/layout · TypeScript"
        },
        {
          "id": "repo_5c1ab4b7e80ad1",
          "label": "dsl",
          "presentation": "card",
          "icon": "si:typescript",
          "tech": "TypeScript",
          "description": "@strukt/dsl · packages/dsl · TypeScript"
        },
        {
          "id": "repo_71391bfad4e6b4",
          "label": "git",
          "presentation": "card",
          "icon": "si:typescript",
          "tech": "TypeScript · Node.js",
          "description": "@strukt/git · packages/git · TypeScript · Node.js"
        },
        {
          "id": "repo_d4ff4b28356bed",
          "label": "workspace",
          "presentation": "card",
          "icon": "si:typescript",
          "tech": "TypeScript · Node.js",
          "description": "@strukt/workspace · packages/workspace · TypeScript · Node.js"
        },
        {
          "id": "repo_d5a16586640c40",
          "label": "ops",
          "presentation": "card",
          "icon": "si:typescript",
          "tech": "TypeScript",
          "description": "@strukt/ops · packages/ops · TypeScript"
        },
        {
          "id": "repo_e27f3faa9152db",
          "label": "core",
          "presentation": "card",
          "icon": "si:typescript",
          "tech": "TypeScript",
          "description": "@strukt/core · packages/core · TypeScript"
        },
        {
          "id": "repo_e86a0d465b5caa",
          "label": "json",
          "presentation": "card",
          "icon": "si:typescript",
          "tech": "TypeScript",
          "description": "@strukt/json · packages/json · TypeScript"
        }
      ]
    }
  ],
  "connections": [
    {
      "from": "repo_bde7b76204809a",
      "to": "repo_41ba823706ed42"
    },
    {
      "from": "repo_bde7b76204809a",
      "to": "repo_5c1ab4b7e80ad1"
    },
    {
      "from": "repo_bde7b76204809a",
      "to": "repo_71391bfad4e6b4"
    },
    {
      "from": "repo_bde7b76204809a",
      "to": "repo_d4ff4b28356bed"
    },
    {
      "from": "repo_bde7b76204809a",
      "to": "repo_d5a16586640c40"
    },
    {
      "from": "repo_bde7b76204809a",
      "to": "repo_e27f3faa9152db"
    },
    {
      "from": "repo_bde7b76204809a",
      "to": "repo_e86a0d465b5caa"
    },
    {
      "from": "repo_4c5a34d0f0b789",
      "to": "repo_41ba823706ed42"
    },
    {
      "from": "repo_4c5a34d0f0b789",
      "to": "repo_71391bfad4e6b4"
    },
    {
      "from": "repo_4c5a34d0f0b789",
      "to": "repo_d4ff4b28356bed"
    },
    {
      "from": "repo_4c5a34d0f0b789",
      "to": "repo_d5a16586640c40"
    },
    {
      "from": "repo_4c5a34d0f0b789",
      "to": "repo_e27f3faa9152db"
    },
    {
      "from": "repo_4c5a34d0f0b789",
      "to": "repo_e86a0d465b5caa"
    },
    {
      "from": "repo_86104d06094ed0",
      "to": "repo_484fb1e9cea553"
    },
    {
      "from": "repo_86104d06094ed0",
      "to": "repo_4c5a34d0f0b789"
    },
    {
      "from": "repo_86104d06094ed0",
      "to": "repo_d4ff4b28356bed"
    },
    {
      "from": "repo_484fb1e9cea553",
      "to": "repo_4c5a34d0f0b789"
    },
    {
      "from": "repo_484fb1e9cea553",
      "to": "repo_71391bfad4e6b4"
    },
    {
      "from": "repo_484fb1e9cea553",
      "to": "repo_d4ff4b28356bed"
    },
    {
      "from": "repo_484fb1e9cea553",
      "to": "repo_d5a16586640c40"
    },
    {
      "from": "repo_484fb1e9cea553",
      "to": "repo_e27f3faa9152db"
    },
    {
      "from": "repo_484fb1e9cea553",
      "to": "repo_e86a0d465b5caa"
    },
    {
      "from": "repo_09e11a52066c67",
      "to": "repo_e86a0d465b5caa"
    },
    {
      "from": "repo_3b4e3efd29cd13",
      "to": "repo_41ba823706ed42"
    },
    {
      "from": "repo_3b4e3efd29cd13",
      "to": "repo_5c1ab4b7e80ad1"
    },
    {
      "from": "repo_3b4e3efd29cd13",
      "to": "repo_d4ff4b28356bed"
    },
    {
      "from": "repo_3b4e3efd29cd13",
      "to": "repo_e27f3faa9152db"
    },
    {
      "from": "repo_3b4e3efd29cd13",
      "to": "repo_e86a0d465b5caa"
    },
    {
      "from": "repo_5c1ab4b7e80ad1",
      "to": "repo_e27f3faa9152db"
    },
    {
      "from": "repo_5c1ab4b7e80ad1",
      "to": "repo_e86a0d465b5caa"
    },
    {
      "from": "repo_71391bfad4e6b4",
      "to": "repo_d4ff4b28356bed"
    },
    {
      "from": "repo_71391bfad4e6b4",
      "to": "repo_e27f3faa9152db"
    },
    {
      "from": "repo_e86a0d465b5caa",
      "to": "repo_e27f3faa9152db"
    },
    {
      "from": "repo_41ba823706ed42",
      "to": "repo_e27f3faa9152db"
    },
    {
      "from": "repo_d5a16586640c40",
      "to": "repo_41ba823706ed42"
    },
    {
      "from": "repo_d5a16586640c40",
      "to": "repo_e27f3faa9152db"
    },
    {
      "from": "repo_d4ff4b28356bed",
      "to": "repo_41ba823706ed42"
    },
    {
      "from": "repo_d4ff4b28356bed",
      "to": "repo_5c1ab4b7e80ad1"
    },
    {
      "from": "repo_d4ff4b28356bed",
      "to": "repo_e27f3faa9152db"
    },
    {
      "from": "repo_d4ff4b28356bed",
      "to": "repo_e86a0d465b5caa"
    },
    {
      "from": "repo_bde7b76204809a",
      "to": "repo_484fb1e9cea553"
    },
    {
      "from": "repo_4c5a34d0f0b789",
      "to": "repo_484fb1e9cea553"
    },
    {
      "from": "repo_86104d06094ed0",
      "to": "repo_e27f3faa9152db"
    },
    {
      "from": "repo_8c5967fd8486f3",
      "to": "repo_d4ff4b28356bed"
    }
  ]
}
```

### Componentes

| Componente | Tipo | Tecnologia | Descrição | Grupo |
| --- | --- | --- | --- | --- |
| scripts (`repo_8c5967fd8486f3`) | nó | Python · TypeScript | scripts · scripts · Python · TypeScript · Node.js | — |
| Aplicações · apps (`repo_group_d56f6359d240f6`) | grupo | — | — | — |
| vscode (`repo_09e11a52066c67`) | nó | TypeScript · Node.js | strukt-vscode · apps/vscode · TypeScript · Node.js | `repo_group_d56f6359d240f6` |
| web (`repo_3b4e3efd29cd13`) | nó | React · TypeScript | @strukt/web · apps/web · React · TypeScript · JavaScript · Python · Node.js · Tailwind CSS · Vite | `repo_group_d56f6359d240f6` |
| server (`repo_484fb1e9cea553`) | nó | Hono · TypeScript | @strukt/server · apps/server · Hono · TypeScript · MCP · Bun · Node.js · SQLite | `repo_group_d56f6359d240f6` |
| mcp (`repo_4c5a34d0f0b789`) | nó | MCP · TypeScript | @strukt/mcp · apps/mcp · MCP · TypeScript · Node.js | `repo_group_d56f6359d240f6` |
| remote (`repo_86104d06094ed0`) | nó | Express · TypeScript | @strukt/remote · apps/remote · Express · TypeScript · MCP · Bun · Node.js · Docker · SQLite | `repo_group_d56f6359d240f6` |
| cli (`repo_bde7b76204809a`) | nó | TypeScript · Node.js | @strukt/cli · apps/cli · TypeScript · Node.js | `repo_group_d56f6359d240f6` |
| Pacotes compartilhados · packages (`repo_group_b28b1ed9821f38`) | grupo | — | — | — |
| layout (`repo_41ba823706ed42`) | nó | TypeScript | @strukt/layout · packages/layout · TypeScript | `repo_group_b28b1ed9821f38` |
| dsl (`repo_5c1ab4b7e80ad1`) | nó | TypeScript | @strukt/dsl · packages/dsl · TypeScript | `repo_group_b28b1ed9821f38` |
| git (`repo_71391bfad4e6b4`) | nó | TypeScript · Node.js | @strukt/git · packages/git · TypeScript · Node.js | `repo_group_b28b1ed9821f38` |
| workspace (`repo_d4ff4b28356bed`) | nó | TypeScript · Node.js | @strukt/workspace · packages/workspace · TypeScript · Node.js | `repo_group_b28b1ed9821f38` |
| ops (`repo_d5a16586640c40`) | nó | TypeScript | @strukt/ops · packages/ops · TypeScript | `repo_group_b28b1ed9821f38` |
| core (`repo_e27f3faa9152db`) | nó | TypeScript | @strukt/core · packages/core · TypeScript | `repo_group_b28b1ed9821f38` |
| json (`repo_e86a0d465b5caa`) | nó | TypeScript | @strukt/json · packages/json · TypeScript | `repo_group_b28b1ed9821f38` |

### Evidências no código

- `edge:repo_09e11a52066c67→repo_e86a0d465b5caa`: `apps/vscode/src/diagnostics.ts#L2` — trecho esperado: `'@strukt/json'`
- `edge:repo_3b4e3efd29cd13→repo_41ba823706ed42`: `apps/web/src/ai/aiStore.ts#L3` — trecho esperado: `'@strukt/layout'`
- `edge:repo_3b4e3efd29cd13→repo_5c1ab4b7e80ad1`: `apps/web/src/code/importFormats.ts#L2` — trecho esperado: `'@strukt/dsl/lite'`
- `edge:repo_3b4e3efd29cd13→repo_d4ff4b28356bed`: `apps/web/e2e/overview-persistence.spec.ts#L3` — trecho esperado: `'@strukt/workspace'`
- `edge:repo_3b4e3efd29cd13→repo_e27f3faa9152db`: `apps/web/e2e/group-composition.spec.ts#L4` — trecho esperado: `'@strukt/core'`
- `edge:repo_3b4e3efd29cd13→repo_e86a0d465b5caa`: `apps/web/src/code/sync.test.ts#L5` — trecho esperado: `'@strukt/json'`
- `edge:repo_41ba823706ed42→repo_e27f3faa9152db`: `packages/layout/src/canvasFrames.ts#L2` — trecho esperado: `'@strukt/core'`
- `edge:repo_484fb1e9cea553→repo_4c5a34d0f0b789`: `apps/server/src/app.ts#L27` — trecho esperado: `'@strukt/mcp'`
- `edge:repo_484fb1e9cea553→repo_71391bfad4e6b4`: `apps/server/src/app.ts#L24` — trecho esperado: `'@strukt/git'`
- `edge:repo_484fb1e9cea553→repo_d4ff4b28356bed`: `apps/server/src/app.ts#L9` — trecho esperado: `'@strukt/workspace'`
- `edge:repo_484fb1e9cea553→repo_d5a16586640c40`: `apps/server/src/prompt.ts#L5` — trecho esperado: `'@strukt/ops'`
- `edge:repo_484fb1e9cea553→repo_e27f3faa9152db`: `apps/server/src/chatEdit.ts#L4` — trecho esperado: `'@strukt/core'`
- `edge:repo_484fb1e9cea553→repo_e86a0d465b5caa`: `apps/server/src/chatEdit.ts#L5` — trecho esperado: `'@strukt/json'`
- `edge:repo_4c5a34d0f0b789→repo_41ba823706ed42`: `apps/mcp/src/tools.test.ts#L9` — trecho esperado: `'../../../packages/layout/src/groupComposition.fixture.json'`
- `edge:repo_4c5a34d0f0b789→repo_484fb1e9cea553`: `apps/mcp/src/main.ts#L20` — trecho esperado: `import('../../server/src/localRepositoryAi')`
- `edge:repo_4c5a34d0f0b789→repo_71391bfad4e6b4`: `apps/mcp/src/github.ts#L2` — trecho esperado: `'@strukt/git'`
- `edge:repo_4c5a34d0f0b789→repo_d4ff4b28356bed`: `apps/mcp/src/comments.test.ts#L2` — trecho esperado: `'@strukt/workspace'`
- `edge:repo_4c5a34d0f0b789→repo_d5a16586640c40`: `apps/mcp/src/tools.ts#L9` — trecho esperado: `'@strukt/ops'`
- `edge:repo_4c5a34d0f0b789→repo_e27f3faa9152db`: `apps/mcp/src/tools.test.ts#L7` — trecho esperado: `'@strukt/core'`
- `edge:repo_4c5a34d0f0b789→repo_e86a0d465b5caa`: `apps/mcp/src/perspectives.test.ts#L2` — trecho esperado: `'@strukt/json'`
- `edge:repo_5c1ab4b7e80ad1→repo_e27f3faa9152db`: `packages/dsl/src/diagramTree.test.ts#L2` — trecho esperado: `'@strukt/core'`
- `edge:repo_5c1ab4b7e80ad1→repo_e86a0d465b5caa`: `packages/dsl/src/import/cloud/graph.test.ts#L2` — trecho esperado: `'@strukt/json'`
- `edge:repo_71391bfad4e6b4→repo_d4ff4b28356bed`: `packages/git/src/diff.ts#L4` — trecho esperado: `'@strukt/workspace'`
- `edge:repo_71391bfad4e6b4→repo_e27f3faa9152db`: `packages/git/src/diff.ts#L2` — trecho esperado: `'@strukt/core'`
- `edge:repo_86104d06094ed0→repo_484fb1e9cea553`: `apps/remote/src/hostedAi.ts#L27` — trecho esperado: `"../../server/src/anthropic"`
- `edge:repo_86104d06094ed0→repo_4c5a34d0f0b789`: `apps/remote/src/app.ts#L11` — trecho esperado: `'@strukt/mcp'`
- `edge:repo_86104d06094ed0→repo_d4ff4b28356bed`: `apps/remote/src/betaAccounts.ts#L2` — trecho esperado: `'@strukt/workspace'`
- `edge:repo_86104d06094ed0→repo_e27f3faa9152db`: `apps/remote/src/hostedAi.ts#L7` — trecho esperado: `"@strukt/core"`
- `edge:repo_8c5967fd8486f3→repo_d4ff4b28356bed`: `scripts/check-repository-parsers.ts#L2` — trecho esperado: `'../packages/workspace/src/repository/syntax.ts'`
- `edge:repo_bde7b76204809a→repo_41ba823706ed42`: `apps/cli/src/commands/importCloud.ts#L8` — trecho esperado: `'@strukt/layout'`
- `edge:repo_bde7b76204809a→repo_484fb1e9cea553`: `apps/cli/src/commands/repository.ts#L14` — trecho esperado: `import('../../../server/src/connector')`
- `edge:repo_bde7b76204809a→repo_5c1ab4b7e80ad1`: `apps/cli/src/cloudCollect.ts#L2` — trecho esperado: `'@strukt/dsl/import'`
- `edge:repo_bde7b76204809a→repo_71391bfad4e6b4`: `apps/cli/src/cloudAllowlist.test.ts#L3` — trecho esperado: `'@strukt/git'`
- `edge:repo_bde7b76204809a→repo_d4ff4b28356bed`: `apps/cli/src/cloudDrift.ts#L5` — trecho esperado: `'@strukt/workspace/fs'`
- `edge:repo_bde7b76204809a→repo_d5a16586640c40`: `apps/cli/src/commands/sync.ts#L3` — trecho esperado: `'@strukt/ops'`
- `edge:repo_bde7b76204809a→repo_e27f3faa9152db`: `apps/cli/src/cloudDrift.ts#L1` — trecho esperado: `'@strukt/core'`
- `edge:repo_bde7b76204809a→repo_e86a0d465b5caa`: `apps/cli/src/commands/check.ts#L6` — trecho esperado: `'@strukt/json'`
- `edge:repo_d4ff4b28356bed→repo_41ba823706ed42`: `packages/workspace/src/repository/importers.ts#L1` — trecho esperado: `'@strukt/layout'`
- `edge:repo_d4ff4b28356bed→repo_5c1ab4b7e80ad1`: `packages/workspace/src/diagram.ts#L4` — trecho esperado: `'@strukt/dsl/lite'`
- `edge:repo_d4ff4b28356bed→repo_e27f3faa9152db`: `packages/workspace/src/collaboration.test.ts#L4` — trecho esperado: `'@strukt/core'`
- `edge:repo_d4ff4b28356bed→repo_e86a0d465b5caa`: `packages/workspace/src/diagram.ts#L6` — trecho esperado: `'@strukt/json'`
- `edge:repo_d5a16586640c40→repo_41ba823706ed42`: `packages/ops/src/plan.ts#L3` — trecho esperado: `'@strukt/layout'`
- `edge:repo_d5a16586640c40→repo_e27f3faa9152db`: `packages/ops/src/check.ts#L2` — trecho esperado: `'@strukt/core'`
- `edge:repo_e86a0d465b5caa→repo_e27f3faa9152db`: `packages/json/src/parse.test.ts#L2` — trecho esperado: `'@strukt/core'`
- `repo_09e11a52066c67`: `apps/vscode/package.json#L2` — trecho esperado: `"name": "strukt-vscode",`
- `repo_09e11a52066c67`: `apps/vscode/package.json#L13` — trecho esperado: `"node": "\>=22.4"`
- `repo_09e11a52066c67`: `apps/vscode/scripts/write-schema.ts#L1` — trecho esperado: `import { writeFile } from 'node:fs/promises';`
- `repo_09e11a52066c67`: `apps/vscode/src/appUrl.ts#L1` — trecho esperado: `export const DEFAULT_APP_URL = 'http://localhost:5178';`
- `repo_09e11a52066c67`: `apps/vscode/src/checkReport.ts#L1` — trecho esperado: `import type { EditorDiagnostic } from './diagnostics';`
- `repo_09e11a52066c67`: `apps/vscode/src/cli.ts#L1` — trecho esperado: ``/** How to launch the Joinlet CLI: a binary plus arguments placed before the command (e.g. `bun` + `main.ts`). */``
- `repo_09e11a52066c67`: `apps/vscode/src/commands.ts#L1` — trecho esperado: `import { join } from 'node:path';`
- `repo_09e11a52066c67`: `apps/vscode/src/diagnostics.ts#L1` — trecho esperado: `import { parseDiagramJson } from '@strukt/json';`
- `repo_09e11a52066c67`: `apps/vscode/src/diffView.ts#L1` — trecho esperado: `/** Markdown shown in the preview: the CLI output, or an explicit "nothing changed" instead of an empty page. */`
- `repo_09e11a52066c67`: `apps/vscode/src/extension.ts#L1` — trecho esperado: `import * as vscode from 'vscode';`
- `repo_09e11a52066c67`: `apps/vscode/src/nodeExec.ts#L1` — trecho esperado: `import { execFile } from 'node:child_process';`
- `repo_09e11a52066c67`: `apps/vscode/src/run.ts#L1` — trecho esperado: `import type { CliInvocation, CliSettings } from './cli';`
- `repo_09e11a52066c67`: `apps/vscode/src/schema.ts#L1` — trecho esperado: ``/** Diagram documents are `\<slug\>.strukt.json`; the manifest (`strukt.json`), layouts and the board use other shapes. */``
- `repo_09e11a52066c67`: `apps/vscode/src/vscode.d.ts#L1` — trecho esperado: `/**`
- `repo_09e11a52066c67`: `apps/vscode/src/workspaceRoots.ts#L1` — trecho esperado: ``/** `\<root\>/.arch/strukt.json` → `\<root\>`; anything else is not a Joinlet manifest. */``
- `repo_3b4e3efd29cd13`: `apps/web/docs/client.js#L1` — trecho esperado: `(() =\> {`
- `repo_3b4e3efd29cd13`: `apps/web/docs/site.mjs#L1` — trecho esperado: `import { readFileSync } from 'node:fs';`
- `repo_3b4e3efd29cd13`: `apps/web/package.json#L2` — trecho esperado: `"name": "@strukt/web",`
- `repo_3b4e3efd29cd13`: `apps/web/package.json#L6` — trecho esperado: `"dev": "vite",`
- `repo_3b4e3efd29cd13`: `apps/web/package.json#L43` — trecho esperado: `"react": "^19.3.0",`
- `repo_3b4e3efd29cd13`: `apps/web/package.json#L44` — trecho esperado: `"react-dom": "^19.3.0",`
- `repo_3b4e3efd29cd13`: `apps/web/package.json#L57` — trecho esperado: `"tailwindcss": "^4.3.3",`
- `repo_3b4e3efd29cd13`: `apps/web/scripts/build-cloud-icons.py#L1` — trecho esperado: `"""Import official cloud SVG packs from an extracted directory (see docs/third-party/cloud-icons.md)."""`
- `repo_3b4e3efd29cd13`: `apps/web/scripts/build-icon-subset.ts#L1` — trecho esperado: `/**`
- `repo_3b4e3efd29cd13`: `apps/web/scripts/build-icon-subset.ts#L15` — trecho esperado: `'node:fs'`
- `repo_3b4e3efd29cd13`: `apps/web/scripts/build-icon-subset.ts#L16` — trecho esperado: `'node:path'`
- `repo_3b4e3efd29cd13`: `apps/web/scripts/build-logos-subset.ts#L1` — trecho esperado: `/**`
- `repo_3b4e3efd29cd13`: `apps/web/scripts/build-logos-subset.ts#L8` — trecho esperado: `'node:fs'`
- `repo_3b4e3efd29cd13`: `apps/web/scripts/build-lucide-categories.ts#L1` — trecho esperado: `/**`
- `repo_3b4e3efd29cd13`: `apps/web/scripts/build-lucide-categories.ts#L11` — trecho esperado: `'node:fs'`
- `repo_3b4e3efd29cd13`: `apps/web/src/actions/canvasDiagrams.ts#L1` — trecho esperado: `import { uiText } from '../i18n';`
- `repo_3b4e3efd29cd13`: `apps/web/src/actions/clipboard.ts#L1` — trecho esperado: `import { copyElements, pasteOps, topLevel } from '@strukt/core';`
- `repo_3b4e3efd29cd13`: `apps/web/src/actions/commands.ts#L1` — trecho esperado: `import { uiText } from '../i18n';`
- `repo_3b4e3efd29cd13`: `apps/web/src/analytics/AnalyticsConsent.tsx#L1` — trecho esperado: `import {lazy,Suspense} from 'react';`
- `repo_3b4e3efd29cd13`: `apps/web/src/comments/CommentsHost.tsx#L6` — trecho esperado: `'react-dom'`
- `repo_41ba823706ed42`: `packages/layout/package.json#L2` — trecho esperado: `"name": "@strukt/layout",`
- `repo_41ba823706ed42`: `packages/layout/src/canvasFrames.ts#L1` — trecho esperado: `import { canvasFrameModel, canvasFrames, computeRects, copyElements, unionRect, visualBox } from '@strukt/core';`
- `repo_41ba823706ed42`: `packages/layout/src/composition.ts#L1` — trecho esperado: `import { cardSize, defaultSize, own } from '@strukt/core';`
- `repo_41ba823706ed42`: `packages/layout/src/compositionRoutes.ts#L1` — trecho esperado: `import { own } from '@strukt/core';`
- `repo_41ba823706ed42`: `packages/layout/src/elk.ts#L1` — trecho esperado: `import { GROUP_PADDING, defaultSize, own, visualBox } from '@strukt/core';`
- `repo_41ba823706ed42`: `packages/layout/src/eraserRouter.ts#L1` — trecho esperado: `import { LayoutManager, routeCorridorConnectionBatch } from '@eraserlabs/layout';`
- `repo_41ba823706ed42`: `packages/layout/src/groupComposition.fixture.json#L1` — trecho esperado: `{`
- `repo_41ba823706ed42`: `packages/layout/src/groupComposition.ts#L1` — trecho esperado: `import { cardSize, computeRects, defaultSize, GROUP_PADDING, nodeVariant, own, visualBox } from '@strukt/core';`
- `repo_41ba823706ed42`: `packages/layout/src/groupRoutes.ts#L1` — trecho esperado: `import { groupTitleBox } from '@strukt/core';`
- `repo_41ba823706ed42`: `packages/layout/src/index.ts#L1` — trecho esperado: `export * from './route';`
- `repo_41ba823706ed42`: `packages/layout/src/labels.ts#L1` — trecho esperado: `import type { ID, Rect } from '@strukt/core';`
- `repo_41ba823706ed42`: `packages/layout/src/nestedComposition.fixture.ts#L1` — trecho esperado: `import { applyOps, emptyModel } from '@strukt/core';`
- `repo_41ba823706ed42`: `packages/layout/src/nestedComposition.ts#L1` — trecho esperado: `import { cardSize, computeRects, defaultSize, GROUP_PADDING, intersects, nodeVariant, own, visualBox } from '@strukt/core';`
- `repo_41ba823706ed42`: `packages/layout/src/nudge.ts#L1` — trecho esperado: `import type { ID, Rect } from '@strukt/core';`
- `repo_41ba823706ed42`: `packages/layout/src/path.ts#L1` — trecho esperado: `import type { Point } from './route';`
- `repo_41ba823706ed42`: `packages/layout/src/place.ts#L1` — trecho esperado: `import { EMPTY_GROUP_SIZE, GROUP_PADDING, contains, defaultSize, depthOf, findFreeSpot, isAncestor, nextPosition, own, unionRect, visualBox } from '@strukt/core';`
- `repo_41ba823706ed42`: `packages/layout/src/route.ts#L1` — trecho esperado: `import type { Rect } from '@strukt/core';`
- `repo_41ba823706ed42`: `packages/layout/src/router.ts#L1` — trecho esperado: `import type { DiagramModel, EdgeEl, EdgeRoute, ID, Rect } from '@strukt/core';`
- `repo_41ba823706ed42`: `packages/layout/src/sequence.ts#L1` — trecho esperado: `import { SEQUENCE_MESSAGE_GAP, participantSize } from '@strukt/core';`
- `repo_41ba823706ed42`: `packages/layout/src/sketch.ts#L1` — trecho esperado: `import type { SketchShape } from '@strukt/core';`
- `repo_484fb1e9cea553`: `apps/server/package.json#L2` — trecho esperado: `"name": "@strukt/server",`
- `repo_484fb1e9cea553`: `apps/server/package.json#L14` — trecho esperado: `"@modelcontextprotocol/sdk": "^1.31.0",`
- `repo_484fb1e9cea553`: `apps/server/package.json#L24` — trecho esperado: `"hono": "^4.13.8"`
- `repo_484fb1e9cea553`: `apps/server/src/agentSetup.ts#L1` — trecho esperado: `import { withKnowledgeHarness } from '@strukt/workspace';`
- `repo_484fb1e9cea553`: `apps/server/src/agentSetup.ts#L2` — trecho esperado: `'node:fs/promises'`
- `repo_484fb1e9cea553`: `apps/server/src/agentSetup.ts#L3` — trecho esperado: `'node:crypto'`
- `repo_484fb1e9cea553`: `apps/server/src/agentSetup.ts#L4` — trecho esperado: `'node:path'`
- `repo_484fb1e9cea553`: `apps/server/src/anthropic.ts#L1` — trecho esperado: `import type Anthropic from '@anthropic-ai/sdk';`
- `repo_484fb1e9cea553`: `apps/server/src/app.ts#L1` — trecho esperado: `import { streamSSE } from 'hono/streaming';`
- `repo_484fb1e9cea553`: `apps/server/src/app.ts#L12` — trecho esperado: `'node:os'`
- `repo_484fb1e9cea553`: `apps/server/src/app.ts#L26` — trecho esperado: `'@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'`
- `repo_484fb1e9cea553`: `apps/server/src/app.ts#L29` — trecho esperado: `'node:fs/promises'`
- `repo_484fb1e9cea553`: `apps/server/src/audit.ts#L1` — trecho esperado: `import { createHash, randomBytes } from 'node:crypto';`
- `repo_484fb1e9cea553`: `apps/server/src/chat.ts#L1` — trecho esperado: `import { MODELS } from './anthropic';`
- `repo_484fb1e9cea553`: `apps/server/src/chatEdit.ts#L1` — trecho esperado: `import { DIAGRAM_DESIGN_GUIDANCE } from './diagramDesign';`
- `repo_484fb1e9cea553`: `apps/server/src/collaborationHost.ts#L7` — trecho esperado: `'bun:sqlite'`
- `repo_484fb1e9cea553`: `apps/server/src/collaborationHost.ts#L8` — trecho esperado: `'bun'`
- `repo_484fb1e9cea553`: `apps/server/src/connector.ts#L1` — trecho esperado: `import { serve, file } from 'bun';`
- `repo_484fb1e9cea553`: `apps/server/src/shareStack.ts#L1` — trecho esperado: `import { file } from 'bun';`
- `repo_484fb1e9cea553`: `apps/server/src/shareStack.ts#L11` — trecho esperado: `'bun'`
- `repo_4c5a34d0f0b789`: `apps/mcp/package.json#L2` — trecho esperado: `"name": "@strukt/mcp",`
- `repo_4c5a34d0f0b789`: `apps/mcp/package.json#L18` — trecho esperado: `"@modelcontextprotocol/sdk": "^1.31.0",`
- `repo_4c5a34d0f0b789`: `apps/mcp/src/args.ts#L1` — trecho esperado: ``export const USAGE = `joinlet-mcp — servidor MCP do Joinlet (stdio)``
- `repo_4c5a34d0f0b789`: `apps/mcp/src/comments.ts#L1` — trecho esperado: `import { own } from '@strukt/core';`
- `repo_4c5a34d0f0b789`: `apps/mcp/src/github.ts#L1` — trecho esperado: `import { publish, prStatus } from '@strukt/git';`
- `repo_4c5a34d0f0b789`: `apps/mcp/src/index.ts#L1` — trecho esperado: `export { createStruktServer, SERVER_INFO } from './server';`
- `repo_4c5a34d0f0b789`: `apps/mcp/src/main.ts#L1` — trecho esperado: `#!/usr/bin/env bun`
- `repo_4c5a34d0f0b789`: `apps/mcp/src/main.ts#L3` — trecho esperado: `'@modelcontextprotocol/sdk/server/stdio.js'`
- `repo_4c5a34d0f0b789`: `apps/mcp/src/perspectives.ts#L1` — trecho esperado: `import { own } from '@strukt/core';`
- `repo_4c5a34d0f0b789`: `apps/mcp/src/prompts.ts#L1` — trecho esperado: `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';`
- `repo_4c5a34d0f0b789`: `apps/mcp/src/repositoryKnowledge.ts#L1` — trecho esperado: `import {z} from 'zod';`
- `repo_4c5a34d0f0b789`: `apps/mcp/src/repositoryKnowledge.ts#L2` — trecho esperado: `'node:path'`
- `repo_4c5a34d0f0b789`: `apps/mcp/src/resources.ts#L1` — trecho esperado: `import { own } from '@strukt/core';`
- `repo_4c5a34d0f0b789`: `apps/mcp/src/server.ts#L1` — trecho esperado: `import { KNOWLEDGE_HARNESS } from '@strukt/workspace';`
- `repo_4c5a34d0f0b789`: `apps/mcp/src/sync.ts#L1` — trecho esperado: `import { RepositoryEngine, inspectRepository } from '@strukt/workspace/repository';`
- `repo_4c5a34d0f0b789`: `apps/mcp/src/sync.ts#L4` — trecho esperado: `'node:path'`
- `repo_4c5a34d0f0b789`: `apps/mcp/src/testing.ts#L1` — trecho esperado: `import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';`
- `repo_4c5a34d0f0b789`: `apps/mcp/src/testing.ts#L2` — trecho esperado: `'node:os'`
- `repo_4c5a34d0f0b789`: `apps/mcp/src/testing.ts#L3` — trecho esperado: `'node:path'`
- `repo_4c5a34d0f0b789`: `apps/mcp/src/timelineTool.ts#L1` — trecho esperado: `import { own } from '@strukt/core';`
- `repo_5c1ab4b7e80ad1`: `packages/dsl/package.json#L2` — trecho esperado: `"name": "@strukt/dsl",`
- `repo_5c1ab4b7e80ad1`: `packages/dsl/src/detect.ts#L1` — trecho esperado: ``// Format sniffing, kept apart from the importers so the app can offer a conversion without loading them (or `yaml`).``
- `repo_5c1ab4b7e80ad1`: `packages/dsl/src/diagramTree.ts#L1` — trecho esperado: `import { own } from '@strukt/core';`
- `repo_5c1ab4b7e80ad1`: `packages/dsl/src/export.ts#L1` — trecho esperado: `export { printMermaid } from './mermaid';`
- `repo_5c1ab4b7e80ad1`: `packages/dsl/src/import.ts#L1` — trecho esperado: `import { applyOps, emptyModel } from '@strukt/core';`
- `repo_5c1ab4b7e80ad1`: `packages/dsl/src/import/cloud/aws.ts#L1` — trecho esperado: `import { asArray, asString, pick, pickPath } from '../common';`
- `repo_5c1ab4b7e80ad1`: `packages/dsl/src/import/cloud/azure.ts#L1` — trecho esperado: `import { asArray, asString, pick } from '../common';`
- `repo_5c1ab4b7e80ad1`: `packages/dsl/src/import/cloud/collector.ts#L1` — trecho esperado: `import { cleanText } from '../common';`
- `repo_5c1ab4b7e80ad1`: `packages/dsl/src/import/cloud/gcp.ts#L1` — trecho esperado: `import { asArray, asString, pick } from '../common';`
- `repo_5c1ab4b7e80ad1`: `packages/dsl/src/import/cloud/graph.ts#L1` — trecho esperado: `import { applyOps } from '@strukt/core';`
- `repo_5c1ab4b7e80ad1`: `packages/dsl/src/import/cloud/ids.ts#L1` — trecho esperado: ``/** The ARN pieces the importers need; `undefined` for anything that is not a plain `arn:partition:service:region:account:resource`. */``
- `repo_5c1ab4b7e80ad1`: `packages/dsl/src/import/cloud/index.ts#L1` — trecho esperado: `export { normalizeAws } from './aws';`
- `repo_5c1ab4b7e80ad1`: `packages/dsl/src/import/cloud/kinds.ts#L1` — trecho esperado: `import type { Shape } from '@strukt/core';`
- `repo_5c1ab4b7e80ad1`: `packages/dsl/src/import/cloud/safe.ts#L1` — trecho esperado: `import { cleanText } from '../common';`
- `repo_5c1ab4b7e80ad1`: `packages/dsl/src/import/cloud/state.ts#L1` — trecho esperado: `import { asArray, asString, cleanText, isRecord, pick } from '../common';`
- `repo_5c1ab4b7e80ad1`: `packages/dsl/src/import/cloud/terraformShow.ts#L1` — trecho esperado: `import { MAX_IMPORT, asArray, asString, cleanText, failure, isRecord, pick } from '../common';`
- `repo_5c1ab4b7e80ad1`: `packages/dsl/src/import/cloud/types.ts#L1` — trecho esperado: `import type { ImportDiagnostic } from '../common';`
- `repo_5c1ab4b7e80ad1`: `packages/dsl/src/import/common.ts#L1` — trecho esperado: `import { applyOps, emptyModel } from '@strukt/core';`
- `repo_5c1ab4b7e80ad1`: `packages/dsl/src/import/d2.ts#L1` — trecho esperado: `import type { Connector, Direction, Shape } from '@strukt/core';`
- `repo_5c1ab4b7e80ad1`: `packages/dsl/src/import/k8s.ts#L1` — trecho esperado: `import type { NodeProps } from './common';`
- `repo_71391bfad4e6b4`: `packages/git/package.json#L2` — trecho esperado: `"name": "@strukt/git",`
- `repo_71391bfad4e6b4`: `packages/git/src/diff.ts#L1` — trecho esperado: `import { compareModels, emptyModel, own } from '@strukt/core';`
- `repo_71391bfad4e6b4`: `packages/git/src/diffSvg.ts#L1` — trecho esperado: `import { compareModels, computeRects, defaultSize, emptyModel, own } from '@strukt/core';`
- `repo_71391bfad4e6b4`: `packages/git/src/index.ts#L1` — trecho esperado: `export { createProcessRunner, readArchAtRef } from './run';`
- `repo_71391bfad4e6b4`: `packages/git/src/publish.ts#L1` — trecho esperado: `import { anyChange, diffRefs, diffWorktree, renderDiffMarkdown } from './diff';`
- `repo_71391bfad4e6b4`: `packages/git/src/run.ts#L1` — trecho esperado: `import { execFile } from 'node:child_process';`
- `repo_71391bfad4e6b4`: `packages/git/src/testing.ts#L1` — trecho esperado: `import type { CommandResult, CommandRunner } from './run';`
- `repo_86104d06094ed0`: `apps/remote/Dockerfile#L1` — trecho esperado: `FROM oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS build`
- `repo_86104d06094ed0`: `apps/remote/package.json#L2` — trecho esperado: `"name": "@strukt/remote",`
- `repo_86104d06094ed0`: `apps/remote/package.json#L13` — trecho esperado: `"@modelcontextprotocol/sdk": "^1.31.0",`
- `repo_86104d06094ed0`: `apps/remote/package.json#L16` — trecho esperado: `"express": "^5.1.0",`
- `repo_86104d06094ed0`: `apps/remote/src/accountDirectory.ts#L1` — trecho esperado: `import type { RequestHandler } from 'express';`
- `repo_86104d06094ed0`: `apps/remote/src/accountDirectory.ts#L2` — trecho esperado: `'node:crypto'`
- `repo_86104d06094ed0`: `apps/remote/src/accounts.ts#L1` — trecho esperado: `import type { Database } from 'bun:sqlite';`
- `repo_86104d06094ed0`: `apps/remote/src/accounts.ts#L2` — trecho esperado: `'node:crypto'`
- `repo_86104d06094ed0`: `apps/remote/src/app.ts#L1` — trecho esperado: `import { createRepositoryHub } from './repositoryHub';`
- `repo_86104d06094ed0`: `apps/remote/src/app.ts#L4` — trecho esperado: `'express'`
- `repo_86104d06094ed0`: `apps/remote/src/app.ts#L5` — trecho esperado: `'node:fs/promises'`
- `repo_86104d06094ed0`: `apps/remote/src/app.ts#L6` — trecho esperado: `'node:url'`
- `repo_86104d06094ed0`: `apps/remote/src/app.ts#L7` — trecho esperado: `'@modelcontextprotocol/sdk/server/auth/router.js'`
- `repo_86104d06094ed0`: `apps/remote/src/auth.ts#L1` — trecho esperado: `import { configureRuntimeDatabase } from './database';`
- `repo_86104d06094ed0`: `apps/remote/src/auth.ts#L5` — trecho esperado: `'node:crypto'`
- `repo_86104d06094ed0`: `apps/remote/src/auth.ts#L7` — trecho esperado: `'bun:sqlite'`
- `repo_86104d06094ed0`: `apps/remote/src/backup.ts#L1` — trecho esperado: `import { Database } from 'bun:sqlite';`
- `repo_86104d06094ed0`: `apps/remote/src/collaboration.ts#L6` — trecho esperado: `'bun:sqlite'`
- `repo_86104d06094ed0`: `apps/remote/src/deploymentSmoke.ts#L6` — trecho esperado: `'bun:sqlite'`
- `repo_86104d06094ed0`: `apps/remote/src/hostedStore.ts#L1` — trecho esperado: `import { Database } from "bun:sqlite";`
- `repo_8c5967fd8486f3`: `scripts/build-connector.ts#L1` — trecho esperado: `#!/usr/bin/env bun`
- `repo_8c5967fd8486f3`: `scripts/build-connector.ts#L2` — trecho esperado: `'node:fs/promises'`
- `repo_8c5967fd8486f3`: `scripts/build-connector.ts#L3` — trecho esperado: `'node:path'`
- `repo_8c5967fd8486f3`: `scripts/check-publication.py#L1` — trecho esperado: `#!/usr/bin/env python3`
- `repo_8c5967fd8486f3`: `scripts/check-repository-parsers.ts#L1` — trecho esperado: `import assert from 'node:assert/strict';`
- `repo_8c5967fd8486f3`: `scripts/check-secrets.py#L1` — trecho esperado: `#!/usr/bin/env python3`
- `repo_8c5967fd8486f3`: `scripts/performance.ts#L1` — trecho esperado: `/** Functional checks always run; timing gates run separately on an otherwise idle CI runner. */`
- `repo_8c5967fd8486f3`: `scripts/smoke-container.ts#L1` — trecho esperado: `import assert from 'node:assert/strict';`
- `repo_8c5967fd8486f3`: `scripts/smoke-container.ts#L2` — trecho esperado: `'node:child_process'`
- `repo_8c5967fd8486f3`: `scripts/test_publication.py#L1` — trecho esperado: `import importlib.util`
- `repo_8c5967fd8486f3`: `scripts/test_secret_scanner.py#L1` — trecho esperado: `"""Integration regression: repository config, ignore files and comments cannot hide a fake token."""`
- `repo_8c5967fd8486f3`: `scripts/update-repository-grammars.py#L1` — trecho esperado: `#!/usr/bin/env python3`
- `repo_bde7b76204809a`: `apps/cli/package.json#L2` — trecho esperado: `"name": "@strukt/cli",`
- `repo_bde7b76204809a`: `apps/cli/src/args.ts#L1` — trecho esperado: `import { parseStage } from '@strukt/workspace';`
- `repo_bde7b76204809a`: `apps/cli/src/cloudAllowlist.ts#L1` — trecho esperado: `import type { CommandRunner } from '@strukt/git';`
- `repo_bde7b76204809a`: `apps/cli/src/cloudCollect.ts#L1` — trecho esperado: `import { normalizeAws, normalizeAzure, normalizeGcp } from '@strukt/dsl/import';`
- `repo_bde7b76204809a`: `apps/cli/src/cloudDrift.ts#L1` — trecho esperado: `import { own } from '@strukt/core';`
- `repo_bde7b76204809a`: `apps/cli/src/cloudTesting.ts#L1` — trecho esperado: `import { awsOutputs, azureListingJson, gcpListingJson } from '@strukt/dsl/cloud-fixtures';`
- `repo_bde7b76204809a`: `apps/cli/src/commands/check.ts#L1` — trecho esperado: `import { SOURCES_PATH, diagramPath, openConcerns, parseSources, validateSourceTargets } from '@strukt/workspace';`
- `repo_bde7b76204809a`: `apps/cli/src/commands/context.ts#L1` — trecho esperado: `import { relative, resolve, sep } from 'node:path';`
- `repo_bde7b76204809a`: `apps/cli/src/commands/diff.ts#L1` — trecho esperado: `import { dirname, join, resolve } from 'node:path';`
- `repo_bde7b76204809a`: `apps/cli/src/commands/evidence.ts#L1` — trecho esperado: `import { EVIDENCE_PATH, printEvidence } from '@strukt/workspace';`
- `repo_bde7b76204809a`: `apps/cli/src/commands/export.ts#L1` — trecho esperado: `import { basename, dirname, join, resolve } from 'node:path';`
- `repo_bde7b76204809a`: `apps/cli/src/commands/importCloud.ts#L1` — trecho esperado: `import { readFile, stat } from 'node:fs/promises';`
- `repo_bde7b76204809a`: `apps/cli/src/commands/importCloud.ts#L2` — trecho esperado: `'node:path'`
- `repo_bde7b76204809a`: `apps/cli/src/commands/list.ts#L1` — trecho esperado: `import { own } from '@strukt/core';`
- `repo_bde7b76204809a`: `apps/cli/src/commands/pr-comment.ts#L1` — trecho esperado: `import { prComment } from '@strukt/git';`
- `repo_bde7b76204809a`: `apps/cli/src/commands/publish.ts#L1` — trecho esperado: `import { readFile } from 'node:fs/promises';`
- `repo_bde7b76204809a`: `apps/cli/src/commands/repository.ts#L1` — trecho esperado: `import { mkdir, stat } from 'node:fs/promises';`
- `repo_bde7b76204809a`: `apps/cli/src/commands/site.ts#L1` — trecho esperado: `import { lstat, readFile, readdir, rmdir, unlink } from 'node:fs/promises';`
- `repo_bde7b76204809a`: `apps/cli/src/commands/sources.ts#L1` — trecho esperado: `import { addItem, slugify } from '@strukt/workspace';`
- `repo_bde7b76204809a`: `apps/cli/src/commands/sync.ts#L1` — trecho esperado: `import { own, syncLayout } from '@strukt/core';`
- `repo_d4ff4b28356bed`: `packages/workspace/package.json#L2` — trecho esperado: `"name": "@strukt/workspace",`
- `repo_d4ff4b28356bed`: `packages/workspace/src/accessContext.ts#L1` — trecho esperado: `import { AsyncLocalStorage } from 'node:async_hooks';`
- `repo_d4ff4b28356bed`: `packages/workspace/src/agentHarness.ts#L1` — trecho esperado: `const START = '\<!-- joinlet:knowledge-harness:start --\>';`
- `repo_d4ff4b28356bed`: `packages/workspace/src/assistants.ts#L1` — trecho esperado: `import { stableStringify } from './json';`
- `repo_d4ff4b28356bed`: `packages/workspace/src/assistantsBuiltin.ts#L1` — trecho esperado: `import type { Assistant } from './assistants';`
- `repo_d4ff4b28356bed`: `packages/workspace/src/assistantsParse.ts#L1` — trecho esperado: `import { slugify } from './slug';`
- `repo_d4ff4b28356bed`: `packages/workspace/src/beta.ts#L1` — trecho esperado: `import { parseManifest } from './manifest';`
- `repo_d4ff4b28356bed`: `packages/workspace/src/board.ts#L1` — trecho esperado: `import { RESERVED_NAME, own } from '@strukt/core';`
- `repo_d4ff4b28356bed`: `packages/workspace/src/collaboration.ts#L1` — trecho esperado: `import * as Y from 'yjs';`
- `repo_d4ff4b28356bed`: `packages/workspace/src/collaborationEntry.ts#L1` — trecho esperado: `export * from './collaboration';`
- `repo_d4ff4b28356bed`: `packages/workspace/src/collaborationFiles.ts#L1` — trecho esperado: `import * as Y from 'yjs';`
- `repo_d4ff4b28356bed`: `packages/workspace/src/collaborationPresence.ts#L1` — trecho esperado: `/**`
- `repo_d4ff4b28356bed`: `packages/workspace/src/collaborationRoom.ts#L1` — trecho esperado: `import * as Y from 'yjs';`
- `repo_d4ff4b28356bed`: `packages/workspace/src/collaborationSanitize.ts#L1` — trecho esperado: `import { CARDINALITIES, validTableFields, LAYOUT_ROLES, PRESENTATIONS, PORTS, COLOR_MODES, CONNECTORS, DEFAULT_STYLE, DIRECTIONS, RESERVED_NAME, SHAPES, STYLE_MODES, TYPEFACES, own, validParents } from '@strukt/core';`
- `repo_d4ff4b28356bed`: `packages/workspace/src/collaborationSqlite.ts#L1` — trecho esperado: `import type { Database } from 'bun:sqlite';`
- `repo_d4ff4b28356bed`: `packages/workspace/src/collaborationStore.ts#L1` — trecho esperado: `import { writeBatch } from './repository/transaction';`
- `repo_d4ff4b28356bed`: `packages/workspace/src/fs.ts#L3` — trecho esperado: `'node:fs/promises'`
- `repo_d4ff4b28356bed`: `packages/workspace/src/fs.ts#L4` — trecho esperado: `'node:path'`
- `repo_d4ff4b28356bed`: `packages/workspace/src/health.ts#L1` — trecho esperado: `import { open, readFile, realpath, stat } from 'node:fs/promises';`
- `repo_d4ff4b28356bed`: `packages/workspace/src/health.ts#L2` — trecho esperado: `'node:path'`
- `repo_d5a16586640c40`: `packages/ops/package.json#L2` — trecho esperado: `"name": "@strukt/ops",`
- `repo_d5a16586640c40`: `packages/ops/src/check.ts#L1` — trecho esperado: `import { applyOps, emptyModel } from '@strukt/core';`
- `repo_d5a16586640c40`: `packages/ops/src/index.ts#L1` — trecho esperado: `export {`
- `repo_d5a16586640c40`: `packages/ops/src/plan.ts#L1` — trecho esperado: `import { applyOps, syncLayout } from '@strukt/core';`
- `repo_d5a16586640c40`: `packages/ops/src/schema.ts#L1` — trecho esperado: `import { CARDINALITIES, LAYOUT_ROLES, PRESENTATIONS, PORTS, COLOR_MODES, CONNECTORS, DIRECTIONS, SHAPES, STYLE_MODES, TYPEFACES } from '@strukt/core';`
- `repo_d5a16586640c40`: `packages/ops/tsconfig.json#L1` — trecho esperado: `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`
- `repo_e27f3faa9152db`: `packages/core/package.json#L2` — trecho esperado: `"name": "@strukt/core",`
- `repo_e27f3faa9152db`: `packages/core/src/aiProviders.ts#L1` — trecho esperado: `/** Named connections use fixed endpoints; keys never cross between providers. */`
- `repo_e27f3faa9152db`: `packages/core/src/applyOps.ts#L1` — trecho esperado: `import { RESERVED_NAME, edgeId, own } from './ids';`
- `repo_e27f3faa9152db`: `packages/core/src/canvasDiagrams.ts#L1` — trecho esperado: `import { applyOps } from './applyOps';`
- `repo_e27f3faa9152db`: `packages/core/src/catalogSearch.ts#L1` — trecho esperado: `/** Search metadata is bilingual and remains independent of the labels painted on the canvas. */`
- `repo_e27f3faa9152db`: `packages/core/src/chatEdit.ts#L1` — trecho esperado: `import { readWorkspaceOps } from './workspaceEdit';`
- `repo_e27f3faa9152db`: `packages/core/src/chatModel.ts#L1` — trecho esperado: `import { isAiProvider } from './aiProviders';`
- `repo_e27f3faa9152db`: `packages/core/src/clipboard.ts#L1` — trecho esperado: `import { own, uniqueName } from './ids';`
- `repo_e27f3faa9152db`: `packages/core/src/cloudComponents.ts#L1` — trecho esperado: `import metadata from './cloudIcons.json' with { type: 'json' };`
- `repo_e27f3faa9152db`: `packages/core/src/compare.ts#L1` — trecho esperado: `import { own } from './ids';`
- `repo_e27f3faa9152db`: `packages/core/src/componentCatalog.ts#L1` — trecho esperado: `import { BASIC_COMPONENT_PRESETS } from './components';`
- `repo_e27f3faa9152db`: `packages/core/src/components.ts#L1` — trecho esperado: `import type { LayoutRole, Presentation, Shape, TableField } from './model';`
- `repo_e27f3faa9152db`: `packages/core/src/connector.ts#L1` — trecho esperado: `import type { Cardinality, Connector } from './model';`
- `repo_e27f3faa9152db`: `packages/core/src/diff.ts#L1` — trecho esperado: `import { applyOps } from './applyOps';`
- `repo_e27f3faa9152db`: `packages/core/src/geometry.ts#L1` — trecho esperado: `import { own } from './ids';`
- `repo_e27f3faa9152db`: `packages/core/src/ids.ts#L1` — trecho esperado: `import type { ID } from './model';`
- `repo_e27f3faa9152db`: `packages/core/src/index.ts#L1` — trecho esperado: `export const STRUKT_FORMAT_VERSION = 1;`
- `repo_e27f3faa9152db`: `packages/core/src/model.ts#L1` — trecho esperado: `export type ID = string;`
- `repo_e27f3faa9152db`: `packages/core/src/placement.ts#L1` — trecho esperado: `import type { Rect, Size } from './geometry';`
- `repo_e27f3faa9152db`: `packages/core/src/shapes.ts#L1` — trecho esperado: `import { drawingShape } from './model';`
- `repo_e86a0d465b5caa`: `packages/json/package.json#L2` — trecho esperado: `"name": "@strukt/json",`
- `repo_e86a0d465b5caa`: `packages/json/src/index.ts#L1` — trecho esperado: `export { printDiagramJson, DIAGRAM_JSON_VERSION, SCHEMA_REF } from './print';`
- `repo_e86a0d465b5caa`: `packages/json/src/parse.ts#L1` — trecho esperado: `import {`
- `repo_e86a0d465b5caa`: `packages/json/src/parseJson.ts#L1` — trecho esperado: `import type { Span } from '@strukt/core';`
- `repo_e86a0d465b5caa`: `packages/json/src/print.ts#L1` — trecho esperado: `import { DEFAULT_STYLE, own, validParents } from '@strukt/core';`
- `repo_e86a0d465b5caa`: `packages/json/src/schema.ts#L1` — trecho esperado: `import { CARDINALITIES, LAYOUT_ROLES, PRESENTATIONS, PORTS, COLOR_MODES, CONNECTORS, DIRECTIONS, SHAPES, STYLE_MODES, TYPEFACES } from '@strukt/core';`
- `repo_e86a0d465b5caa`: `packages/json/src/validate.ts#L1` — trecho esperado: `import type { Span } from '@strukt/core';`

### Conexões

| De | Para | Tipo | Rótulo |
| --- | --- | --- | --- |
| `repo_bde7b76204809a` | `repo_41ba823706ed42` | `>` seta | — |
| `repo_bde7b76204809a` | `repo_5c1ab4b7e80ad1` | `>` seta | — |
| `repo_bde7b76204809a` | `repo_71391bfad4e6b4` | `>` seta | — |
| `repo_bde7b76204809a` | `repo_d4ff4b28356bed` | `>` seta | — |
| `repo_bde7b76204809a` | `repo_d5a16586640c40` | `>` seta | — |
| `repo_bde7b76204809a` | `repo_e27f3faa9152db` | `>` seta | — |
| `repo_bde7b76204809a` | `repo_e86a0d465b5caa` | `>` seta | — |
| `repo_4c5a34d0f0b789` | `repo_41ba823706ed42` | `>` seta | — |
| `repo_4c5a34d0f0b789` | `repo_71391bfad4e6b4` | `>` seta | — |
| `repo_4c5a34d0f0b789` | `repo_d4ff4b28356bed` | `>` seta | — |
| `repo_4c5a34d0f0b789` | `repo_d5a16586640c40` | `>` seta | — |
| `repo_4c5a34d0f0b789` | `repo_e27f3faa9152db` | `>` seta | — |
| `repo_4c5a34d0f0b789` | `repo_e86a0d465b5caa` | `>` seta | — |
| `repo_86104d06094ed0` | `repo_484fb1e9cea553` | `>` seta | — |
| `repo_86104d06094ed0` | `repo_4c5a34d0f0b789` | `>` seta | — |
| `repo_86104d06094ed0` | `repo_d4ff4b28356bed` | `>` seta | — |
| `repo_484fb1e9cea553` | `repo_4c5a34d0f0b789` | `>` seta | — |
| `repo_484fb1e9cea553` | `repo_71391bfad4e6b4` | `>` seta | — |
| `repo_484fb1e9cea553` | `repo_d4ff4b28356bed` | `>` seta | — |
| `repo_484fb1e9cea553` | `repo_d5a16586640c40` | `>` seta | — |
| `repo_484fb1e9cea553` | `repo_e27f3faa9152db` | `>` seta | — |
| `repo_484fb1e9cea553` | `repo_e86a0d465b5caa` | `>` seta | — |
| `repo_09e11a52066c67` | `repo_e86a0d465b5caa` | `>` seta | — |
| `repo_3b4e3efd29cd13` | `repo_41ba823706ed42` | `>` seta | — |
| `repo_3b4e3efd29cd13` | `repo_5c1ab4b7e80ad1` | `>` seta | — |
| `repo_3b4e3efd29cd13` | `repo_d4ff4b28356bed` | `>` seta | — |
| `repo_3b4e3efd29cd13` | `repo_e27f3faa9152db` | `>` seta | — |
| `repo_3b4e3efd29cd13` | `repo_e86a0d465b5caa` | `>` seta | — |
| `repo_5c1ab4b7e80ad1` | `repo_e27f3faa9152db` | `>` seta | — |
| `repo_5c1ab4b7e80ad1` | `repo_e86a0d465b5caa` | `>` seta | — |
| `repo_71391bfad4e6b4` | `repo_d4ff4b28356bed` | `>` seta | — |
| `repo_71391bfad4e6b4` | `repo_e27f3faa9152db` | `>` seta | — |
| `repo_e86a0d465b5caa` | `repo_e27f3faa9152db` | `>` seta | — |
| `repo_41ba823706ed42` | `repo_e27f3faa9152db` | `>` seta | — |
| `repo_d5a16586640c40` | `repo_41ba823706ed42` | `>` seta | — |
| `repo_d5a16586640c40` | `repo_e27f3faa9152db` | `>` seta | — |
| `repo_d4ff4b28356bed` | `repo_41ba823706ed42` | `>` seta | — |
| `repo_d4ff4b28356bed` | `repo_5c1ab4b7e80ad1` | `>` seta | — |
| `repo_d4ff4b28356bed` | `repo_e27f3faa9152db` | `>` seta | — |
| `repo_d4ff4b28356bed` | `repo_e86a0d465b5caa` | `>` seta | — |
| `repo_bde7b76204809a` | `repo_484fb1e9cea553` | `>` seta | — |
| `repo_4c5a34d0f0b789` | `repo_484fb1e9cea553` | `>` seta | — |
| `repo_86104d06094ed0` | `repo_e27f3faa9152db` | `>` seta | — |
| `repo_8c5967fd8486f3` | `repo_d4ff4b28356bed` | `>` seta | — |

### Documentos ligados

#### Joinlet para VS Code

`.arch/docs/joinlet-para-vs-code.md` · ligado a: `repo_09e11a52066c67`

> > Joinlet · Fonte: `apps/vscode/README.md`. Projeção do arquivo do repositório. Alterações feitas aqui são preservadas para revisão; o arquivo original não é substituído.
>
> # Joinlet para VS Code
>
> Valida, compara e abre a arquitetura do Joinlet (`.arch/`) sem sair do editor.
>
> - **Validação e autocompletar** em `*.strukt.json` pelo schema do Joinlet, mais diagnósticos do parser do Joinlet (mensagens em pt-BR) enquanto você digita.
> - **Joinlet: Validar workspace** roda `joinlet check --json` e mostra os problemas no painel Problemas.
>
> […]

## Documentos

- Funcionamento do Joinlet — `.arch/docs/funcionamento-do-joinlet.md`
- Código aberto e limites de publicação — `.arch/docs/codigo-aberto-e-limites-de-publicacao.md`
- Distribuição e operação — `.arch/docs/distribuicao-e-operacao.md`
- Release do Joinlet — `.arch/docs/release-do-joinlet.md`
- Site público e documentação — `.arch/docs/site-publico-e-documentacao.md`
- Analytics opcional do Joinlet — `.arch/docs/analytics-opcional-do-joinlet.md`
- Conexão e sincronização de repositórios — `.arch/docs/conexao-e-sincronizacao-de-repositorios.md`
- Arquitetura — Joinlet — `.arch/docs/repository-architecture.md`
- Contributing to Joinlet — `.arch/docs/contributing-to-joinlet.md`
- README — . — `.arch/docs/readme.md`
- Security policy — `.arch/docs/security-policy.md`
- Corresponding source — `.arch/docs/corresponding-source.md`
- Third-party notices — `.arch/docs/third-party-notices.md`
- Joinlet name and visual identity — `.arch/docs/joinlet-name-and-visual-identity.md`
- Joinlet para VS Code — `.arch/docs/joinlet-para-vs-code.md`
- Joinlet interface — `.arch/docs/joinlet-interface.md`
- Joinlet — `.arch/docs/joinlet.md`
- Publicação do Joinlet — `.arch/docs/publicacao-do-joinlet.md`
- Agentes: MCP + CLI — `.arch/docs/agentes-mcp-cli.md`
- Idiomas da interface — `.arch/docs/idiomas-da-interface.md`
- Joinlet — demonstrações visuais — `.arch/docs/joinlet-demonstracoes-visuais.md`
- Open source and hosted service — `.arch/docs/open-source-and-hosted-service.md`
- Provedores de IA do Joinlet — `.arch/docs/provedores-de-ia-do-joinlet.md`
- Contributions, releases and the official service — `.arch/docs/contributions-releases-and-the-official-service.md`
- Ícones oficiais de arquitetura cloud — `.arch/docs/icones-oficiais-de-arquitetura-cloud.md`
- Eraser Diagrams — `.arch/docs/eraser-diagrams.md`
- ignore.md — `.arch/docs/ignore-md.md`
- Configurações do workspace — `.arch/docs/configuracoes-do-workspace.md`
- Confiabilidade, análise sintática e onboarding — `.arch/docs/confiabilidade-analise-sintatica-e-onboarding.md`
