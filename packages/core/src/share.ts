import type { DiagramElement, DiagramModel, EdgeEl } from './model';

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const key of ka) {
    if (!Object.hasOwn(b, key)) return false;
    if (!same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}

/** Reuses `prev`'s objects wherever `next` is structurally equal, so memo and Map caches keep hitting. */
export function reuseUnchanged(prev: DiagramModel, next: DiagramModel): DiagramModel {
  const elements: Record<string, DiagramElement> = {};
  let elementsSame = Object.keys(prev.elements).length === Object.keys(next.elements).length;
  for (const [id, after] of Object.entries(next.elements)) {
    const before = Object.hasOwn(prev.elements, id) ? prev.elements[id] : undefined;
    if (before && same(before, after)) elements[id] = before;
    else {
      elements[id] = after;
      elementsSame = false;
    }
  }
  const prevEdges = new Map<string, EdgeEl>(prev.edges.map((e) => [e.id, e]));
  const edges = next.edges.map((edge) => {
    const before = prevEdges.get(edge.id);
    return before && same(before, edge) ? before : edge;
  });
  const edgesSame = edges.length === prev.edges.length && edges.every((e, i) => e === prev.edges[i]);
  const orderSame = same(prev.order, next.order);
  const styleSame = same(prev.style, next.style);
  const diagSame = same(prev.diagnostics, next.diagnostics);
  if (elementsSame && edgesSame && orderSame && styleSame && diagSame) return prev;
  return {
    ...next,
    elements: elementsSame ? prev.elements : elements,
    edges: edgesSame ? prev.edges : edges,
    order: orderSame ? prev.order : next.order,
    style: styleSame ? prev.style : next.style,
    diagnostics: diagSame ? prev.diagnostics : next.diagnostics,
  };
}
