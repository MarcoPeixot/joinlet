import { applyOps, defaultSize, emptyModel } from '@strukt/core';
import type { DiagramModel, DiagramOp, ID, NodeBox } from '@strukt/core';
import { addItem, newWorkspace } from '@strukt/workspace';
import type { DiagramSnapshot, WorkspaceData } from '@strukt/workspace';

/**
 * Dev-only mock workspace (`/app/?mock`, `?mock=<slug>` opens that diagram): diagrams ready on the canvas
 * for UI work. It lives in memory, so nothing is saved, remembered or written to a folder.
 */

function snapshot(ops: DiagramOp[], place: (model: DiagramModel) => Record<ID, NodeBox>): DiagramSnapshot {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(`Mock inválido: ${result.error.message}`);
  return { model: result.model, layout: { nodes: place(result.model), edges: {} } };
}

/** Every element kind the canvas draws: groups (one nested), icon nodes, cards with tech, labeled and dashed edges. */
const PLATFORM_OPS: DiagramOp[] = [
  { op: 'add_node', id: 'Customer', icon: 'users' },
  { op: 'add_group', id: 'Clients', color: 'blue', icon: 'monitor-smartphone' },
  { op: 'add_node', id: 'Web App', parentId: 'Clients', icon: 'nextjs', presentation: 'card', tech: 'Next.js' },
  { op: 'add_node', id: 'Mobile App', parentId: 'Clients', icon: 'smartphone', presentation: 'card', tech: 'React Native' },
  { op: 'add_node', id: 'API Gateway', icon: 'nginx', presentation: 'card', tech: 'Nginx', layoutRole: 'entry', description: 'Single entry point: TLS, rate limiting and routing.' },
  { op: 'add_node', id: 'Auth', icon: 'auth', presentation: 'card', tech: 'Keycloak' },
  { op: 'add_group', id: 'Services', color: 'purple', icon: 'layers' },
  { op: 'add_node', id: 'Catalog', parentId: 'Services', icon: 'python', presentation: 'card', tech: 'FastAPI' },
  { op: 'add_node', id: 'Orders', parentId: 'Services', icon: 'nodejs', presentation: 'card', tech: 'Node.js', description: 'Owns the order lifecycle and publishes order events.' },
  { op: 'add_node', id: 'Payments', parentId: 'Services', icon: 'go', presentation: 'card', tech: 'Go' },
  { op: 'add_node', id: 'Notifications', parentId: 'Services', icon: 'notification', presentation: 'card', tech: 'Node.js' },
  { op: 'add_node', id: 'Event Bus', icon: 'kafka', presentation: 'card', tech: 'Apache Kafka', color: 'orange' },
  { op: 'add_group', id: 'Data', color: 'green', icon: 'database' },
  { op: 'add_node', id: 'Search', parentId: 'Data', icon: 'elasticsearch', presentation: 'card', tech: 'Elasticsearch' },
  { op: 'add_node', id: 'Orders DB', parentId: 'Data', icon: 'postgresql', presentation: 'card', tech: 'PostgreSQL 16' },
  { op: 'add_node', id: 'Cache', parentId: 'Data', icon: 'redis', presentation: 'card', tech: 'Redis' },
  { op: 'add_group', id: 'Analytics', parentId: 'Data', color: 'teal', icon: 'analytics' },
  { op: 'add_node', id: 'Warehouse', parentId: 'Analytics', icon: 'analytics', presentation: 'card', tech: 'BigQuery' },
  { op: 'add_node', id: 'Stripe', icon: 'stripe', presentation: 'card', tech: 'External', color: 'gray' },
  { op: 'add_node', id: 'Email', icon: 'email', presentation: 'card', tech: 'SendGrid', color: 'gray' },
  { op: 'connect', from: 'Customer', to: 'Web App' },
  { op: 'connect', from: 'Customer', to: 'Mobile App' },
  { op: 'connect', from: 'Web App', to: 'API Gateway', label: 'HTTPS' },
  { op: 'connect', from: 'Mobile App', to: 'API Gateway', label: 'HTTPS' },
  { op: 'connect', from: 'API Gateway', to: 'Auth', connector: '<>', label: 'OIDC' },
  { op: 'connect', from: 'API Gateway', to: 'Catalog' },
  { op: 'connect', from: 'API Gateway', to: 'Orders' },
  { op: 'connect', from: 'API Gateway', to: 'Payments' },
  { op: 'connect', from: 'Catalog', to: 'Search', label: 'query' },
  { op: 'connect', from: 'Orders', to: 'Orders DB', label: 'SQL' },
  { op: 'connect', from: 'Orders', to: 'Cache', connector: '--', label: 'cache' },
  { op: 'connect', from: 'Orders', to: 'Event Bus', connector: '-->', label: 'order.created' },
  { op: 'connect', from: 'Event Bus', to: 'Payments', connector: '-->' },
  { op: 'connect', from: 'Event Bus', to: 'Notifications', connector: '-->' },
  { op: 'connect', from: 'Event Bus', to: 'Warehouse', connector: '-->', label: 'stream' },
  { op: 'connect', from: 'Payments', to: 'Stripe', label: 'charge', color: 'red' },
  { op: 'connect', from: 'Notifications', to: 'Email', label: 'SMTP' },
];

