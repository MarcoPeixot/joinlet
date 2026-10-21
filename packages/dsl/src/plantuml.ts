import type { Connector, DiagramModel, Shape } from '@strukt/core';
import { buildTree, displayLabel, resolvedEdges } from './diagramTree';
import type { TreeEntry } from './diagramTree';

const KEYWORDS: Record<Shape, string> = {
  rectangle: 'rectangle',
  cylinder: 'database',
  diamond: 'rectangle',
  document: 'file',
  ellipse: 'usecase',
  oval: 'usecase',
  circle: 'usecase',
  hexagon: 'hexagon',
  parallelogram: 'queue',
  star: 'artifact',
  trapezoid: 'storage',
  triangle: 'node',
  cloud: 'cloud',
  queue: 'queue',
  bucket: 'storage',
  actor: 'actor',
  component: 'component',
  server: 'node',
  browser: 'rectangle',
  mobile: 'rectangle',
  package: 'rectangle',
  note: 'artifact',
  process: 'rectangle',
  delay: 'usecase',
};

const ARROWS: Record<Connector, string> = { '>': '-->', '<': '<--', '<>': '<-->', '-': '--', '--': '..', '-->': '..>' };

/** Characters PlantUML would interpret (quotes, creole/HTML tags, `%fn()%`, backslash, `[[link]]`) become `<U+XXXX>` code points. */
function escapeText(text: string): string {
  return text
    .replace(/[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/[\\"<%[]/g, (char) => `<U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}>`)
    .replace(/\r\n|[\r\n\u2028\u2029]/g, '\\n');
}

function printEntry(entry: TreeEntry, depth: number, lines: string[]): void {
  const pad = '  '.repeat(depth);
  const { element } = entry;
  const label = escapeText(displayLabel(element));
  if (element.kind === 'group') {
    lines.push(`${pad}package "${label}" as ${entry.alias} {`);
    for (const child of entry.children) printEntry(child, depth + 1, lines);
    lines.push(`${pad}}`);
    return;
  }
  lines.push(`${pad}${KEYWORDS[element.shape ?? 'rectangle'] ?? 'rectangle'} "${label}" as ${entry.alias}`);
}

/** Exports the diagram as PlantUML (aliases are synthetic `n<index>`; edges to missing endpoints are skipped). */
export function printPlantUml(model: DiagramModel): string {
  const lines = ['@startuml'];
  if (model.style.direction === 'right' || model.style.direction === 'left') lines.push('left to right direction');
  const { roots, aliases } = buildTree(model);
  for (const root of roots) printEntry(root, 0, lines);
  for (const { edge, from, to } of resolvedEdges(model, aliases)) {
    lines.push(`${from} ${ARROWS[edge.connector] ?? '-->'} ${to}${edge.label ? ` : ${escapeText(edge.label)}` : ''}`);
  }
  lines.push('@enduml');
  return `${lines.join('\n')}\n`;
}
