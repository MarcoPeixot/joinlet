import { DEFAULT_STYLE } from '@strukt/core';
import type { DiagramModel, EdgeEl, ID, UpdatableProps } from '@strukt/core';
import { ELEMENT_KEYS, STYLE_KEYWORDS } from './parse';

const RESERVED = /[[\]{}<>,:"\n\r]/;
const HYPHEN_BREAK = /^-|-$|\s-|-\s|--|->/;
const KEYWORD_START = new RegExp(`^(${STYLE_KEYWORDS.join('|')})(\\s|$)`);
const BARE_VALUE = /^[A-Za-z0-9_.-]+$/;

export function quote(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/** True when the scanner reads `name` back unchanged without quotes. */
export function isBareName(name: string): boolean {
  return (
    name.length > 0 &&
    name === name.trim() &&
    !RESERVED.test(name) &&
    !name.includes('//') &&
    !HYPHEN_BREAK.test(name) &&
    !KEYWORD_START.test(name)
  );
}

const formatName = (name: string) => (isBareName(name) ? name : quote(name));
/** Values are quoted unless trivially safe, which also keeps the output valid for Eraser (hex colors, links, spaces). */
const formatValue = (value: string) => (BARE_VALUE.test(value) ? value : quote(value));
const formatLabel = (label: string) =>
  label === label.trim() && !/["[\]{}\n\r]/.test(label) && !label.includes('//') ? label : quote(label);

function formatProps(el: UpdatableProps): string {
  const parts = ELEMENT_KEYS.flatMap((key) => {
    // '' means absent: applyOps and the parser never store empty props, so there is nothing to print.
    const value = el[key];
    return value ? [`${key}: ${formatValue(typeof value === 'string' ? value : JSON.stringify(value))}`] : [];
  });
  return parts.length ? ` [${parts.join(', ')}]` : '';
}

function formatEdge(edge: EdgeEl): string {
  let line = `${formatName(edge.from)} ${edge.connector} ${formatName(edge.to)}`;
  if (edge.label || edge.color || edge.fromPort || edge.toPort || edge.fromCardinality || edge.toCardinality) line += ':';
  if (edge.label) line += ` ${formatLabel(edge.label)}`;
  const props = (['color', 'fromPort', 'toPort', 'fromCardinality', 'toCardinality'] as const).flatMap(key => edge[key] ? [`${key}: ${formatValue(edge[key]!)}`] : []);
  if (props.length) line += ` [${props.join(', ')}]`;
  return line;
}

/**
 * Canonical text: non-default style statements, then elements nested by parent in `order`,
 * then one connection per line. Deterministic, so `printDsl(parseDsl(printDsl(m)).model) === printDsl(m)`.
 */
export function printDsl(model: DiagramModel): string {
  const header = STYLE_KEYWORDS.filter((key) => model.style[key] !== DEFAULT_STYLE[key]).map((key) => `${key} ${model.style[key]}`);
  const children = new Map<ID | undefined, ID[]>();
  for (const id of model.order) {
    const el = model.elements[id];
    if (!el) continue;
    children.set(el.parentId, [...(children.get(el.parentId) ?? []), id]);
  }
  const body: string[] = [];
  const emit = (id: ID, depth: number) => {
    const el = model.elements[id]!;
    const indent = '  '.repeat(depth);
    const head = `${indent}${formatName(id)}${formatProps(el)}`;
    const kids = children.get(id) ?? [];
    if (el.kind === 'node') body.push(head);
    else if (!kids.length) body.push(`${head} {}`);
    else {
      body.push(`${head} {`);
      for (const kid of kids) emit(kid, depth + 1);
      body.push(`${indent}}`);
    }
  };
  for (const id of children.get(undefined) ?? []) emit(id, 0);
  const sections = [header, body, model.edges.map(formatEdge)].filter((lines) => lines.length);
  return sections.length ? `${sections.map((lines) => lines.join('\n')).join('\n\n')}\n` : '';
}
