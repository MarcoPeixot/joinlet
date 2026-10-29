# Arquitetura — Joinlet

Gerado automaticamente pelo Joinlet a partir dos manifestos, imports e documentos encontrados no repositório. A cobertura semântica é parcial; revise comportamentos inferidos.

## Contexto do projeto

Joinlet is an open-source workspace for software architecture. Draw how your system fits together, write down the decisions behind it, and give your coding agents that same context through MCP and the CLI.

Start in your browser without an account, or save a workspace to a local folder. Repository workspaces live in `.arch/` as JSON and Markdown, so architecture changes can be reviewed alongside code in Git.

Fonte: `README.md`

## Módulos

- strukt-vscode — `apps/vscode`
- @strukt/web — `apps/web`
- @strukt/layout — `packages/layout`
- @strukt/server — `apps/server`
- @strukt/mcp — `apps/mcp`
- @strukt/dsl — `packages/dsl`
- @strukt/git — `packages/git`
- @strukt/remote — `apps/remote`
- scripts — `scripts`
- @strukt/cli — `apps/cli`
- @strukt/workspace — `packages/workspace`
- @strukt/ops — `packages/ops`
- @strukt/core — `packages/core`
- @strukt/json — `packages/json`

A visão geral mostra os módulos do projeto; o detalhe das bibliotecas está listado abaixo.

## Tecnologias identificadas

Identificadas por manifestos, imports e tipos de arquivo no próprio módulo. O ícone destaca a tecnologia principal; dependências de dados não comprovam a existência de serviços em execução.

### @strukt/cli — `apps/cli`

- **TypeScript** (ícone): `apps/cli/src/args.ts:1`, `apps/cli/src/cloudAllowlist.ts:1`, `apps/cli/src/cloudCollect.ts:1`, `apps/cli/src/cloudDrift.ts:1`, `apps/cli/src/cloudTesting.ts:1`
- **Node.js**: `apps/cli/src/commands/context.ts:1`, `apps/cli/src/commands/diff.ts:1`, `apps/cli/src/commands/export.ts:1`, `apps/cli/src/commands/importCloud.ts:1`, `apps/cli/src/commands/importCloud.ts:2`

### @strukt/mcp — `apps/mcp`

- **MCP** (ícone): `apps/mcp/package.json:18`, `apps/mcp/src/main.ts:3`
- **TypeScript**: `apps/mcp/src/args.ts:1`, `apps/mcp/src/comments.ts:1`, `apps/mcp/src/github.ts:1`, `apps/mcp/src/index.ts:1`, `apps/mcp/src/main.ts:1`
- **Node.js**: `apps/mcp/src/repositoryKnowledge.ts:2`, `apps/mcp/src/sync.ts:4`, `apps/mcp/src/testing.ts:1`, `apps/mcp/src/testing.ts:2`, `apps/mcp/src/testing.ts:3`

### @strukt/remote — `apps/remote`

- **Express** (ícone): `apps/remote/package.json:16`, `apps/remote/src/app.ts:4`
- **MCP**: `apps/remote/package.json:13`, `apps/remote/src/app.ts:7`
- **TypeScript**: `apps/remote/src/accountDirectory.ts:1`, `apps/remote/src/accounts.ts:1`, `apps/remote/src/app.ts:1`, `apps/remote/src/auth.ts:1`, `apps/remote/src/backup.ts:1`
- **Bun**: `apps/remote/src/auth.ts:7`, `apps/remote/src/backup.ts:1`, `apps/remote/src/collaboration.ts:6`, `apps/remote/src/deploymentSmoke.ts:6`, `apps/remote/src/hostedStore.ts:1`
- **Node.js**: `apps/remote/src/accountDirectory.ts:2`, `apps/remote/src/accounts.ts:2`, `apps/remote/src/app.ts:5`, `apps/remote/src/app.ts:6`, `apps/remote/src/auth.ts:5`
- **Docker**: `apps/remote/Dockerfile:1`
- **SQLite**: `apps/remote/src/auth.ts:7`, `apps/remote/src/backup.ts:1`, `apps/remote/src/collaboration.ts:6`, `apps/remote/src/deploymentSmoke.ts:6`, `apps/remote/src/hostedStore.ts:1`

### @strukt/server — `apps/server`

