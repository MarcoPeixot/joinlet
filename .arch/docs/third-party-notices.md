> Joinlet · Fonte: `THIRD_PARTY_NOTICES.md`. Projeção do arquivo do repositório. Alterações feitas aqui são preservadas para revisão; o arquivo original não é substituído.

# Third-party notices

Joinlet includes or adapts material from the following projects.

## eraserlabs/eraser-diagrams — MIT
Copyright (c) 2026 Eraser Labs, Inc.
Visual tokens (stock palette, color-mode lightness formulas, hard shadow, radii) and shape/arrow
conventions are adapted from `packages/diagrams/src/library`. The composition of the icon and group nodes
(`IconNode`, `GroupNode`) adapts the Icon/Group templates of Eraser Diagrams 0.2.0
(`packages/templates/src/templates`), with Joinlet's own registry, theme and text measuring. Full license:
https://github.com/eraserlabs/eraser-diagrams/blob/main/LICENSE — the copyright notice and permission text
are reproduced in [`docs/third-party/eraser-diagrams.md`](docs/third-party/eraser-diagrams.md).

## eraserlabs/eraser-io — MIT
The Eraser DSL reference (`skills/eraser-diagrams/references`) defines the syntax `packages/dsl` accepts;
its examples are copied verbatim as golden fixtures in `packages/dsl/src/fixtures/eraser.ts`.
https://github.com/eraserlabs/eraser-io/blob/main/LICENSE

## @eraserlabs/layout — MIT
Copyright (c) 2026 Eraser Labs, Inc. Used unmodified as the edge router (`packages/layout/src/eraserRouter.ts`).
It bundles RBush (MIT) and Quickselect (ISC); see the package's own THIRD_PARTY_NOTICES.md.
https://github.com/eraserlabs/eraser-diagrams/tree/main/packages/layout

## elkjs — EPL-2.0 (dual-licensed: EPL-2.0 OR GPL-3.0-or-later)
Eclipse Layout Kernel compiled to JavaScript (Kiel University and contributors), used unmodified as a
dependency for auto-layout (`packages/layout/src/elk.ts`), under the EPL-2.0 option. Source:
https://github.com/kieler/elkjs — license: https://www.eclipse.org/legal/epl-2.0/

## Excalidraw — MIT
Copyright (c) 2020 Excalidraw. `@excalidraw/excalidraw` is used unmodified as the sketch editor
(`apps/web/src/sketch/`), loaded on demand; it bundles its own dependencies (see the package).
https://github.com/excalidraw/excalidraw/blob/master/LICENSE

## Lacuna (Editor-markdown) — same author
The Quadro (`apps/web/src/board/`: cards, sections, connection port, post-it palette) re-implements the UX
of Lacuna's board on React Flow; Lacuna and Joinlet have the same sole author, who relicenses it here.

## Fonts — SIL Open Font License 1.1
Geist and Geist Mono (Vercel), Shantell Sans (Stephen Nixon / Shantell Martin), distributed via Fontsource.

## Radix UI — MIT
Copyright (c) 2022 WorkOS. `radix-ui` is used unmodified for the dialog, popover, dropdown menu and tooltip
primitives (`apps/web/src/ui/`). https://github.com/radix-ui/primitives/blob/main/LICENSE

## Motion — MIT
Copyright (c) 2018 Framer B.V. `motion` is used unmodified for the app's animations (`apps/web/src/ui/motion.ts`).
https://github.com/motiondivision/motion/blob/main/LICENSE.md

## Icons
- Lucide — ISC License, https://lucide.dev/license. The icon picker's `apps/web/src/diagram/icons/lucide-categories.json`
  lists Lucide's icon names (read from the installed package by `apps/web/scripts/build-lucide-categories.ts`);
  the categories come from Joinlet's own heuristic, not from Lucide.
- Simple Icons — CC0 1.0; brand names and logos remain trademarks of their owners (see the package's
  `DISCLAIMER.md`). The picker's `apps/web/src/diagram/icons/brand-categories.json` groups some of its slugs into categories.
- `apps/web/src/diagram/icons/simple-subset.json` is a copy of the Simple Icons data (title, hex, SVG path) for the brands the
  app itself references, and `apps/web/src/diagram/icons/simple-index.json` lists every brand's slug and title for the
  picker; both are generated from the installed `simple-icons` package (CC0-1.0) by `apps/web/scripts/build-icon-subset.ts`.
- SVG Logos (Gil Barbara) via @iconify-json/logos — CC0 1.0 (the package's `info.json` and
  https://github.com/gilbarbara/logos); brand names and logos remain trademarks of their owners. The subset the app
  uses is copied into `apps/web/src/diagram/icons/logos-subset.json` by `apps/web/scripts/build-logos-subset.ts`.
  These are community-drawn logos, not the providers' official architecture icons (next item).
- **Official cloud architecture icons (AWS, Microsoft Azure/Entra, Google Cloud) — NOT CC0, not MIT.** 1,712 icons (AWS 821,
  Azure/Entra 640, Google Cloud 251; about 4.3 MB of SVG in `apps/web/src/diagram/icons/cloud/` plus the names and
  metadata in `packages/core/src/cloudIcons.json`) derived from the official packages the providers publish for
  architecture diagrams and documentation. They are the providers' brand assets under each provider's own terms of
  use; Joinlet does not relicense them. In short: they may be used to depict the providers' services in architecture
  diagrams and technical documentation; keep their shape, proportions and colors, use the product name next to the icon
  (Microsoft), do not use them to represent another product or in marketing material (Microsoft Entra) and do not
  suggest affiliation or endorsement. Names, marks and rights remain with Amazon Web Services, Microsoft and Google.
  Sources, package versions, SHA-256 of each package, terms links and the regeneration command are in
  [`docs/third-party/cloud-icons.md`](docs/third-party/cloud-icons.md); anyone redistributing Joinlet (or exported
  diagrams that carry these icons) must follow those terms, which prevail over this summary.

## Libraries
@xyflow/react (MIT), React (MIT), Zustand (MIT), Tailwind CSS (MIT), CodeMirror 6 and Lezer (MIT),
fast-check (MIT, tests only), marked (MIT), DOMPurify (dual MPL-2.0 or Apache-2.0; used under Apache-2.0),
Hono (MIT), Anthropic TypeScript SDK `@anthropic-ai/sdk` (MIT), Ajv (MIT), fflate (MIT), Yjs `yjs` (MIT, real-time collaboration),
`@modelcontextprotocol/sdk` (MIT, the MCP server in `apps/mcp` and the remote MCP in `apps/remote`), zod (MIT, schema validation for the MCP tools),
Express `express` (MIT, HTTP/MCP transport of `apps/remote`), `ws` (MIT, WebSocket transport of `apps/remote`).

Development and test tooling (not shipped in the app): Vite, Vitest (MIT), TypeScript, Playwright `@playwright/test` (Apache-2.0),
axe-core (MPL-2.0, accessibility checks in the e2e suite; used unmodified).

## yaml — ISC
Copyright (c) Eemeli Aro. Used unmodified by `packages/dsl` to parse OpenAPI and Kubernetes YAML on import
(alias count capped, no custom tags). https://github.com/eemeli/yaml/blob/main/LICENSE

## ignore — MIT

Copyright (c) 2013 Kael Zhang and contributors. Used unmodified to honor `.gitignore` rules for folders without Git. Source: https://github.com/kaelzhang/node-ignore. The copyright and permission notice is reproduced in [docs/third-party/ignore.md](docs/third-party/ignore.md).