const PLATFORM_POSITIONS: Record<ID, NodeBox> = {
  Customer: { x: 0, y: 250 },
  'Web App': { x: 180, y: 170 },
  'Mobile App': { x: 180, y: 300 },
  'API Gateway': { x: 520, y: 225 },
  Auth: { x: 520, y: 420 },
  Catalog: { x: 860, y: 40 },
  Orders: { x: 860, y: 170 },
  Payments: { x: 860, y: 300 },
  Notifications: { x: 860, y: 430 },
  'Event Bus': { x: 860, y: 640 },
  Search: { x: 1200, y: 40 },
  'Orders DB': { x: 1200, y: 170 },
  Cache: { x: 1200, y: 300 },
  Warehouse: { x: 1200, y: 474 },
  Stripe: { x: 1560, y: 300 },
  Email: { x: 1560, y: 430 },
};

/** Tables with typed fields, keys and cardinalities. */
const DATA_MODEL_OPS: DiagramOp[] = [
  { op: 'add_node', id: 'users', icon: 'table', presentation: 'table', fields: [
    { name: 'id', type: 'uuid', key: 'PK' }, { name: 'email', type: 'text' }, { name: 'name', type: 'text' }, { name: 'created_at', type: 'timestamptz' },
  ] },
  { op: 'add_node', id: 'orders', icon: 'table', presentation: 'table', fields: [
    { name: 'id', type: 'uuid', key: 'PK' }, { name: 'user_id', type: 'uuid', key: 'FK' }, { name: 'status', type: 'text' },
    { name: 'total_cents', type: 'int' }, { name: 'created_at', type: 'timestamptz' },
  ] },
  { op: 'add_node', id: 'order_items', icon: 'table', presentation: 'table', fields: [
    { name: 'id', type: 'uuid', key: 'PK' }, { name: 'order_id', type: 'uuid', key: 'FK' }, { name: 'product_id', type: 'uuid', key: 'FK' },
    { name: 'quantity', type: 'int' }, { name: 'unit_price_cents', type: 'int' },
  ] },
  { op: 'add_node', id: 'products', icon: 'table', presentation: 'table', fields: [
    { name: 'id', type: 'uuid', key: 'PK' }, { name: 'sku', type: 'text' }, { name: 'name', type: 'text' }, { name: 'price_cents', type: 'int' }, { name: 'stock', type: 'int' },
  ] },
  { op: 'add_node', id: 'payments', icon: 'table', presentation: 'table', fields: [
    { name: 'id', type: 'uuid', key: 'PK' }, { name: 'order_id', type: 'uuid', key: 'FK' }, { name: 'provider', type: 'text' },
    { name: 'status', type: 'text' }, { name: 'amount_cents', type: 'int' },
  ] },
  { op: 'connect', from: 'users', to: 'orders', connector: '-', fromCardinality: 'one', toCardinality: 'zero-many' },
  { op: 'connect', from: 'orders', to: 'order_items', connector: '-', fromCardinality: 'one', toCardinality: 'many' },
  { op: 'connect', from: 'products', to: 'order_items', connector: '-', fromCardinality: 'one', toCardinality: 'zero-many' },
  { op: 'connect', from: 'orders', to: 'payments', connector: '-', fromCardinality: 'one', toCardinality: 'zero-many' },
];

