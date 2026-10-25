# Sincronização de repositórios

> Parte da arquitetura de “Joinlet” (visão completa em [ARCHITECTURE.md](../ARCHITECTURE.md)). Gerado pelo Joinlet: não edite à mão.

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
      "description": "Conexão, progresso, conflitos e sincronização contínua. Overview com filtros e aviso de aprofundamento: IA do Joinlet recebe fontes reais delimitadas por revisão/política; agente local recebe tarefa e MCP. Documentos de fonte preservam autoria.",
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
      "description": "Projeções de Markdown com origem, hashes e conflitos; pastas por caminho, vínculos explícitos e visão principal. Cards novos têm corredores de 120 px. Ação Espaçar amplia intervalos sem reordenar cards, mantém conteúdo/conexões e expande seções; MCP usa o mesmo núcleo. Rotas afastam pontas e rótulos das bordas. Preserva autoria, exclusões e posições até uma ação explícita.",
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

## Componentes

| Componente | Tipo | Tecnologia | Descrição | Grupo |
| --- | --- | --- | --- | --- |
| Editor web (`Editor`) | nó | — | Conexão, progresso, conflitos e sincronização contínua. Overview com filtros e aviso de aprofundamento: IA do Joinlet recebe fontes reais delimitadas por revisão/política; agente local recebe tarefa e MCP. Documentos de fonte preservam autoria. | — |
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
| Documentação e Overview (`Knowledge`) | nó | Markdown · pastas · vínculos | Projeções de Markdown com origem, hashes e conflitos; pastas por caminho, vínculos explícitos e visão principal. Cards novos têm corredores de 120 px. Ação Espaçar amplia intervalos sem reordenar cards, mantém conteúdo/conexões e expande seções; MCP usa o mesmo núcleo. Rotas afastam pontas e rótulos das bordas. Preserva autoria, exclusões e posições até uma ação explícita. | — |
| Parsers sintáticos (`Syntax`) | nó | Tree-sitter · WASM | Gramáticas locais verificadas para 18 linguagens e formatos. Scripts/frontmatter preservam linhas. Não executa fontes; tipos/desenvolvimento e limitações ficam separados do mapa principal. Assets acompanham conectores e imagem. | — |

## Evidências no código

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
- `edge:Editor→Hub`: `apps/web/src/panels/RepositoryConnection.tsx#L43` — trecho esperado: `request('/api/repositories/github',{repo,branch,locale:getLocale()})`
- `edge:Editor→Local`: `apps/web/src/panels/RepositoryConnection.tsx#L24` — trecho esperado: `request('/api/repositories',{dir,locale:getLocale()})`
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
- `Editor`: `apps/web/e2e/repository-real.spec.ts#L100` — trecho esperado: `test('rejects a delayed AI edit`
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
- `Knowledge`: `apps/web/src/board/boardFlow.ts#L13` — trecho esperado: `export function boardInFolder`
- `Knowledge`: `packages/workspace/src/board.ts#L208` — trecho esperado: `export function spaceBoard`
- `Knowledge`: `apps/web/src/board/boardRoutes.ts#L34` — trecho esperado: `export function separateEndpoints`
- `Knowledge`: `apps/web/src/board/BoardView.tsx#L147` — trecho esperado: `const spaceOverview`
- `Knowledge`: `apps/mcp/src/repositoryKnowledge.ts#L28` — trecho esperado: `server.registerTool('space_overview'`
- `Knowledge`: `apps/web/e2e/overview-spacing.spec.ts#L3` — trecho esperado: `test('spaces existing Overview cards`
- `Local`: `apps/server/src/repositories.ts#L24` — trecho esperado: `export function createRepositoryService`
- `Local`: `packages/workspace/src/repository/agentInstructions.ts#L17` — trecho esperado: `export async function syncAgentInstructions`
- `Local`: `packages/workspace/src/repository/agentInstructions.test.ts#L21` — trecho esperado: `it('preserves malformed markers`
- `Runtime`: `apps/remote/src/repositoryQueue.ts#L5` — trecho esperado: `export function repositoryQueue`
- `Runtime`: `apps/remote/src/auth.ts#L93` — trecho esperado: `configureRuntimeDatabase(db)`
- `Runtime`: `apps/remote/src/collaboration.ts#L20` — trecho esperado: `configureRuntimeDatabase(db)`
- `Runtime`: `apps/remote/src/database.ts#L5` — trecho esperado: `db.exec('PRAGMA busy_timeout=5000')`
- `Runtime`: `apps/remote/src/repositoryStartupSmoke.ts#L29` — trecho esperado: `for(let round=0;round\<3;round++)`
- `Syntax`: `packages/workspace/src/repository/syntax.ts#L44` — trecho esperado: `export async function parseSource`
- `Worker`: `apps/remote/src/repositoryHub.ts#L240` — trecho esperado: `async function runNext() {`

## Conexões

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

## Documentos ligados

### Conexão e sincronização de repositórios

`.arch/docs/conexao-e-sincronizacao-de-repositorios.md` · ligado a: `Editor`, `CLI`, `Connector`, `Local`, `Hub`, `Worker`, `Engine`, `Importers`, `AI`, `Architecture`, `Runtime`, `GitHub`, `Knowledge`

> # Conexão e sincronização de repositórios
>
> Implementação disponível no código. A ativação do serviço oficial e a homologação com GitHub real dependem do operador; os testes locais não comprovam publicação em produção.
>
> ## Conectar uma pasta
>
> […]

### Confiabilidade, análise sintática e onboarding

`.arch/docs/confiabilidade-analise-sintatica-e-onboarding.md` · ligado a: `Syntax`

> # Confiabilidade, análise sintática e onboarding
>
> O Joinlet extrai declarações sintáticas com Tree-sitter WebAssembly nos processos locais, CLI/MCP e worker hospedado. Os assets são locais, verificados por SHA-256 e acompanham conectores e imagem; não são carregados no frontend nem baixados durante a análise. O manifesto registra versão, integridade dos pacotes e avisos das gramáticas. Fontes analisadas nunca são executadas.
>
> ## Cobertura
>
> […]
