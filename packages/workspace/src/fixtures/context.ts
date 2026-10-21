import { parseDsl } from '@strukt/dsl';
import { printDiagramJson } from '@strukt/json';

/** Inputs (the example diagram, a payments diagram, two docs) and golden outputs of the context generator. */
export const EXAMPLE_DSL = `Frontend [icon: monitor-smartphone, color: blue] {
  Web App [icon: react]
  Mobile [icon: smartphone]
}
API Gateway [icon: nginx]
Serviços [icon: layers, color: purple] {
  Pedidos [icon: nodejs, link: "doc:api-de-pedidos", tech: Node.js]
  Pagamentos [icon: server, tech: Go]
}
Dados [icon: database, color: green] {
  PostgreSQL [icon: postgres]
  Redis [icon: redis]
}
Kafka [icon: kafka]

Web App > API Gateway: HTTPS
Mobile > API Gateway: HTTPS
API Gateway > Pedidos
API Gateway > Pagamentos
Pedidos > PostgreSQL: SQL
Pagamentos > PostgreSQL
Pedidos > Redis: cache
Pedidos --> Kafka: eventos
Kafka --> Pagamentos
`;

export const PAYMENTS_DSL = `direction down

Checkout [icon: shopping-cart, label: "Checkout web"]
Stripe [icon: stripe, description: "Cartões | Pix"]
Webhooks [shape: diamond]

Checkout > Stripe: cobrança
Stripe <> Webhooks
`;

/** The diagram JSON the generator embeds, built from the DSL inputs above. */
const jsonOf = (dsl: string) => printDiagramJson(parseDsl(dsl).model).trimEnd().split('\n');

export const API_DOC = [
  '# API de Pedidos',
  '',
  'Contrato REST dos pedidos.',
  '',
  '- `POST /pedidos` cria um pedido (idempotente por `Idempotency-Key`).',
  '- `GET /pedidos/{id}` devolve o status.',
  '',
].join('\n');

export const DECISIONS_DOC = [
  '# Decisões',
  '',
  '- Kafka para eventos entre Pedidos e Pagamentos.',
  '',
].join('\n');

export const GOLDEN_ARCHITECTURE = [
  '# Arquitetura — Loja',
  '',
  '> Gerado pelo Joinlet a partir de `.arch/`. Não edite à mão: mude os diagramas e os documentos no Joinlet e este arquivo se atualiza.',
  '',
  'Cada diagrama traz o código JSON do Joinlet, que é a fonte da verdade, seguido das tabelas de componentes e conexões e de trechos dos documentos ligados aos componentes.',
  '',
  '## Diagramas',
  '',
  '- [Visão geral](diagrams/visao-geral.md) — 11 componentes, 9 conexões',
  '- [Pagamentos](diagrams/pagamentos.md) — 3 componentes, 2 conexões',
  '',
  '## Visão geral',
  '',
  '`.arch/diagrams/visao-geral.strukt.json` · 11 componentes, 9 conexões',
  '',
  '```json',
  ...jsonOf(EXAMPLE_DSL),
  '```',
  '',
  '### Componentes',
  '',
  '| Componente | Tipo | Tecnologia | Descrição | Grupo |',
  '| --- | --- | --- | --- | --- |',
  '| `Frontend` | grupo | — | — | — |',
  '| `Web App` | nó | — | — | `Frontend` |',
  '| `Mobile` | nó | — | — | `Frontend` |',
  '| `API Gateway` | nó | — | — | — |',
  '| `Serviços` | grupo | — | — | — |',
  '| `Pedidos` | nó | Node.js | — | `Serviços` |',
  '| `Pagamentos` | nó | Go | — | `Serviços` |',
  '| `Dados` | grupo | — | — | — |',
  '| `PostgreSQL` | nó | — | — | `Dados` |',
  '| `Redis` | nó | — | — | `Dados` |',
  '| `Kafka` | nó | — | — | — |',
  '',
  '### Conexões',
  '',
  '| De | Para | Tipo | Rótulo |',
  '| --- | --- | --- | --- |',
  '| `Web App` | `API Gateway` | `>` seta | HTTPS |',
  '| `Mobile` | `API Gateway` | `>` seta | HTTPS |',
  '| `API Gateway` | `Pedidos` | `>` seta | — |',
  '| `API Gateway` | `Pagamentos` | `>` seta | — |',
  '| `Pedidos` | `PostgreSQL` | `>` seta | SQL |',
  '| `Pagamentos` | `PostgreSQL` | `>` seta | — |',
  '| `Pedidos` | `Redis` | `>` seta | cache |',
  '| `Pedidos` | `Kafka` | `-->` seta pontilhada | eventos |',
  '| `Kafka` | `Pagamentos` | `-->` seta pontilhada | — |',
  '',
  '### Documentos ligados',
  '',
  '#### API de Pedidos',
  '',
  '`.arch/docs/api-de-pedidos.md` · ligado a: `Pedidos`',
  '',
  '> # API de Pedidos',
  '>',
  '> Contrato REST dos pedidos.',
  '>',
  '> - `POST /pedidos` cria um pedido (idempotente por `Idempotency-Key`).',
  '> - `GET /pedidos/{id}` devolve o status.',
  '',
  '## Pagamentos',
  '',
  '`.arch/diagrams/pagamentos.strukt.json` · 3 componentes, 2 conexões',
  '',
  '```json',
  ...jsonOf(PAYMENTS_DSL),
  '```',
  '',
  '### Componentes',
  '',
  '| Componente | Tipo | Tecnologia | Descrição | Grupo |',
  '| --- | --- | --- | --- | --- |',
  '| Checkout web (`Checkout`) | nó | — | — | — |',
  '| `Stripe` | nó | — | Cartões \\| Pix | — |',
  '| `Webhooks` | nó | — | — | — |',
  '',
  '### Conexões',
  '',
  '| De | Para | Tipo | Rótulo |',
  '| --- | --- | --- | --- |',
  '| `Checkout` | `Stripe` | `>` seta | cobrança |',
  '| `Stripe` | `Webhooks` | `<>` seta dupla | — |',
  '',
  '## Documentos',
  '',
  '- API de Pedidos — `.arch/docs/api-de-pedidos.md`',
  '- Decisões — `.arch/docs/decisoes.md`',
  '',
].join('\n');

