import { RESERVED_NAME, emptyModel, normalizeEdgeIds, own } from '@strukt/core';
import type { DiagramElement, DiagramModel, EdgeEl, ID, LayoutState, NodeBox } from '@strukt/core';
import { parseDsl } from '@strukt/dsl/lite';
import type { DslDiagnostic } from '@strukt/dsl/lite';
import { parseDiagramJson, printDiagramJson } from '@strukt/json';
import type { JsonDiagnostic } from '@strukt/json';
import { stableStringify } from './json';

/** What a diagram is in memory: the model plus its positions (routes are derived, never stored). */
export interface DiagramSnapshot {
  model: DiagramModel;
  layout: LayoutState;
}

export const LAYOUT_VERSION = 1;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Positions of existing elements only, in whole pixels: what the sidecar and each version (M5) store. */
export function layoutNodes(model: DiagramModel, layout: LayoutState): Record<ID, NodeBox> {
  const nodes: Record<ID, NodeBox> = {};
  for (const [id, box] of Object.entries(layout.nodes)) {
    if (!own(model.elements, id)) continue;
    nodes[id] = {
      x: Math.round(box.x),
      y: Math.round(box.y),
      ...(box.w !== undefined ? { w: Math.round(box.w) } : {}),
      ...(box.h !== undefined ? { h: Math.round(box.h) } : {}),
    };
  }
  return nodes;
}

/** `diagrams/<slug>.layout.json`: positions of existing elements only, whole pixels, sorted keys. */
export function printLayout(model: DiagramModel, layout: LayoutState): string {
  return stableStringify({ version: LAYOUT_VERSION, nodes: layoutNodes(model, layout) });
}

/** Lenient: a missing or broken sidecar means "no positions" (ELK/placeNear fill them in). */
export function parseLayout(text: string | null): Record<ID, NodeBox> {
  if (!text) return {};
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {};
  }
  return parseLayoutNodes((data as { nodes?: unknown } | null)?.nodes);
}

/** A `nodes` map read from a file (sidecar or version): anything that is not a finite box is dropped. */
export function parseLayoutNodes(raw: unknown): Record<ID, NodeBox> {
  if (!raw || typeof raw !== 'object') return {};
  const boxes = Object.entries(raw as Record<string, unknown>).flatMap(([id, value]): [ID, NodeBox][] => {
    const box = value as Partial<NodeBox> | null;
    if (id === RESERVED_NAME || !box || !finite(box.x) || !finite(box.y)) return [];
    return [[id, { x: box.x, y: box.y, ...(finite(box.w) ? { w: box.w } : {}), ...(finite(box.h) ? { h: box.h } : {}) }]];
  });
  // Object.fromEntries defines own properties: ids from the file never reach a prototype.
  return Object.fromEntries(boxes);
}

export function serializeDiagram(snapshot: DiagramSnapshot): { json: string; layout: string } {
  return { json: printDiagramJson(snapshot.model), layout: printLayout(snapshot.model, snapshot.layout) };
}

/** A DSL text → snapshot, with the sidecar's positions for the elements that exist. */
export function snapshotFromDsl(dsl: string | null, layout: string | null): { snapshot: DiagramSnapshot; diagnostics: DslDiagnostic[] } {
  const parsed = dsl ? parseDsl(dsl) : { model: emptyModel(), diagnostics: [] };
  const model = normalizeEdgeIds(withoutSpans(parsed.model));
  return { snapshot: { model, layout: { nodes: layoutFor(model, layout), edges: {} } }, diagnostics: parsed.diagnostics };
}

/**
 * Files → snapshot. Always returns a model (the reader recovers what it can); `diagnostics` tells the
 * caller whether the text had errors, so it can keep a copy before anything overwrites the file.
 */
export function deserializeDiagram(json: string | null, layout: string | null): { snapshot: DiagramSnapshot; diagnostics: JsonDiagnostic[] } {
  const parsed = json ? parseDiagramJson(json) : { model: emptyModel(), diagnostics: [] };
  const model = normalizeEdgeIds(parsed.model);
  return { snapshot: { model, layout: { nodes: layoutFor(model, layout), edges: {} } }, diagnostics: parsed.diagnostics };
}

/** The sidecar's boxes for the elements that exist in `model`. */
function layoutFor(model: DiagramModel, layout: string | null): Record<ID, NodeBox> {
  return Object.fromEntries(Object.entries(parseLayout(layout)).filter(([id]) => own(model.elements, id)));
}

function withoutSpans(model: DiagramModel): DiagramModel {
  const elements: Record<ID, DiagramElement> = {};
  for (const [id, el] of Object.entries(model.elements)) {
    const { span: _span, ...rest } = el;
    elements[id] = rest;
  }
  const edges = model.edges.map(({ span: _span, ...edge }): EdgeEl => edge);
  return { ...model, elements, edges, diagnostics: [] };
}