const DATA_MODEL_POSITIONS: Record<ID, NodeBox> = {
  users: { x: 0, y: 0 },
  orders: { x: 420, y: 0 },
  order_items: { x: 840, y: 0 },
  payments: { x: 420, y: 340 },
  products: { x: 840, y: 340 },
};

/** Flowchart shapes, top to bottom, with yes/no branches. */
const CHECKOUT_OPS: DiagramOp[] = [
  { op: 'set_style', set: { direction: 'down' } },
  { op: 'add_node', id: 'start', label: 'Cart submitted', shape: 'oval', color: 'green' },
  { op: 'add_node', id: 'validate', label: 'Validate cart', shape: 'rectangle' },
  { op: 'add_node', id: 'in-stock', label: 'In stock?', shape: 'diamond' },
  { op: 'add_node', id: 'out-of-stock', label: 'Notify out of stock', shape: 'rectangle', color: 'orange' },
  { op: 'add_node', id: 'reserve', label: 'Reserve inventory', shape: 'rectangle' },
  { op: 'add_node', id: 'charge', label: 'Charge card', shape: 'parallelogram' },
  { op: 'add_node', id: 'approved', label: 'Payment approved?', shape: 'diamond' },
  { op: 'add_node', id: 'release', label: 'Release reservation', shape: 'rectangle', color: 'red' },
  { op: 'add_node', id: 'confirm', label: 'Confirm order', shape: 'rectangle' },
  { op: 'add_node', id: 'receipt', label: 'Receipt', shape: 'document' },
  { op: 'add_node', id: 'done', label: 'Done', shape: 'oval', color: 'green' },
  { op: 'connect', from: 'start', to: 'validate' },
  { op: 'connect', from: 'validate', to: 'in-stock' },
  { op: 'connect', from: 'in-stock', to: 'reserve', label: 'yes' },
  { op: 'connect', from: 'in-stock', to: 'out-of-stock', label: 'no' },
  { op: 'connect', from: 'reserve', to: 'charge' },
  { op: 'connect', from: 'charge', to: 'approved' },
  { op: 'connect', from: 'approved', to: 'confirm', label: 'yes' },
  { op: 'connect', from: 'approved', to: 'release', label: 'no' },
  { op: 'connect', from: 'confirm', to: 'receipt', connector: '-->' },
  { op: 'connect', from: 'confirm', to: 'done' },
  { op: 'connect', from: 'release', to: 'done' },
  { op: 'connect', from: 'out-of-stock', to: 'done' },
];

/** Center column at x = 200 and branches at x = 520; boxes are centered with the size the canvas gives them. */
function checkoutPositions(model: DiagramModel): Record<ID, NodeBox> {
  const rows: [ID, number, number][] = [
    ['start', 200, 0], ['validate', 200, 130], ['in-stock', 200, 260], ['out-of-stock', 520, 276],
    ['reserve', 200, 420], ['charge', 200, 550], ['approved', 200, 680], ['release', 520, 696],
    ['confirm', 200, 840], ['receipt', 520, 832], ['done', 200, 990],
  ];
  return Object.fromEntries(rows.map(([id, cx, y]) => [id, { x: Math.round(cx - defaultSize(model.elements[id]!).w / 2), y }]));
}