- **Hono** (ícone): `apps/server/package.json:24`, `apps/server/src/app.ts:1`
- **MCP**: `apps/server/package.json:14`, `apps/server/src/app.ts:26`
- **TypeScript**: `apps/server/src/agentSetup.ts:1`, `apps/server/src/anthropic.ts:1`, `apps/server/src/app.ts:1`, `apps/server/src/audit.ts:1`, `apps/server/src/chat.ts:1`
- **Bun**: `apps/server/src/collaborationHost.ts:7`, `apps/server/src/collaborationHost.ts:8`, `apps/server/src/connector.ts:1`, `apps/server/src/shareStack.ts:1`, `apps/server/src/shareStack.ts:11`
- **Node.js**: `apps/server/src/agentSetup.ts:2`, `apps/server/src/agentSetup.ts:3`, `apps/server/src/agentSetup.ts:4`, `apps/server/src/app.ts:12`, `apps/server/src/app.ts:29`
- **SQLite**: `apps/server/src/collaborationHost.ts:7`

### strukt-vscode — `apps/vscode`

- **TypeScript** (ícone): `apps/vscode/scripts/write-schema.ts:1`, `apps/vscode/src/appUrl.ts:1`, `apps/vscode/src/checkReport.ts:1`, `apps/vscode/src/cli.ts:1`, `apps/vscode/src/commands.ts:1`
- **Node.js**: `apps/vscode/package.json:13`, `apps/vscode/scripts/write-schema.ts:1`, `apps/vscode/src/commands.ts:1`, `apps/vscode/src/nodeExec.ts:1`

### @strukt/web — `apps/web`

- **React** (ícone): `apps/web/package.json:43`, `apps/web/package.json:44`, `apps/web/src/analytics/AnalyticsConsent.tsx:1`, `apps/web/src/comments/CommentsHost.tsx:6`
- **TypeScript**: `apps/web/scripts/build-icon-subset.ts:1`, `apps/web/scripts/build-logos-subset.ts:1`, `apps/web/scripts/build-lucide-categories.ts:1`, `apps/web/src/actions/canvasDiagrams.ts:1`, `apps/web/src/actions/clipboard.ts:1`
- **JavaScript**: `apps/web/docs/client.js:1`, `apps/web/docs/site.mjs:1`
- **Python**: `apps/web/scripts/build-cloud-icons.py:1`
- **Node.js**: `apps/web/docs/site.mjs:1`, `apps/web/scripts/build-icon-subset.ts:15`, `apps/web/scripts/build-icon-subset.ts:16`, `apps/web/scripts/build-logos-subset.ts:8`, `apps/web/scripts/build-lucide-categories.ts:11`
- **Tailwind CSS**: `apps/web/package.json:57`
- **Vite**: `apps/web/package.json:6`

### @strukt/core — `packages/core`

- **TypeScript** (ícone): `packages/core/src/aiProviders.ts:1`, `packages/core/src/applyOps.ts:1`, `packages/core/src/canvasDiagrams.ts:1`, `packages/core/src/catalogSearch.ts:1`, `packages/core/src/chatEdit.ts:1`

### @strukt/dsl — `packages/dsl`

- **TypeScript** (ícone): `packages/dsl/src/detect.ts:1`, `packages/dsl/src/diagramTree.ts:1`, `packages/dsl/src/export.ts:1`, `packages/dsl/src/import.ts:1`, `packages/dsl/src/import/cloud/aws.ts:1`

### @strukt/git — `packages/git`

- **TypeScript** (ícone): `packages/git/src/diff.ts:1`, `packages/git/src/diffSvg.ts:1`, `packages/git/src/index.ts:1`, `packages/git/src/publish.ts:1`, `packages/git/src/run.ts:1`
- **Node.js**: `packages/git/src/run.ts:1`

### @strukt/json — `packages/json`

- **TypeScript** (ícone): `packages/json/src/index.ts:1`, `packages/json/src/parse.ts:1`, `packages/json/src/parseJson.ts:1`, `packages/json/src/print.ts:1`, `packages/json/src/schema.ts:1`

### @strukt/layout — `packages/layout`

- **TypeScript** (ícone): `packages/layout/src/canvasFrames.ts:1`, `packages/layout/src/composition.ts:1`, `packages/layout/src/compositionRoutes.ts:1`, `packages/layout/src/elk.ts:1`, `packages/layout/src/eraserRouter.ts:1`

### @strukt/ops — `packages/ops`

- **TypeScript** (ícone): `packages/ops/src/check.ts:1`, `packages/ops/src/index.ts:1`, `packages/ops/src/plan.ts:1`, `packages/ops/src/schema.ts:1`, `packages/ops/tsconfig.json:1`

### @strukt/workspace — `packages/workspace`

