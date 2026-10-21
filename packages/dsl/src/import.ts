import { applyOps, emptyModel } from '@strukt/core';
import type { DiagramOp, Shape } from '@strukt/core';
import { importD2 } from './import/d2';
import { tooBigResult } from './import/common';
import type { ImportDiagnostic, ImportResult } from './import/common';
import { importKubernetes } from './import/k8s';
import { importOpenApi } from './import/openapi';
import { importTerraform } from './import/terraform';
import type { ImportFormat } from './detect';

export { detectImportFormat } from './detect';
export * from './import/cloud';
export type { ImportFormat } from './detect';
export type { ImportDiagnostic, ImportResult };

/** Formats whose importer lives in its own module; the first three share `importArchitecture`'s line parser. */
const IMPORTERS: Partial<Record<ImportFormat, (text: string) => ImportResult>> = {
  d2: importD2, terraform: importTerraform, openapi: importOpenApi, kubernetes: importKubernetes,
};

function mermaidNode(raw: string): { id: string; label?: string; shape?: Shape } | null {
  const text = raw.trim();
  const match = /^([A-Za-z_][A-Za-z0-9_.-]*)(?:\[(.*?)\]|\((.*?)\)|\{(.*?)\})?$/.exec(text);
  if (!match) return null;
  const label = match[2] ?? match[3] ?? match[4];
  return { id: match[1]!, ...(label ? { label: label.replace(/^['"]|['"]$/g, '') } : {}), ...(match[4] ? { shape: 'diamond' as const } : match[3] ? { shape: 'ellipse' as const } : {}) };
}

const MERMAID_ARROW = /-->|---|-\.->|==>/g;

/**
 * `A -->|label| B`: the left side is everything before the first arrow (at least one character). Found with a global scan
 * instead of `^(.+?)\s*(arrow)…`, whose lazy prefix plus `\s*` is quadratic on a long run of spaces.
 */
function mermaidEdge(line: string): { from: string; arrow: string; label?: string; to: string } | null {
  MERMAID_ARROW.lastIndex = 1;
  const arrow = MERMAID_ARROW.exec(line);
  if (!arrow) return null;
  const rest = /^\s*(?:\|([^|]+)\|\s*)?(.+)$/.exec(line.slice(arrow.index + arrow[0].length));
  if (!rest) return null;
  return { from: line.slice(0, arrow.index).trimEnd(), arrow: arrow[0], to: rest[2]!, ...(rest[1] ? { label: rest[1] } : {}) };
}

export function importArchitecture(text: string, format: ImportFormat): ImportResult {
  const importer = IMPORTERS[format];
  if (importer) return importer(text);
  const big = tooBigResult(text);
  if (big) return big;
  const diagnostics: ImportDiagnostic[] = [];
  const nodes = new Map<string, { id: string; label?: string; shape?: Shape; parentId?: string; group?: boolean }>();
  const edges: { from: string; to: string; connector: '>' | '-' | '-->'; label?: string; line: number }[] = [];
  const lines = text.split(/\r?\n/);
  // `group` is the nearest enclosing group id, precomputed on push so `parent()` is O(1) at any nesting depth.
  const scope: { kind: 'group' | 'model' | 'other'; group?: string }[] = [];
  let models = 0;
  const pop = () => { if (scope.pop()?.kind === 'model') models -= 1; };
  const push = (kind: 'group' | 'model' | 'other', id?: string) => {
    if (kind === 'model') models += 1;
    const group = kind === 'group' ? id : scope.at(-1)?.group;
    scope.push({ kind, ...(group ? { group } : {}) });
  };
  const parent = () => scope.at(-1)?.group;
  const addNode = (node: { id: string; label?: string; shape?: Shape }, group = false) => {
    const existing = nodes.get(node.id);
    if (existing) { if (node.label && !existing.label) existing.label = node.label; return; }
    nodes.set(node.id, { ...node, ...(parent() ? { parentId: parent() } : {}), ...(group ? { group: true } : {}) });
  };
  for (const [index, original] of lines.entries()) {
    const line = original.trim();
    if (!line || line.startsWith('//') || line.startsWith('%%') || line.startsWith('#')) continue;
    if (format === 'mermaid') {
      if (/^(flowchart|graph)\b/.test(line)) continue;
      if (line === 'end') { pop(); continue; }
      const subgraph = /^subgraph\s+(.+)$/.exec(line);
      if (subgraph) {
        const node = mermaidNode(subgraph[1]!);
        if (node) { addNode(node, true); push('group', node.id); }
        else diagnostics.push({ line: index + 1, message: 'Subgraph não reconhecido.' });
        continue;
      }
      const edge = mermaidEdge(line);
      if (edge) {
        const from = mermaidNode(edge.from);
        const to = mermaidNode(edge.to);
        if (from && to) {
          addNode(from); addNode(to);
          edges.push({ from: from.id, to: to.id, connector: edge.arrow === '---' ? '-' : edge.arrow === '-.->' ? '-->' : '>', ...(edge.label ? { label: edge.label.trim().replace(/^['"]|['"]$/g, '') } : {}), line: index + 1 });
        } else diagnostics.push({ line: index + 1, message: 'Conexão não reconhecida.' });
        continue;
      }
      const node = mermaidNode(line);
      if (node) addNode(node);
      else diagnostics.push({ line: index + 1, message: 'Construção Mermaid ignorada.' });
      continue;
    }

    if (line === '}' || line === '};') { pop(); continue; }
    if (/^model\s*\{/.test(line)) { push('model'); continue; }
    const inModel = models > 0;
    if (!inModel) { if (line.endsWith('{')) push('other'); continue; }
    const relation = /^([\w.]+)\s*->\s*([\w.]+)(?:\s+["']([^"']+)["'])?/.exec(line);
    if (relation) {
      edges.push({ from: relation[1]!.split('.').at(-1)!, to: relation[2]!.split('.').at(-1)!, connector: '>', ...(relation[3] ? { label: relation[3] } : {}), line: index + 1 });
      continue;
    }
    const declaration = format === 'likec4'
      ? /^([\w.]+)\s*=\s*([\w]+)(?:\s+["']([^"']+)["'])?(?:\s*\{)?/.exec(line)
      : /^([\w.]+)\s*=\s*(person|softwareSystem|container|component)(?:\s+["']([^"']+)["'])?(?:\s*\{)?/.exec(line);
    const short = format === 'likec4' ? /^(actor|system|component|service|app)\s+([\w.]+)/.exec(line) : null;
    if (declaration || short) {
      const id = (declaration?.[1] ?? short?.[2])!.split('.').at(-1)!;
      const label = declaration?.[3];
      const group = line.endsWith('{');
      addNode({ id, ...(label ? { label } : {}) }, group);
      if (group) push('group', id);
      continue;
    }
    if (line.endsWith('{')) { push('other'); continue; }
    diagnostics.push({ line: index + 1, message: 'Construção não suportada ignorada.' });
  }
  const ops: DiagramOp[] = [];
  for (const node of nodes.values()) ops.push(node.group ? { op: 'add_group', id: node.id, label: node.label, parentId: node.parentId } : { op: 'add_node', id: node.id, label: node.label, parentId: node.parentId, shape: node.shape });
  for (const { line, ...edge } of edges) {
    if (nodes.has(edge.from) && nodes.has(edge.to)) ops.push({ op: 'connect', ...edge });
    else diagnostics.push({ line, message: `Conexão ignorada: ${edge.from} → ${edge.to} referencia um componente ausente.` });
  }
  const applied = applyOps(emptyModel(), ops);
  if (!applied.ok) diagnostics.push({ line: 1, message: applied.error.message });
  return { model: applied.ok ? applied.model : emptyModel(), diagnostics };
}
