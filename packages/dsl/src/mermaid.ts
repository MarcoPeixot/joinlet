import type { Connector, DiagramModel, Direction, Shape } from '@strukt/core';
import { buildTree, displayLabel, resolvedEdges } from './diagramTree';
import type { TreeEntry } from './diagramTree';

const DIRECTIONS: Record<Direction, string> = { right: 'LR', down: 'TB', left: 'RL', up: 'BT' };

/** Bracket pairs around the quoted label, per shape. */
const SHAPE_BRACKETS: Record<Shape, [string, string]> = {
  rectangle: ['[', ']'],
  cylinder: ['[(', ')]'],
  diamond: ['{', '}'],
  document: ['[[', ']]'],
  ellipse: ['((', '))'],
  circle: ['((', '))'],
  hexagon: ['{{', '}}'],
  oval: ['([', '])'],
  parallelogram: ['[/', '/]'],
  star: ['(', ')'],
  trapezoid: ['[/', '\\]'],
  triangle: ['>', ']'],
  cloud: ['(', ')'],
  queue: ['[(', ')]'],
  bucket: ['[(', ')]'],
  actor: ['((', '))'],
  component: ['[[', ']]'],
  server: ['[', ']'],
  browser: ['[', ']'],
  mobile: ['[', ']'],
  package: ['[', ']'],
  note: ['[', ']'],
  process: ['[[', ']]'],
  delay: ['([', '])'],
};

/** `swap`: Mermaid has no reversed arrow, so `A <-- B` prints as `B --> A`. */
const ARROWS: Record<Connector, { arrow: string; swap?: true }> = {
  '>': { arrow: '-->' },
  '<': { arrow: '-->', swap: true },
  '<>': { arrow: '<-->' },
  '-': { arrow: '---' },
  '--': { arrow: '-.-' },
  '-->': { arrow: '-.->' },
};

const ENTITIES: Record<string, string> = { '"': '#quot;', '&': '#amp;', '<': '#lt;', '>': '#gt;', '#': '#35;', '`': '#96;', '%': '#37;', '|': '#124;' };

/** Text that is safe inside a double-quoted Mermaid label: no quote, markup, comment or line break survives. */
function escapeLabel(text: string): string {
  return text
    .replace(/[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/[&"<>#`%|]/g, (char) => ENTITIES[char]!)
    .replace(/\r\n|[\r\n\u2028\u2029]/g, '<br/>');
}

const quoted = (text: string) => `"${escapeLabel(text)}"`;

function printEntry(entry: TreeEntry, depth: number, lines: string[]): void {
  const pad = '  '.repeat(depth);
  const { element } = entry;
  if (element.kind === 'group') {
    lines.push(`${pad}subgraph ${entry.alias}[${quoted(displayLabel(element))}]`);
    for (const child of entry.children) printEntry(child, depth + 1, lines);
    lines.push(`${pad}end`);
    return;
  }
  const [open, close] = SHAPE_BRACKETS[element.shape ?? 'rectangle'] ?? SHAPE_BRACKETS.rectangle;
  lines.push(`${pad}${entry.alias}${open}${quoted(displayLabel(element))}${close}`);
}

/** Exports the diagram as a Mermaid flowchart (ids are synthetic `n<index>`; edges to missing endpoints are skipped). */
export function printMermaid(model: DiagramModel): string {
  const lines = [`flowchart ${DIRECTIONS[model.style.direction] ?? 'LR'}`];
  const { roots, aliases } = buildTree(model);
  for (const root of roots) printEntry(root, 1, lines);
  for (const { edge, from, to } of resolvedEdges(model, aliases)) {
    const { arrow, swap } = ARROWS[edge.connector] ?? ARROWS['>'];
    const label = edge.label ? `|${quoted(edge.label)}|` : '';
    lines.push(swap ? `  ${to} ${arrow}${label} ${from}` : `  ${from} ${arrow}${label} ${to}`);
  }
  return `${lines.join('\n')}\n`;
}