- **TypeScript** (ícone): `packages/workspace/src/accessContext.ts:1`, `packages/workspace/src/agentHarness.ts:1`, `packages/workspace/src/assistants.ts:1`, `packages/workspace/src/assistantsBuiltin.ts:1`, `packages/workspace/src/assistantsParse.ts:1`
- **Node.js**: `packages/workspace/src/accessContext.ts:1`, `packages/workspace/src/fs.ts:3`, `packages/workspace/src/fs.ts:4`, `packages/workspace/src/health.ts:1`, `packages/workspace/src/health.ts:2`

### scripts — `scripts`

- **Python** (ícone): `scripts/check-publication.py:1`, `scripts/check-secrets.py:1`, `scripts/test_publication.py:1`, `scripts/test_secret_scanner.py:1`, `scripts/update-repository-grammars.py:1`
- **TypeScript**: `scripts/build-connector.ts:1`, `scripts/check-repository-parsers.ts:1`, `scripts/performance.ts:1`, `scripts/smoke-container.ts:1`
- **Node.js**: `scripts/build-connector.ts:2`, `scripts/build-connector.ts:3`, `scripts/check-repository-parsers.ts:1`, `scripts/smoke-container.ts:1`, `scripts/smoke-container.ts:2`

## Dependências por módulo

Relações estáticas de imports do código. Bibliotecas não são, por si só, serviços da arquitetura. Tipos e imports exclusivos de testes, fixtures e configuração de build ficam fora do mapa principal; estão separados abaixo.

### @strukt/cli

`apps/cli`

#### Produção (imports estáticos)

- @strukt/core — `packages/core` — `apps/cli/src/cloudDrift.ts:1`
- @strukt/dsl — `packages/dsl` — `apps/cli/src/cloudCollect.ts:1`
- @strukt/git — `packages/git` — `apps/cli/src/commands/check.ts:9`
- @strukt/json — `packages/json` — `apps/cli/src/commands/check.ts:5`
- @strukt/layout — `packages/layout` — `apps/cli/src/commands/importCloud.ts:8`
- @strukt/ops — `packages/ops` — `apps/cli/src/commands/sync.ts:3`
- @strukt/server — `apps/server` — `apps/cli/src/commands/repository.ts:14`
- @strukt/workspace — `packages/workspace` — `apps/cli/src/args.ts:1`

#### Tipos

- @strukt/dsl — `packages/dsl` — `apps/cli/src/cloudCollect.ts:2`
- @strukt/git — `packages/git` — `apps/cli/src/cloudAllowlist.ts:1`
- @strukt/json — `packages/json` — `apps/cli/src/commands/check.ts:6`
- @strukt/workspace — `packages/workspace` — `apps/cli/src/cloudDrift.ts:5`

#### Desenvolvimento

- @strukt/core — `packages/core` — `apps/cli/src/commands/diffStage.test.ts:1`
- @strukt/dsl — `packages/dsl` — `apps/cli/src/cloudDrift.test.ts:3`
- @strukt/git — `packages/git` — `apps/cli/src/cloudAllowlist.test.ts:3`
- @strukt/git — `packages/git` — `apps/cli/src/slugParity.test.ts:2`
- @strukt/json — `packages/json` — `apps/cli/src/commands/importCloud.test.ts:4`
- @strukt/mcp — `apps/mcp` — `apps/cli/src/commands/verify.test.ts:8`
- @strukt/workspace — `packages/workspace` — `apps/cli/src/commands/diffStage.test.ts:3`
- @strukt/workspace — `packages/workspace` — `apps/cli/src/commands/check.test.ts:3`
- vitest — `apps/cli/src/args.test.ts:1`
- yaml — `apps/cli/src/workflowTemplate.test.ts:6`

### @strukt/mcp

`apps/mcp`

#### Produção (imports estáticos)

- @modelcontextprotocol/sdk — `apps/mcp/src/main.ts:3`
- @strukt/core — `packages/core` — `apps/mcp/src/comments.ts:1`
- @strukt/git — `packages/git` — `apps/mcp/src/github.ts:1`
- @strukt/json — `packages/json` — `apps/mcp/src/resources.ts:2`
- @strukt/layout — `packages/layout` — `apps/mcp/src/tools.ts:8`
- @strukt/ops — `packages/ops` — `apps/mcp/src/tools.ts:9`
- @strukt/server — `apps/server` — `apps/mcp/src/main.ts:20`
- @strukt/workspace — `packages/workspace` — `apps/mcp/src/comments.ts:2`
- zod — `apps/mcp/src/comments.ts:5`

#### Tipos

