# Visão geral — Joinlet

> Parte da arquitetura de “Joinlet” (visão completa em [ARCHITECTURE.md](../ARCHITECTURE.md)). Gerado pelo Joinlet: não edite à mão.

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

## Componentes

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

## Evidências no código

- `edge:repo_09e11a52066c67→repo_e86a0d465b5caa`: `apps/vscode/src/diagnostics.ts#L2` — trecho esperado: `'@strukt/json'`
- `edge:repo_3b4e3efd29cd13→repo_41ba823706ed42`: `apps/web/src/ai/aiStore.ts#L3` — trecho esperado: `'@strukt/layout'`
- `edge:repo_3b4e3efd29cd13→repo_5c1ab4b7e80ad1`: `apps/web/src/code/importFormats.ts#L2` — trecho esperado: `'@strukt/dsl/lite'`
- `edge:repo_3b4e3efd29cd13→repo_d4ff4b28356bed`: `apps/web/src/actions/commands.ts#L2` — trecho esperado: `'@strukt/workspace'`
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

## Conexões

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

## Documentos ligados

### Joinlet para VS Code

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
