import { getLocale } from '../i18n';
import { applyOps, compareModels, emptyModel } from '@strukt/core';
import type { DiagramModel, DiagramOp, ID, ModelChanges, NodeBox } from '@strukt/core';
import { printDiagramJson } from '@strukt/json';
import { architectureMarkdown, newWorkspace } from '@strukt/workspace';

/** Which step of the proposal the visitor is in; every section of the page reads the same one. */
export type Stage = 'idle' | 'proposed' | 'applied';

export const SLUG = 'pedidos';
export const PROMPT = 'Adicione um serviço de Notificações que consome os eventos do Kafka.';

const BASE_OPS: DiagramOp[] = [
  { op: 'add_group', id: 'Frontend', color: 'blue', icon: 'monitor-smartphone' },
  { op: 'add_node', id: 'Web App', parentId: 'Frontend', icon: 'react' },
  { op: 'add_node', id: 'Mobile', parentId: 'Frontend', icon: 'smartphone' },
  { op: 'add_node', id: 'API Gateway', icon: 'nginx' },
  { op: 'add_group', id: 'Serviços', color: 'purple', icon: 'layers' },
  { op: 'add_node', id: 'Pedidos', parentId: 'Serviços', icon: 'nodejs', tech: 'Node.js' },
  { op: 'add_node', id: 'Pagamentos', parentId: 'Serviços', icon: 'server', tech: 'Go' },
  { op: 'add_group', id: 'Dados', color: 'green', icon: 'database' },
  { op: 'add_node', id: 'PostgreSQL', parentId: 'Dados', icon: 'postgres' },
  { op: 'add_node', id: 'Redis', parentId: 'Dados', icon: 'redis' },
  { op: 'add_node', id: 'Kafka', icon: 'kafka' },
  { op: 'connect', from: 'Web App', to: 'API Gateway', label: 'HTTPS' },
  { op: 'connect', from: 'Mobile', to: 'API Gateway', label: 'HTTPS' },
  { op: 'connect', from: 'API Gateway', to: 'Pedidos' },
  { op: 'connect', from: 'Pedidos', to: 'PostgreSQL', label: 'SQL' },
  { op: 'connect', from: 'Pedidos', to: 'Redis', label: 'cache' },
  { op: 'connect', from: 'Pedidos', to: 'Kafka', connector: '-->', label: 'eventos' },
  { op: 'connect', from: 'Kafka', to: 'Pagamentos', connector: '-->' },
];

const PROPOSAL_OPS: DiagramOp[] = [
  { op: 'add_node', id: 'Notificações', icon: 'bell' },
  { op: 'connect', from: 'Kafka', to: 'Notificações', connector: '-->', label: 'eventos' },
];