- @modelcontextprotocol/sdk — `apps/mcp/src/comments.ts:4`
- @strukt/core — `packages/core` — `apps/mcp/src/tools.ts:6`
- @strukt/git — `packages/git` — `apps/mcp/src/github.ts:2`
- @strukt/workspace — `packages/workspace` — `apps/mcp/src/comments.ts:3`

#### Desenvolvimento

- @modelcontextprotocol/sdk — `apps/mcp/src/tools.test.ts:4`
- @strukt/core — `packages/core` — `apps/mcp/src/tools.test.ts:7`
- @strukt/core — `packages/core` — `apps/mcp/src/perspectives.test.ts:1`
- @strukt/json — `packages/json` — `apps/mcp/src/perspectives.test.ts:2`
- @strukt/layout — `packages/layout` — `apps/mcp/src/tools.test.ts:9`
- @strukt/workspace — `packages/workspace` — `apps/mcp/src/comments.test.ts:2`
- @strukt/workspace — `packages/workspace` — `apps/mcp/src/comments.test.ts:1`
- vitest — `apps/mcp/src/comments.test.ts:3`

### @strukt/remote

`apps/remote`

#### Produção (imports estáticos)

- @anthropic-ai/sdk — `apps/remote/src/hostedAi.ts:1`
- @modelcontextprotocol/sdk — `apps/remote/src/app.ts:7`
- @strukt/core — `packages/core` — `apps/remote/src/hostedAi.ts:7`
- @strukt/mcp — `apps/mcp` — `apps/remote/src/app.ts:10`
- @strukt/server — `apps/server` — `apps/remote/src/hosted.ts:5`
- @strukt/workspace — `packages/workspace` — `apps/remote/src/accounts.ts:3`
- express — `apps/remote/src/app.ts:4`
- ws — `apps/remote/src/collaboration.ts:9`
- yjs — `apps/remote/src/hostedSmoke.ts:12`

#### Tipos

- @modelcontextprotocol/sdk — `apps/remote/src/auth.ts:9`
- @strukt/mcp — `apps/mcp` — `apps/remote/src/app.ts:11`
- @strukt/server — `apps/server` — `apps/remote/src/hostedAi.ts:27`
- @strukt/workspace — `packages/workspace` — `apps/remote/src/betaAccounts.ts:2`
- express — `apps/remote/src/accountDirectory.ts:1`
- ws — `apps/remote/src/collaboration.ts:10`

#### Desenvolvimento

- @strukt/workspace — `packages/workspace` — `apps/remote/src/githubWorkspace.test.ts:1`
- express — `apps/remote/src/webHosting.test.ts:3`
- vitest — `apps/remote/src/betaAccounts.test.ts:5`

### @strukt/server

`apps/server`

#### Produção (imports estáticos)

- @anthropic-ai/sdk — `apps/server/src/app.ts:22`
- @modelcontextprotocol/sdk — `apps/server/src/app.ts:26`
- @strukt/core — `packages/core` — `apps/server/src/anthropic.ts:17`
- @strukt/git — `packages/git` — `apps/server/src/app.ts:23`
- @strukt/json — `packages/json` — `apps/server/src/chatEdit.ts:5`
- @strukt/mcp — `apps/mcp` — `apps/server/src/app.ts:27`
- @strukt/ops — `packages/ops` — `apps/server/src/chatEdit.ts:6`
- @strukt/workspace — `packages/workspace` — `apps/server/src/agentSetup.ts:1`
- hono — `apps/server/src/app.ts:1`

#### Tipos

- @anthropic-ai/sdk — `apps/server/src/anthropic.ts:1`
- @strukt/core — `packages/core` — `apps/server/src/chatEdit.ts:4`
- @strukt/git — `packages/git` — `apps/server/src/app.ts:24`
- @strukt/ops — `packages/ops` — `apps/server/src/prompt.ts:5`
- @strukt/workspace — `packages/workspace` — `apps/server/src/app.ts:9`
- hono — `apps/server/src/app.ts:31`

#### Desenvolvimento

