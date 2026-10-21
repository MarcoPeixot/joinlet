import { DEFAULT_STYLE, own, validParents } from '@strukt/core';
import type { DiagramModel, DiagramStyle, EdgeEl, ID } from '@strukt/core';

export const DIAGRAM_JSON_VERSION = 1;
export const SCHEMA_REF = './strukt.schema.json';

/** A node (or group), with the fixed key order and no defaults: absent property = default. */
function elementJson(model: DiagramModel, id: ID, childrenOf: ReadonlyMap<ID | undefined, ID[]>): Record<string, unknown> {
  const el = own(model.elements, id)!;
  const out: Record<string, unknown> = { id: el.id };
  if (el.kind === 'group') { out.type = 'group'; if (el.canvasFrame !== undefined) out.canvasFrame = el.canvasFrame; }
  if (el.label !== undefined) out.label = el.label;
  if (el.kind === 'node' && el.shape !== undefined) out.shape = el.shape;
  if (el.fields !== undefined) out.fields = el.fields;
  if (el.presentation !== undefined) out.presentation = el.presentation;
  if (el.layoutRole !== undefined) out.layoutRole = el.layoutRole;
  if (el.icon !== undefined) out.icon = el.icon;
  if (el.color !== undefined) out.color = el.color;
  if (el.tech !== undefined) out.tech = el.tech;
  if (el.description !== undefined) out.description = el.description;
  if (el.link !== undefined) out.link = el.link;
  if (el.colorMode !== undefined) out.colorMode = el.colorMode;
  if (el.styleMode !== undefined) out.styleMode = el.styleMode;
  if (el.typeface !== undefined) out.typeface = el.typeface;
  if (el.kind === 'group') {
    const children = childrenOf.get(id) ?? [];
    if (children.length) out.children = children.map((child) => elementJson(model, child, childrenOf));
  }
  return out;
}

/**
 * `parent -> children` in declaration order, the same as `childrenByParent` for a model from `applyOps`. A merged
 * collaborative model can have an order entry without element, an element missing from the order (appended by id),
 * a parent that is gone or not a group, or a parent cycle: `validParents` puts those elements at the top level, so
 * every element is printed exactly once and the recursion ends.
 */
function printedChildren(model: DiagramModel): Map<ID | undefined, ID[]> {
  const listed = new Set(model.order.filter((id) => own(model.elements, id)));
  const missing = Object.keys(model.elements).filter((id) => !listed.has(id)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const parents = validParents(model);
  const childrenOf = new Map<ID | undefined, ID[]>();
  for (const id of [...listed, ...missing]) {
    const parent = parents.get(id);
    const list = childrenOf.get(parent);
    if (list) list.push(id);
    else childrenOf.set(parent, [id]);
  }
  return childrenOf;
}

function edgeJson(edge: EdgeEl): Record<string, unknown> {
  const out: Record<string, unknown> = { from: edge.from, to: edge.to };
  if (edge.connector !== '>') out.type = edge.connector;
  if (edge.label !== undefined) out.label = edge.label;
  if (edge.color !== undefined) out.color = edge.color;
  if (edge.fromPort !== undefined) out.fromPort = edge.fromPort;
  if (edge.toPort !== undefined) out.toPort = edge.toPort;
  if (edge.fromCardinality !== undefined) out.fromCardinality = edge.fromCardinality;
  if (edge.toCardinality !== undefined) out.toCardinality = edge.toCardinality;
  return out;
}

function styleJson(style: DiagramStyle): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  if (style.direction !== DEFAULT_STYLE.direction) out.direction = style.direction;
  if (style.colorMode !== DEFAULT_STYLE.colorMode) out.colorMode = style.colorMode;
  if (style.styleMode !== DEFAULT_STYLE.styleMode) out.styleMode = style.styleMode;
  if (style.typeface !== DEFAULT_STYLE.typeface) out.typeface = style.typeface;
  return Object.keys(out).length ? out : undefined;
}

/** Canonical, byte-stable: fixed key order, no defaults, no nulls, 2 spaces, trailing newline. */
export function printDiagramJson(model: DiagramModel): string {
  const doc: Record<string, unknown> = { $schema: SCHEMA_REF, version: DIAGRAM_JSON_VERSION };
  const style = styleJson(model.style);
  if (style) doc.style = style;
  const childrenOf = printedChildren(model);
  doc.nodes = (childrenOf.get(undefined) ?? []).map((id) => elementJson(model, id, childrenOf));
  doc.connections = model.edges.map(edgeJson);
  return `${JSON.stringify(doc, null, 2)}\n`;
}