function build(model: DiagramModel, ops: DiagramOp[]): DiagramModel {
  const result = applyOps(model, ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

export const baseModel = build(emptyModel(), BASE_OPS);
export const proposedModel = build(baseModel, PROPOSAL_OPS);
export const changes: ModelChanges = compareModels(baseModel, proposedModel);

/** Node top-left corners in the wide layout (the same coordinates the canvas draws), as the editor would write them. */
export const POSITIONS: Record<ID, NodeBox> = {
  'Web App': { x: 86, y: 112 },
  Mobile: { x: 86, y: 242 },
  'API Gateway': { x: 322, y: 177 },
  Pedidos: { x: 562, y: 112 },
  Pagamentos: { x: 562, y: 242 },
  Redis: { x: 860, y: 112 },
  PostgreSQL: { x: 860, y: 242 },
  Kafka: { x: 562, y: 412 },
  Notificações: { x: 860, y: 412 },
};

export const modelFor = (stage: Stage) => (stage === 'applied' ? proposedModel : baseModel);

export const jsonLines = (model: DiagramModel) => printDiagramJson(model).trimEnd().split('\n');

export function layoutLines(model: DiagramModel): string[] {
  const nodes: Record<ID, NodeBox> = {};
  for (const id of Object.keys(POSITIONS).sort()) if (Object.hasOwn(model.elements, id)) nodes[id] = POSITIONS[id]!;
  return JSON.stringify({ version: 1, nodes }, null, 2).split('\n').map((line) => line.replace(/\{\n\s+"x": (\d+),\n\s+"y": (\d+)\n\s+\}/g, '{ "x": $1, "y": $2 }'));
}

export type DiffRow = { kind: 'same' | 'add' | 'del'; text: string; line: number };

/** Line diff (LCS) of two small files, trimmed to `context` unchanged lines around each change, hunks separated by a `gap` row. */
export function diffRows(before: string[], after: string[], context = 2): (DiffRow | { kind: 'gap'; text: string })[] {
  const n = before.length;
  const m = after.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = before[i] === after[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && before[i] === after[j]) rows.push({ kind: 'same', text: before[i++]!, line: ++j });
    else if (j < m && (i === n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) rows.push({ kind: 'add', text: after[j]!, line: ++j });
    else rows.push({ kind: 'del', text: before[i++]!, line: j });
  }
  const keep = rows.map((row, index) => row.kind !== 'same' || rows.slice(Math.max(0, index - context), index + context + 1).some((near) => near.kind !== 'same'));
  const out: (DiffRow | { kind: 'gap'; text: string })[] = [];
  rows.forEach((row, index) => {
    if (keep[index]) out.push(row);
    else if (out.length && out[out.length - 1]!.kind !== 'gap') out.push({ kind: 'gap', text: `@@ linha ${row.line} @@` });
  });
  while (out.length && out[out.length - 1]!.kind === 'gap') out.pop();
  return out;
}

/** Lines of `lines` (JSON text) that belong to element `id`: its object, or the connection `from → to`. */
export function blockOf(lines: string[], id: ID): [number, number] | null {
  const at = lines.findIndex((line) => line.trim().replace(/,$/, '') === `"id": ${JSON.stringify(id)}`);
  if (at < 0) return null;
  let start = at;
  while (start > 0 && lines[start]!.trim() !== '{') start--;
  const indent = lines[start]!.length - lines[start]!.trimStart().length;
  let end = at;
  while (end < lines.length - 1 && !(lines[end]!.startsWith(' '.repeat(indent) + '}') && lines[end]!.length - lines[end]!.trimStart().length === indent)) end++;
  // A group's block includes its children; the highlight stops at the header fields so the node itself stays readable.
  const children = lines.findIndex((line, index) => index > at && index <= end && line.trim() === '"children": [');
  return [start, children > 0 ? children : end];
}

export function connectionBlock(lines: string[], from: ID, to: ID): [number, number] | null {
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i]!.trim() !== `"from": ${JSON.stringify(from)},` || lines[i + 1]!.trim() !== `"to": ${JSON.stringify(to)}` && lines[i + 1]!.trim() !== `"to": ${JSON.stringify(to)},`) continue;
    let end = i + 1;
    while (end < lines.length && !lines[end]!.trim().startsWith('}')) end++;
    return [i - 1, end];
  }
  return null;
}

/** The real context generator, run on the example; the JSON block is folded because the page shows the tables an agent reads next. */
export function architectureExcerpt(model: DiagramModel): { head: string[]; folded: number; tables: string[] } {
  const data = newWorkspace('Loja', { title: 'Pedidos', snapshot: { model, layout: { nodes: { ...POSITIONS }, edges: {} } } });
  const lines = architectureMarkdown(data).split('\n');
  const open = lines.indexOf('```json');
  const close = lines.indexOf('```', open + 1);
  const tablesAt = lines.indexOf('### Componentes');
  const docs = lines.indexOf('## Documentos');
  return { head: lines.slice(0, 3), folded: close - open - 1, tables: lines.slice(tablesAt, docs < 0 ? undefined : docs).filter((line, index, all) => !(line === '' && all[index - 1] === '')) };
}

export const BRANCH = 'joinlet/add-notifications';

export const AGENTS_MD = getLocale() === 'en' ? '## Joinlet\n\nThe architecture of this project lives in `.arch/`. Before changing the architecture, consult the Joinlet MCP tools `get_architecture` and `list_diagrams`. Use `create_diagram` or `apply_ops` for diagrams and `write_doc` for documents. Keep diagrams and documents up to date with code changes.' : `## Joinlet

A arquitetura deste projeto fica em \`.arch/\`. Antes de alterar a arquitetura, consulte as ferramentas MCP \`get_architecture\` e \`list_diagrams\` do Joinlet. Use \`create_diagram\` ou \`apply_ops\` para diagramas e \`write_doc\` para documentos. Mantenha diagramas e documentos atualizados junto das mudanças no código.`;