- @anthropic-ai/sdk — `apps/server/src/app.test.ts:1`
- @modelcontextprotocol/sdk — `apps/server/src/app.test.ts:5`
- @strukt/core — `packages/core` — `apps/server/src/chatEdit.test.ts:7`
- @strukt/dsl — `packages/dsl` — `apps/server/src/diagram.test.ts:3`
- @strukt/git — `packages/git` — `apps/server/src/git.test.ts:8`
- @strukt/git — `packages/git` — `apps/server/src/app.test.ts:11`
- @strukt/json — `packages/json` — `apps/server/src/chatRepair.test.ts:3`
- @strukt/ops — `packages/ops` — `apps/server/src/diagram.test.ts:6`
- @strukt/web — `apps/web` — `apps/server/src/collaborationHttp.test.ts:10`
- @strukt/workspace — `packages/workspace` — `apps/server/src/collaborationHttp.test.ts:8`
- @strukt/workspace — `packages/workspace` — `apps/server/src/app.test.ts:7`
- vitest — `apps/server/src/agentSetup.test.ts:4`

### strukt-vscode

`apps/vscode`

#### Produção (imports estáticos)

- @strukt/json — `packages/json` — `apps/vscode/scripts/write-schema.ts:2`
- vscode — `apps/vscode/src/extension.ts:1`

#### Tipos

- @strukt/json — `packages/json` — `apps/vscode/src/diagnostics.ts:2`

#### Desenvolvimento

- @strukt/json — `packages/json` — `apps/vscode/src/diagnostics.test.ts:3`
- vitest — `apps/vscode/src/appUrl.test.ts:1`

### @strukt/web

`apps/web`

#### Produção (imports estáticos)

- @codemirror/autocomplete — `apps/web/src/docs/commands.ts:2`
- @codemirror/commands — `apps/web/src/docs/commands.ts:4`
- @codemirror/lang-json — `apps/web/src/panels/CodePanel.tsx:5`
- @codemirror/lang-markdown — `apps/web/src/docs/DocView.tsx:11`
- @codemirror/language — `apps/web/src/docs/commands.ts:5`
- @codemirror/lint — `apps/web/src/panels/CodePanel.tsx:6`
- @codemirror/search — `apps/web/src/panels/CodePanel.tsx:7`
- @codemirror/state — `apps/web/src/docs/commentMarks.ts:1`
- @codemirror/view — `apps/web/src/docs/commands.ts:7`
- @excalidraw/excalidraw — `apps/web/src/sketch/applyEdit.ts:3`
- @fontsource-variable/geist-mono — `apps/web/src/export/fonts.ts:2`
- @fontsource-variable/shantell-sans — `apps/web/src/export/fonts.ts:3`
- @fontsource-variable/sora — `apps/web/src/export/fonts.ts:1`
- @iconify-json/logos — `apps/web/scripts/build-logos-subset.ts:9`
- @lezer/highlight — `apps/web/src/docs/livePreview.ts:16`
- @strukt/core — `packages/core` — `apps/web/src/actions/canvasDiagrams.ts:2`
- @strukt/dsl — `packages/dsl` — `apps/web/src/actions/export.ts:40`
- @strukt/json — `packages/json` — `apps/web/src/ai/aiStore.ts:2`
- @strukt/layout — `packages/layout` — `apps/web/src/actions/canvasDiagrams.ts:4`
- @strukt/workspace — `packages/workspace` — `apps/web/src/actions/library.ts:3`
- @xyflow/react — `apps/web/src/app/AppShell.tsx:5`
- dompurify — `apps/web/src/docs/markdown.ts:46`
- lucide — `apps/web/scripts/build-lucide-categories.ts:12`
- lucide-react — `apps/web/src/app/BootScreen.tsx:5`
- marked — `apps/web/docs/site.mjs:2`
- motion — `apps/web/src/App.tsx:1`
- pdfmake — `apps/web/src/docs/pdf.ts:10`
- radix-ui — `apps/web/src/panels/Inspector.tsx:13`
- react — `apps/web/src/analytics/AnalyticsConsent.tsx:1`
- react-dom — `apps/web/src/comments/CommentsHost.tsx:6`
- simple-icons — `apps/web/docs/site.mjs:3`
- vitest — `apps/web/src/testLocale.ts:1`
- xml — `apps/web/scripts/build-cloud-icons.py:5`
- yjs — `apps/web/src/app/CollaborationBridge.tsx:2`
- zustand — `apps/web/src/actions/library.ts:5`

#### Tipos

