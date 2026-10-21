# Open source and hosted service

The original Joinlet application code is licensed under **AGPL-3.0-only**. You can inspect, modify, contribute to and self-host the application under that license. Third-party code and assets retain their documented terms. The software license does not grant access to the official hosted infrastructure.

Joinlet Cloud is the managed installation of the product. Hosting, persistent service availability, storage, backups, updates and support can be offered commercially. The current implementation provides Beta and administrator policies; subscription billing and paid entitlements are not implemented yet. Current Beta quotas also affect local execution; no unlimited self-hosted policy is promised by this release.

This repository includes the editor, local server, remote backend, CLI, MCP, VS Code extension, shared packages and generic Docker deployment examples. Self-hosting does not require the founder's credentials. An operator creates their own GitHub application, encryption key and provider connections.

```sh
bun install --frozen-lockfile
bun run dev
```

See `deploy/README.md` for production deployment. The example domains identify the official project and must be replaced for your installation. Keep generated `.env` files, operational databases, backups and customer content outside version control.

The public `.arch/` describes the application's implemented modules and contains references to actual repository files. It does not include private workspaces, internal research, design prompts or the original development history. Source mappings are not configured initially; evidence checks have partial coverage and do not establish semantic equivalence between all code and diagrams.

The original software can be reused under its license. Accounts, payment status and permissions for the official service are verified on its servers. Changing a client or self-hosted installation does not change the official service's records.
