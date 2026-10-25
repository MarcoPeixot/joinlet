> Joinlet · Fonte: `README.md`. Projeção do arquivo do repositório. Alterações feitas aqui são preservadas para revisão; o arquivo original não é substituído.

<p align="center">
  <img src="apps/web/public/brand/joinlet-icon.svg" alt="Joinlet" width="64" />
</p>

<h1 align="center">Joinlet</h1>

<p align="center">
  <strong>Architecture that lives with your code.</strong><br />
  Design systems visually. Keep diagrams, decisions and coding-agent context in your repository.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#features">Features</a> ·
  <a href="#coding-agents">Coding agents</a> ·
  <a href="#self-hosting-and-joinlet-cloud">Self-hosting</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-blue" alt="License: AGPL-3.0-only" /></a>
  <a href="https://github.com/MarcoPeixot/joinlet/actions/workflows/ci.yml"><img src="https://github.com/MarcoPeixot/joinlet/actions/workflows/ci.yml/badge.svg?branch=main" alt="Joinlet checks" /></a>
</p>

![Joinlet editor showing an example commerce architecture with frontend applications, an API gateway, services, databases and Kafka.](.github/assets/workspace.png)

Joinlet is an open-source workspace for software architecture. Draw how your system fits together, write down the decisions behind it, and give your coding agents that same context through MCP and the CLI.

Start in your browser without an account, or save a workspace to a local folder. Repository workspaces live in `.arch/` as JSON and Markdown, so architecture changes can be reviewed alongside code in Git.

## Features

- **Visual system design.** Build diagrams with nested groups, cloud and technology icons, architecture perspectives and animated flows. Export to SVG, PNG, Mermaid or PlantUML.
- **System simulation.** Model traffic, finite queues, caching, retries, circuit breakers and autoscaling on an existing diagram. Run reproducible scenarios in a browser worker or through CLI/MCP, compare saved reports and start from illustrative Playground examples. See the [simulation model and reference](.arch/docs/simulacao-de-sistemas-no-joinlet.md).
- **Diagrams, decisions and sketches together.** Keep Markdown documentation and Excalidraw sketches in the same workspace. Use presentation mode to walk others through your design.
- **Made for Git.** Store diagram structure and layout separately, inspect semantic differences and keep version history. Moving a node does not rewrite its architecture definition.
- **Context for coding agents.** Read and update architecture through MCP, generate repository context with the CLI, and connect diagrams to source evidence. Synchronize supported source formats such as Terraform, OpenAPI and Kubernetes.
- **AI with your own provider.** Connect your credentials to discuss the system and generate architecture proposals. Review structured diagram proposals before applying them.
- **Team collaboration.** Work together with live cursors, comments and invitations with view, comment or edit permissions. Run the collaboration services on your own infrastructure.

## Quick start

You'll need [Bun](https://bun.sh/) **1.4.3 or later** and [Node.js](https://nodejs.org/) **22.12 or later**.

```sh
git clone https://github.com/MarcoPeixot/joinlet.git
cd joinlet
bun install --frozen-lockfile
bun run dev
```

Open the **[editor](http://localhost:5178/app/?lang=en)** or the **[English documentation](http://localhost:5178/docs/en/)**. The development command starts the web app and local API.

The core editor works with browser storage: no account or API key is required. Open a local folder to keep your workspace with a project. AI features and external integrations are optional and use your own credentials.

> Joinlet is in beta. Back up important workspaces and review changes before using them in production.

## Coding agents

Joinlet exposes architecture to MCP-compatible coding agents. First create or open a folder workspace in the editor, then add this server to your MCP client, replacing both absolute paths:

```json
{
  "mcpServers": {
    "joinlet": {
      "command": "bun",
      "args": [
        "/absolute/path/to/joinlet/apps/mcp/src/main.ts",
        "--dir",
        "/absolute/path/to/your-project"
      ]
    }
  }
}
```

Agents can inspect diagrams and documents, propose changes, and check source evidence. You can also generate context and verify the workspace directly from the Joinlet checkout:

```sh
bun apps/cli/src/main.ts context --dir /absolute/path/to/your-project
bun apps/cli/src/main.ts verify --strict --dir /absolute/path/to/your-project
```

Generated context includes `ARCHITECTURE.md`, `llms.txt` and per-diagram files. Source synchronization covers configured import formats and anchored evidence; it does not verify arbitrary code behavior. Editing a diagram does not automatically rewrite application code.

See the [MCP and CLI reference](docs/agents.md) for tool details.

## How workspaces are stored

A folder workspace keeps its architecture in readable files:

```text
.arch/
├── strukt.json              # Workspace manifest
├── diagrams/
│   ├── system.strukt.json   # Nodes, connections and groups
│   └── system.layout.json   # Canvas positions and sizes
├── docs/                    # Markdown documents
├── sketches/                # Excalidraw sketches
└── context/                 # Generated context for coding agents
```

Commit these files alongside your code. Keep generated context up to date through the CLI; review changes to both source and architecture in pull requests.

## Self-hosting and Joinlet Cloud

The complete original product is open source: editor, servers, CLI, MCP, VS Code extension and shared packages. Self-host it with your own credentials using the [Docker deployment guide](deploy/README.md). Local use and self-hosting have no commercial workspace, diagram or participant quotas; permissions and technical capacity limits still apply.

**Joinlet Cloud is the planned managed service**, offering hosting and operation of the same product. Paid subscriptions are not implemented yet. See the [open-source and hosting model](docs/open-source.md) for the current boundaries and limitations, and the [release process](docs/releases.md) for how reviewed changes reach an official installation.

## Contributing

Bug reports, documentation improvements and code contributions are welcome. Read the [contributing guide](CONTRIBUTING.md) to set up development, run checks and prepare a pull request.

- [Report a bug or suggest a feature](https://github.com/MarcoPeixot/joinlet/issues).
- [Browse the product architecture](.arch/context/ARCHITECTURE.md).
- [Report a security vulnerability privately](SECURITY.md).

The monorepo contains applications in `apps/` and shared libraries in `packages/`. Existing `@strukt/*` package names, `.strukt.json` files and `STRUKT_*` settings are retained for compatibility.

## License

Original Joinlet code is licensed under [AGPL-3.0-only](LICENSE). Third-party code and assets retain their own terms; see [Third-party notices](THIRD_PARTY_NOTICES.md). The Joinlet name and visual identity are covered by the [brand policy](TRADEMARKS.md). For corresponding source information, see [SOURCE.md](SOURCE.md).

### Conectar código e arquitetura

`joinlet init --dir /projeto` prepara `.arch` pelo código e documentos; `joinlet connect [pasta]` abre o editor local sem conta; `joinlet watch --dir /projeto` acompanha alterações. O painel de repositório oferece pasta nativa, pareamento de computador e seleção GitHub/branch na Cloud autenticada. Sem IA, as importações determinísticas terminam com análise semântica pendente. Diagramas continuam representando arquitetura desejada: implementar suas alterações na aplicação é tarefa do agente.

Veja [sincronização, cobertura e conflitos](.arch/docs/conexao-e-sincronizacao-de-repositorios.md) e [configuração do worker](deploy/README.md#sincronização-de-repositórios). `bun run build:connector` prepara um pacote instalável para a plataforma atual; mantenha binário, `elk-worker.js` e pasta `web` juntos. A distribuição não implica ativação da infraestrutura oficial.