- @codemirror/autocomplete — `apps/web/src/docs/commands.ts:3`
- @codemirror/lint — `apps/web/src/code/diagnostics.ts:1`
- @codemirror/state — `apps/web/src/docs/commands.ts:6`
- @codemirror/view — `apps/web/src/docs/commentBridge.ts:1`
- @excalidraw/excalidraw — `apps/web/src/sketch/applyEdit.ts:5`
- @iconify-json/logos — `apps/web/scripts/build-logos-subset.ts:10`
- @strukt/core — `packages/core` — `apps/web/src/actions/canvasDiagrams.ts:3`
- @strukt/dsl — `packages/dsl` — `apps/web/src/code/importFormats.ts:2`
- @strukt/json — `packages/json` — `apps/web/src/code/sync.ts:5`
- @strukt/layout — `packages/layout` — `apps/web/src/ai/aiStore.ts:3`
- @strukt/workspace — `packages/workspace` — `apps/web/src/actions/commands.ts:2`
- @xyflow/react — `apps/web/src/board/CardNode.tsx:6`
- dompurify — `apps/web/src/docs/markdown.ts:4`
- lucide-react — `apps/web/src/landing/Diagram.tsx:4`
- marked — `apps/web/src/docs/markdown.ts:5`
- motion — `apps/web/src/ui/motion.ts:1`
- pdfmake — `apps/web/src/docs/pdf.ts:6`
- react — `apps/web/src/app/EmptyCanvas.tsx:5`

#### Desenvolvimento

-  — `apps/web/e2e/admin.spec.ts:17`
- @codemirror/autocomplete — `apps/web/src/docs/commands.test.ts:2`
- @codemirror/lang-markdown — `apps/web/src/docs/commands.test.ts:3`
- @codemirror/state — `apps/web/src/docs/commands.test.ts:4`
- @playwright/test — `apps/web/e2e/a11y-axe.spec.ts:2`
- @playwright/test — `apps/web/e2e/a11y-axe.spec.ts:1`
- @strukt/core — `packages/core` — `apps/web/e2e/group-composition.spec.ts:4`
- @strukt/core — `packages/core` — `apps/web/e2e/components.spec.ts:2`
- @strukt/dsl — `packages/dsl` — `apps/web/src/code/importFormats.test.ts:2`
- @strukt/json — `packages/json` — `apps/web/src/code/sync.test.ts:5`
- @strukt/json — `packages/json` — `apps/web/e2e/group-composition.spec.ts:5`
- @strukt/layout — `packages/layout` — `apps/web/src/samples/example-routing.test.ts:4`
- @strukt/layout — `packages/layout` — `apps/web/e2e/group-composition.spec.ts:1`
- @strukt/mcp — `apps/mcp` — `apps/web/e2e/architecture-features.spec.ts:4`
- @strukt/remote — `apps/remote` — `apps/web/e2e/fixtures/hosted.ts:6`
- @strukt/server — `apps/server` — `apps/web/src/integrations/svgCompat.test.ts:7`
- @strukt/workspace — `packages/workspace` — `apps/web/e2e/overview-persistence.spec.ts:3`
- @strukt/workspace — `packages/workspace` — `apps/web/e2e/optional-login.spec.ts:5`
- @tailwindcss/vite — `apps/web/vite.config.ts:1`
- @vitejs/plugin-react — `apps/web/vite.config.ts:2`
- marked — `apps/web/src/context/contextMarkdown.test.ts:3`
- radix-ui — `apps/web/src/app/TopBar.test.tsx:1`
- react — `apps/web/src/share/components.test.tsx:3`
- react-dom — `apps/web/src/app/SaveIndicator.test.tsx:1`
- simple-icons — `apps/web/src/diagram/icons/simpleIndex.test.ts:1`
- vite — `apps/web/vite.config.ts:3`
- vitest — `apps/web/src/actions/clipboard.test.ts:2`
- yjs — `apps/web/src/docs/remoteCursors.test.ts:2`

#### Referências não resolvidas

- ../build/loadingBudget — `apps/web/e2e/production-loading.spec.ts:1`
- ./analytics.css — `apps/web/src/analytics/ConsentView.tsx:5`
- ./board.css — `apps/web/src/board/BoardView.tsx:30`
- ../build/loadingBudget — `apps/web/src/bundle.test.ts:2`
- ../build/sourceStamp.mjs — `apps/web/src/bundle.test.ts:3`
- ./cloud/aws.json — `apps/web/src/diagram/icons/registry.ts:91`
- ./cloud/azure.json — `apps/web/src/diagram/icons/registry.ts:92`
- ./cloud/gcp.json — `apps/web/src/diagram/icons/registry.ts:93`
- ./documents.css — `apps/web/src/docs/DocView.tsx:9`
- ./language.css — `apps/web/src/i18n/LanguagePicker.tsx:4`
- ./landing.css — `apps/web/src/landing/main.tsx:23`
- ./styles/app.css — `apps/web/src/main.tsx:7`
- ./styles/diagram.css — `apps/web/src/main.tsx:8`
- ./inspector.css — `apps/web/src/panels/Inspector.tsx:5`
- ./settings.css — `apps/web/src/settings/SettingsModal.tsx:21`
- ../build/sourceStamp.mjs — `apps/web/src/sourceStamp.test.ts:5`
- ./build/sourceStamp.mjs — `apps/web/vite.config.ts:4`

