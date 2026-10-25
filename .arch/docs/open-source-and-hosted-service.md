> Joinlet · Fonte: `docs/open-source.md`. Projeção do arquivo do repositório. Alterações feitas aqui são preservadas para revisão; o arquivo original não é substituído.

# Open source and hosted service

The original Joinlet application code is licensed under **AGPL-3.0-only**. You can inspect, modify, contribute to and self-host the application under that license. Third-party code and assets retain their documented terms. The software license does not grant access to the official hosted infrastructure.

Joinlet Cloud is the managed installation of the product. Hosting, persistent service availability, storage, backups, updates and support can be offered commercially. The complete original product is open source; no proprietary product edition is reserved by this release. Subscription billing and paid entitlements are not implemented yet. Local/browser use, CLI, MCP and self-hosted deployments have no commercial workspace, diagram or participant quotas. The official Cloud selects its own server-side policy (currently Free Beta).

This repository includes the editor, local server, remote backend, CLI, MCP, VS Code extension, shared packages and generic Docker deployment examples. Self-hosting does not require the founder's credentials. An operator supplies their own encryption key and optional provider connections. Email/password hosting does not require a GitHub App; repository/MCP access and GitHub sign-in require an operator-configured GitHub App.

```sh
bun install --frozen-lockfile
bun run dev
```

See `deploy/README.md` for production deployment. The example domains identify the official project and must be replaced for your installation. Keep generated `.env` files, operational databases, backups and customer content outside version control.

The public `.arch/` describes the application's implemented modules and contains references to actual repository files. It does not include private workspaces, internal research, design prompts or the original development history. Source mappings are not configured initially; evidence checks have partial coverage and do not establish semantic equivalence between all code and diagrams.

The original software can be reused under its license. Accounts, payment status and permissions for the official service are verified on its servers. Changing a client or self-hosted installation does not change the official service's records.

## Deployment policy and capacity

The remote entrypoint defaults to `JOINLET_DEPLOYMENT_MODE=self-hosted`. Set `JOINLET_DEPLOYMENT_MODE=cloud` only in the trusted environment of a managed deployment to enable the current Free Beta quotas. Clients, headers and workspace files cannot choose the server's policy. The legacy `JOINLET_LOCAL_ADMIN` flag is not required for self-hosted use and does not configure a remote server.

No commercial quota does not mean infinite capacity or additional permissions. Authentication, invitation roles/revocation, account isolation, CSRF, provider protections, request/file size caps and other technical limits remain enforced. Hosted storage currently retains its 25 MB per-workspace safety cap for non-administrator accounts, and the hosted personal-workspace UI/database still supports one persistent workspace per owner. Multiple repository workspaces and local projects are separate from that hosted personal-workspace constraint. Run one process/replica per workspace until shared coordination is implemented.

## Sustainability and contribution rights

Joinlet Cloud sells managed operation: hosting, storage, maintenance, backups and support as actually offered. The source license permits commercial reuse, including competing hosting, subject to its conditions. The Joinlet name and identity are governed separately by [the brand policy](../TRADEMARKS.md).

Contributions to the original product use AGPL-3.0-only. Contributors retain their copyright; no assignment or blanket permission for proprietary relicensing is requested. Already granted rights are not revoked by later hiding the repository or changing a future release's license. Review contributor rights and license compatibility before introducing any different licensing model.

Operational procedures and commercial records may remain private. Credentials and customer data stay outside Git. A separate private repository does not itself exempt product modifications from applicable license obligations. See [SOURCE.md](../SOURCE.md) for corresponding source and [the release process](releases.md) for promotion to an official installation.
