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

- **MCP** (ícone): `apps/mcp/package.json:18`, `apps/mcp/src/comments.ts:4`
- **TypeScript**: `apps/mcp/src/args.ts:1`, `apps/mcp/src/comments.ts:1`, `apps/mcp/src/github.ts:1`, `apps/mcp/src/index.ts:1`, `apps/mcp/src/main.ts:1`
- **Node.js**: `apps/mcp/src/repositoryKnowledge.ts:2`, `apps/mcp/src/sync.ts:4`, `apps/mcp/src/testing.ts:1`, `apps/mcp/src/testing.ts:2`, `apps/mcp/src/testing.ts:3`

### @strukt/remote — `apps/remote`

- **Express** (ícone): `apps/remote/package.json:16`, `apps/remote/src/accountDirectory.ts:1`
- **MCP**: `apps/remote/package.json:13`, `apps/remote/src/app.ts:7`
- **TypeScript**: `apps/remote/src/accountDirectory.ts:1`, `apps/remote/src/accounts.ts:1`, `apps/remote/src/app.ts:1`, `apps/remote/src/auth.ts:1`, `apps/remote/src/backup.ts:1`
- **Bun**: `apps/remote/src/accounts.ts:1`, `apps/remote/src/auth.ts:7`, `apps/remote/src/backup.ts:1`, `apps/remote/src/betaAccounts.ts:1`, `apps/remote/src/collaboration.ts:6`
- **Node.js**: `apps/remote/src/accountDirectory.ts:2`, `apps/remote/src/accounts.ts:2`, `apps/remote/src/app.ts:5`, `apps/remote/src/app.ts:6`, `apps/remote/src/auth.ts:5`
- **Docker**: `apps/remote/Dockerfile:1`
- **SQLite**: `apps/remote/src/accounts.ts:1`, `apps/remote/src/auth.ts:7`, `apps/remote/src/backup.ts:1`, `apps/remote/src/betaAccounts.ts:1`, `apps/remote/src/collaboration.ts:6`

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

- **React** (ícone): `apps/web/package.json:42`, `apps/web/package.json:43`, `apps/web/src/analytics/AnalyticsConsent.tsx:1`, `apps/web/src/comments/CommentsHost.tsx:6`
- **TypeScript**: `apps/web/scripts/build-icon-subset.ts:1`, `apps/web/scripts/build-logos-subset.ts:1`, `apps/web/scripts/build-lucide-categories.ts:1`, `apps/web/src/actions/canvasDiagrams.ts:1`, `apps/web/src/actions/clipboard.ts:1`
- **JavaScript**: `apps/web/docs/client.js:1`, `apps/web/docs/site.mjs:1`
- **Python**: `apps/web/scripts/build-cloud-icons.py:1`
- **Node.js**: `apps/web/docs/site.mjs:1`, `apps/web/scripts/build-icon-subset.ts:15`, `apps/web/scripts/build-icon-subset.ts:16`, `apps/web/scripts/build-logos-subset.ts:8`, `apps/web/scripts/build-lucide-categories.ts:11`
- **Tailwind CSS**: `apps/web/package.json:56`
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
- **Bun**: `packages/workspace/src/collaborationSqlite.ts:1`
- **Node.js**: `packages/workspace/src/accessContext.ts:1`, `packages/workspace/src/fs.ts:3`, `packages/workspace/src/fs.ts:4`, `packages/workspace/src/health.ts:1`, `packages/workspace/src/health.ts:2`
- **SQLite**: `packages/workspace/src/collaborationSqlite.ts:1`

### scripts — `scripts`

- **Python** (ícone): `scripts/check-publication.py:1`, `scripts/check-secrets.py:1`, `scripts/test_publication.py:1`, `scripts/test_secret_scanner.py:1`
- **TypeScript**: `scripts/build-connector.ts:1`, `scripts/smoke-container.ts:1`
- **Node.js**: `scripts/build-connector.ts:2`, `scripts/build-connector.ts:3`, `scripts/smoke-container.ts:1`, `scripts/smoke-container.ts:2`, `scripts/smoke-container.ts:3`

## Dependências por módulo

Relações estáticas de imports do código. Bibliotecas não são, por si só, serviços da arquitetura. Imports exclusivos de testes, fixtures e configuração de build ficam fora deste mapa.

### @strukt/cli

`apps/cli`

- @strukt/core — `packages/core`
- @strukt/dsl — `packages/dsl`
- @strukt/git — `packages/git`
- @strukt/json — `packages/json`
- @strukt/layout — `packages/layout`
- @strukt/ops — `packages/ops`
- @strukt/workspace — `packages/workspace`

### @strukt/mcp

`apps/mcp`

- @modelcontextprotocol/sdk
- @strukt/core — `packages/core`
- @strukt/git — `packages/git`
- @strukt/json — `packages/json`
- @strukt/layout — `packages/layout`
- @strukt/ops — `packages/ops`
- @strukt/workspace — `packages/workspace`
- zod

### @strukt/remote

`apps/remote`

- @anthropic-ai/sdk
- @modelcontextprotocol/sdk
- @strukt/mcp — `apps/mcp`
- @strukt/server — `apps/server`
- @strukt/workspace — `packages/workspace`
- express
- ws
- yjs

### @strukt/server

`apps/server`

- @anthropic-ai/sdk
- @modelcontextprotocol/sdk
- @strukt/core — `packages/core`
- @strukt/git — `packages/git`
- @strukt/json — `packages/json`
- @strukt/mcp — `apps/mcp`
- @strukt/ops — `packages/ops`
- @strukt/workspace — `packages/workspace`
- hono

### strukt-vscode

`apps/vscode`

- @strukt/json — `packages/json`
- vscode

### @strukt/web

`apps/web`

- @codemirror/autocomplete
- @codemirror/commands
- @codemirror/lang-json
- @codemirror/lang-markdown
- @codemirror/language
- @codemirror/lint
- @codemirror/search
- @codemirror/state
- @codemirror/view
- @excalidraw/excalidraw
- @fontsource-variable/geist-mono
- @fontsource-variable/shantell-sans
- @fontsource-variable/sora
- @iconify-json/logos
- @lezer/highlight
- @strukt/core — `packages/core`
- @strukt/dsl — `packages/dsl`
- @strukt/json — `packages/json`
- @strukt/layout — `packages/layout`
- @strukt/workspace — `packages/workspace`
- @xyflow/react
- dompurify
- lucide
- lucide-react
- marked
- motion
- pdfmake
- radix-ui
- react
- react-dom
- simple-icons
- vitest
- yjs
- zustand

### @strukt/core

`packages/core`

- fast-check

### @strukt/dsl

`packages/dsl`

- @strukt/core — `packages/core`
- @strukt/json — `packages/json`
- vitest
- yaml

### @strukt/git

`packages/git`

- @strukt/core — `packages/core`
- @strukt/workspace — `packages/workspace`

### @strukt/json

`packages/json`

- @strukt/core — `packages/core`

### @strukt/layout

`packages/layout`

- @eraserlabs/layout
- @strukt/core — `packages/core`
- elkjs

### @strukt/ops

`packages/ops`

- @strukt/core — `packages/core`
- @strukt/layout — `packages/layout`
- ajv

### @strukt/workspace

`packages/workspace`

- @strukt/core — `packages/core`
- @strukt/dsl — `packages/dsl`
- @strukt/json — `packages/json`
- @strukt/layout — `packages/layout`
- fflate
- ignore
- yjs

### scripts

`scripts`

Sem imports externos ao módulo reconhecidos.

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