#### Limitações sintáticas

- apps/web/e2e/chat-experience.spec.ts: Dynamic or unresolved reference at line 65, column 33.
- apps/web/src/ai/draft.test.ts: Invalid syntax at line 109.
- apps/web/src/chat/store.test.ts: Invalid syntax at line 429.
- apps/web/src/code/sync.test.ts: Invalid syntax at line 17.
- apps/web/src/code/sync.test.ts: Invalid syntax at line 22.
- apps/web/src/panels/ComponentLibrary.tsx: Invalid syntax at line 24.
- apps/web/src/settings/PlanSection.tsx: Invalid syntax at line 35.
- apps/web/src/state/routing.test.ts: Invalid syntax at line 14.
- apps/web/src/workspace/workspace.ts: Invalid syntax at line 98.
- apps/web/src/workspace/workspace.ts: Invalid syntax at line 186.

### @strukt/core

`packages/core`

#### Produção (imports estáticos)

- fast-check — `packages/core/src/testing.ts:1`

#### Desenvolvimento

- fast-check — `packages/core/src/diff.test.ts:1`
- vitest — `packages/core/src/applyOps.test.ts:1`

### @strukt/dsl

`packages/dsl`

#### Produção (imports estáticos)

- @strukt/core — `packages/core` — `packages/dsl/src/diagramTree.ts:1`
- @strukt/json — `packages/json` — `packages/dsl/src/import/testkit.ts:2`
- vitest — `packages/dsl/src/import/testkit.ts:1`
- yaml — `packages/dsl/src/import/yaml.ts:1`

#### Tipos

- @strukt/core — `packages/core` — `packages/dsl/src/diagramTree.ts:2`

#### Desenvolvimento

- @strukt/core — `packages/core` — `packages/dsl/src/diagramTree.test.ts:2`
- @strukt/core — `packages/core` — `packages/dsl/src/diagramTree.test.ts:1`
- @strukt/json — `packages/json` — `packages/dsl/src/import/cloud/graph.test.ts:2`
- fast-check — `packages/dsl/src/parse.test.ts:2`
- scripts — `scripts` — `packages/dsl/src/import/adversarial.test.ts:2`
- vitest — `packages/dsl/src/diagramTree.test.ts:3`

#### Limitações sintáticas

- packages/dsl/src/import.ts: Invalid syntax at line 29.

### @strukt/git

`packages/git`

#### Produção (imports estáticos)

- @strukt/core — `packages/core` — `packages/git/src/diff.ts:1`
- @strukt/workspace — `packages/workspace` — `packages/git/src/diff.ts:3`

#### Tipos

- @strukt/core — `packages/core` — `packages/git/src/diff.ts:2`
- @strukt/workspace — `packages/workspace` — `packages/git/src/diff.ts:4`

#### Desenvolvimento

- @strukt/core — `packages/core` — `packages/git/src/diffSvg.test.ts:3`
- @strukt/core — `packages/core` — `packages/git/src/diffSvg.test.ts:2`
- @strukt/workspace — `packages/workspace` — `packages/git/src/diff.test.ts:2`
- vitest — `packages/git/src/diff.test.ts:1`

### @strukt/json

`packages/json`

#### Produção (imports estáticos)

- @strukt/core — `packages/core` — `packages/json/src/parse.ts:3`

#### Tipos

- @strukt/core — `packages/core` — `packages/json/src/parse.ts:4`

#### Desenvolvimento

- @strukt/core — `packages/core` — `packages/json/src/parse.test.ts:2`
- @strukt/core — `packages/core` — `packages/json/src/canvasFrame.test.ts:2`
- fast-check — `packages/json/src/parse.test.ts:4`
- vitest — `packages/json/src/canvasFrame.test.ts:1`

### @strukt/layout

`packages/layout`

#### Produção (imports estáticos)

- @eraserlabs/layout — `packages/layout/src/eraserRouter.ts:1`
- @strukt/core — `packages/core` — `packages/layout/src/canvasFrames.ts:1`
- elkjs — `packages/layout/src/elk.ts:26`

#### Tipos