const DOMAINS = ['Identity', 'Catalog', 'Orders', 'Payments', 'Shipping', 'Billing', 'Support', 'Insights'];
const ROLES = ['API', 'Worker', 'Scheduler', 'Webhooks', 'Indexer', 'Auditor', 'Exporter', 'Gateway'];
const ICONS = ['nodejs', 'go', 'python', 'worker', 'scheduler', 'api', 'server', 'gateway'];
const COLORS = ['blue', 'purple', 'green', 'orange', 'red', 'teal', 'pink', 'gray'];

/** 8 domains × (8 services + 1 database) and ~110 edges, to feel the canvas under load. */
function largeOps(): DiagramOp[] {
  const ops: DiagramOp[] = [];
  for (const [d, domain] of DOMAINS.entries()) {
    ops.push({ op: 'add_group', id: domain, color: COLORS[d], icon: 'layers' });
    for (const [r, role] of ROLES.entries()) ops.push({ op: 'add_node', id: `${domain} ${role}`, parentId: domain, icon: ICONS[r], presentation: 'card', tech: r % 2 ? 'Go' : 'Node.js' });
    ops.push({ op: 'add_node', id: `${domain} DB`, parentId: domain, icon: 'postgresql', presentation: 'card', tech: 'PostgreSQL' });
  }
  for (const [d, domain] of DOMAINS.entries()) {
    for (const [r, role] of ROLES.entries()) {
      if (r > 0) ops.push({ op: 'connect', from: `${domain} API`, to: `${domain} ${role}` });
      if (r % 2 === 0) ops.push({ op: 'connect', from: `${domain} ${role}`, to: `${domain} DB`, ...(r === 0 ? { label: 'SQL' } : {}) });
    }
    const next = DOMAINS[(d + 1) % DOMAINS.length]!;
    const across = DOMAINS[(d + 3) % DOMAINS.length]!;
    ops.push({ op: 'connect', from: `${domain} Gateway`, to: `${next} API`, label: 'REST' });
    ops.push({ op: 'connect', from: `${domain} Webhooks`, to: `${across} Worker`, connector: '-->', label: 'events' });
    ops.push({ op: 'connect', from: `${domain} Exporter`, to: 'Insights Indexer', connector: '-->' });
  }
  return ops;
}

function largePositions(): Record<ID, NodeBox> {
  const nodes: Record<ID, NodeBox> = {};
  for (const [d, domain] of DOMAINS.entries()) {
    const left = (d % 4) * 640;
    const top = Math.floor(d / 4) * 780;
    const ids = [...ROLES.map((role) => `${domain} ${role}`), `${domain} DB`];
    for (const [i, id] of ids.entries()) nodes[id] = { x: left + (i % 2) * 260, y: top + Math.floor(i / 2) * 130 };
  }
  return nodes;
}

const OVERVIEW_DOC = `# Mock workspace

Dados de exemplo para trabalhar na UI do diagrama. Nada aqui é salvo: recarregar a página volta ao estado inicial.

- **Commerce platform**: grupos (um aninhado), ícones, cards com tecnologia, conexões com rótulo, tracejadas e bidirecionais.
- **Data model**: tabelas com campos, chaves e cardinalidades.
- **Checkout flow**: formas de fluxograma de cima para baixo.
- **Large system**: ~70 nós e ~110 conexões para sentir o canvas sob carga.
`;

export const MOCK_DIAGRAMS: { title: string; build: () => DiagramSnapshot }[] = [
  { title: 'Commerce platform', build: () => snapshot(PLATFORM_OPS, () => ({ ...PLATFORM_POSITIONS })) },
  { title: 'Data model', build: () => snapshot(DATA_MODEL_OPS, () => ({ ...DATA_MODEL_POSITIONS })) },
  { title: 'Checkout flow', build: () => snapshot(CHECKOUT_OPS, checkoutPositions) },
  { title: 'Large system', build: () => snapshot(largeOps(), largePositions) },
];

export function mockWorkspace(): WorkspaceData {
  let data = newWorkspace('Mock');
  for (const diagram of MOCK_DIAGRAMS) data = addItem(data, 'diagram', diagram.title, diagram.build()).data;
  return addItem(data, 'doc', 'Overview', OVERVIEW_DOC).data;
}
