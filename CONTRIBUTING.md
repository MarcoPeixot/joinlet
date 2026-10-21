# Contributing to Joinlet

Joinlet welcomes bug reports, documentation improvements and code contributions. Use GitHub Issues for reproducible bugs and pull requests for changes. Never include credentials, invitation tokens, customer files or private repository content in an issue or screenshot. See [SECURITY.md](SECURITY.md) for vulnerability reports.

## Development

Use the Bun and Node versions declared in `package.json`.

```sh
bun install --frozen-lockfile
bun run dev
```

The editor can use browser storage without a Joinlet Cloud account. Configure optional integrations with your own credentials; copy only the relevant `.env.example`, and never commit the resulting environment file.

## Changes

Read `AGENTS.md` and the product architecture in `.arch/`. Keep compatibility for existing `@strukt/*` identifiers, `.strukt.json` files and `STRUKT_*` settings. User-facing naming is Joinlet.

Keep pull requests focused. Describe the affected behavior and the validation performed. Add regression tests for meaningful behavior changes. Changes to architecture should update diagrams and authored documents through Joinlet's MCP tools, then regenerate the context through the CLI.

```sh
bun run typecheck
bun run build
bun run test
bun apps/cli/src/main.ts sync
bun apps/cli/src/main.ts context
bun run verify:knowledge
python3 -m unittest discover -s scripts -p test_publication.py
python3 scripts/check-publication.py
```

Source synchronization covers configured import formats and anchored evidence; it does not prove arbitrary code semantics. This repository's initial public architecture uses source evidence rather than configured import mappings.

## Licensing and attribution

Contributions to original Joinlet code are submitted under AGPL-3.0-only. Submit only work you have the right to contribute. Keep upstream notices and identify adapted/copied material. Third-party assets retain the terms documented in `THIRD_PARTY_NOTICES.md`; brand usage is described in `TRADEMARKS.md`. Do not submit an extra license agreement or assignment on another contributor's behalf.

## Release boundaries

Only the application and generic self-hosting examples belong here. Production credentials, customer data, internal commercial materials and operator-specific infrastructure belong outside this public repository. Changes to publication checks, secret-scanning exceptions and workflows need maintainer review. Do not use `pull_request_target` to execute untrusted contributor code or expose deployment secrets to pull requests.