- @eraserlabs/layout — `packages/layout/src/eraserRouter.ts:2`
- @strukt/core — `packages/core` — `packages/layout/src/canvasFrames.ts:2`
- elkjs — `packages/layout/src/elk.ts:3`

#### Desenvolvimento

- @strukt/core — `packages/core` — `packages/layout/src/composition.test.ts:2`
- @strukt/core — `packages/core` — `packages/layout/src/canvasFrames.test.ts:1`
- vitest — `packages/layout/src/canvasFrames.test.ts:2`

### @strukt/ops

`packages/ops`

#### Produção (imports estáticos)

- @strukt/core — `packages/core` — `packages/ops/src/check.ts:1`
- @strukt/layout — `packages/layout` — `packages/ops/src/plan.ts:3`
- ajv — `packages/ops/src/schema.ts:3`

#### Tipos

- @strukt/core — `packages/core` — `packages/ops/src/check.ts:2`
- ajv — `packages/ops/src/schema.ts:4`

#### Desenvolvimento

- @strukt/core — `packages/core` — `packages/ops/src/plan.test.ts:2`
- @strukt/core — `packages/core` — `packages/ops/src/plan.test.ts:1`
- ajv — `packages/ops/src/schema.test.ts:2`
- vitest — `packages/ops/src/plan.test.ts:3`

### @strukt/workspace

`packages/workspace`

#### Produção (imports estáticos)

- @strukt/core — `packages/core` — `packages/workspace/src/board.ts:1`
- @strukt/dsl — `packages/dsl` — `packages/workspace/src/diagram.ts:3`
- @strukt/json — `packages/json` — `packages/workspace/src/collaborationFiles.ts:2`
- @strukt/layout — `packages/layout` — `packages/workspace/src/repository/importers.ts:1`
- fflate — `packages/workspace/src/zip.ts:2`
- ignore — `packages/workspace/src/repository/reader.ts:1`
- web-tree-sitter — `packages/workspace/src/repository/syntax.ts:1`
- yjs — `packages/workspace/src/collaboration.ts:1`

#### Tipos

- @strukt/core — `packages/core` — `packages/workspace/src/collaborationSanitize.ts:2`
- @strukt/dsl — `packages/dsl` — `packages/workspace/src/diagram.ts:4`
- @strukt/json — `packages/json` — `packages/workspace/src/diagram.ts:6`
- web-tree-sitter — `packages/workspace/src/repository/syntax.ts:1`

#### Desenvolvimento

- @strukt/core — `packages/core` — `packages/workspace/src/collaboration.test.ts:4`
- @strukt/core — `packages/core` — `packages/workspace/src/collaboration.test.ts:3`
- @strukt/dsl — `packages/dsl` — `packages/workspace/src/context.test.ts:1`
- @strukt/json — `packages/json` — `packages/workspace/src/collaboration.test.ts:5`
- fflate — `packages/workspace/src/zip.test.ts:1`
- scripts — `scripts` — `packages/workspace/src/evidence.test.ts:2`
- vitest — `packages/workspace/src/accessContext.test.ts:1`
- yjs — `packages/workspace/src/collaboration.test.ts:2`

### scripts

`scripts`

#### Produção (imports estáticos)

- @strukt/workspace — `packages/workspace` — `scripts/check-repository-parsers.ts:2`
- argparse — `scripts/check-secrets.py:3`
- base64 — `scripts/update-repository-grammars.py:3`
- hashlib — `scripts/update-repository-grammars.py:3`
- importlib — `scripts/test_publication.py:1`
- io — `scripts/update-repository-grammars.py:3`
- secrets — `scripts/test_secret_scanner.py:5`
- subprocess — `scripts/check-publication.py:5`
- tarfile — `scripts/update-repository-grammars.py:3`
- tempfile — `scripts/check-secrets.py:7`
- urllib — `scripts/update-repository-grammars.py:3`

#### Referências não resolvidas

- ../apps/web/build/checkLinks — `scripts/links.test.ts:5`

## Documentação encontrada

- apps/vscode/README.md
- apps/web/DESIGN.md
- apps/web/PRODUCT.md
- CONTRIBUTING.md
- deploy/README.md
- docs/agents.md
- docs/idiomas.md
- docs/landing-visual-stories.md
- docs/open-source.md
- docs/provedores-de-ia.md
- docs/releases.md
- docs/third-party/cloud-icons.md
- docs/third-party/eraser-diagrams.md
- docs/third-party/ignore.md
- docs/workspace-settings.md
- README.md
- SECURITY.md
- SOURCE.md
- THIRD_PARTY_NOTICES.md
- TRADEMARKS.md