export const GOLDEN_LLMS = [
  '# Loja',
  '',
  '> Arquitetura do workspace “Loja” no Joinlet: 2 diagramas e 2 documentos. Comece por ARCHITECTURE.md.',
  '',
  'Os diagramas são JSON: cada item de `nodes` é um componente (com `type: "group"` e `children` para grupos) e cada item de `connections` liga `from` a `to`. As posições do desenho ficam em `.arch/diagrams/*.layout.json` e não mudam o significado. Arquivos gerados a partir de `.arch/`: não edite à mão.',
  '',
  '## Arquitetura',
  '',
  '- [ARCHITECTURE.md](ARCHITECTURE.md): todos os diagramas, com código, componentes, conexões e documentos ligados',
  '',
  '## Diagramas',
  '',
  '- [Visão geral](diagrams/visao-geral.md): 11 componentes, 9 conexões',
  '- [Pagamentos](diagrams/pagamentos.md): 3 componentes, 2 conexões',
  '',
  '## Documentos',
  '',
  '- [API de Pedidos](../docs/api-de-pedidos.md): ligado a Pedidos (Visão geral)',
  '- [Decisões](../docs/decisoes.md): documento do workspace',
  '',
  '## Optional',
  '',
  '- [visao-geral.strukt.json](../diagrams/visao-geral.strukt.json): código-fonte de “Visão geral”',
  '- [pagamentos.strukt.json](../diagrams/pagamentos.strukt.json): código-fonte de “Pagamentos”',
  '',
].join('\n');

export const GOLDEN_PAYMENTS = [
  '# Pagamentos',
  '',
  '> Parte da arquitetura de “Loja” (visão completa em [ARCHITECTURE.md](../ARCHITECTURE.md)). Gerado pelo Joinlet: não edite à mão.',
  '',
  '`.arch/diagrams/pagamentos.strukt.json` · 3 componentes, 2 conexões',
  '',
  '```json',
  ...jsonOf(PAYMENTS_DSL),
  '```',
  '',
  '## Componentes',
  '',
  '| Componente | Tipo | Tecnologia | Descrição | Grupo |',
  '| --- | --- | --- | --- | --- |',
  '| Checkout web (`Checkout`) | nó | — | — | — |',
  '| `Stripe` | nó | — | Cartões \\| Pix | — |',
  '| `Webhooks` | nó | — | — | — |',
  '',
  '## Conexões',
  '',
  '| De | Para | Tipo | Rótulo |',
  '| --- | --- | --- | --- |',
  '| `Checkout` | `Stripe` | `>` seta | cobrança |',
  '| `Stripe` | `Webhooks` | `<>` seta dupla | — |',
  '',
].join('\n');
