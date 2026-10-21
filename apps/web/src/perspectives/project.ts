import { localizedPerspectives } from '../i18n/perspectives';
import { projectPerspective, resolvePerspective, sharedTagsOf } from '@strukt/workspace';
import type { Perspective, PerspectiveView, SharedModel } from '@strukt/workspace';
import type { DiagramModel, LayoutState } from '@strukt/core';
import type { FlowProjection } from '../diagram/toFlow';

/** A diagram read through one perspective: what the canvas draws and the exports write. Never the model itself. */
export interface PerspectiveRead {
  perspective: Perspective;
  view: PerspectiveView;
  model: DiagramModel;
  layout: LayoutState;
  /** `mode: 'dim'`: what the filters do not match fades, as the tag lens does. The same projection when nothing is dimmed. */
  dim(projection: FlowProjection): FlowProjection;
  /** Something is hidden: the geometry on screen is not the diagram's, so the canvas does not move or connect things. */
  readonly reading: boolean;
  /** Something is faded (`dim` has an effect). */
  readonly dims: boolean;
}

const withClass = (className: string | undefined, add: string) => (className ? `${className} ${add}` : add);

function dimmer(dimmed: ReadonlySet<string>): PerspectiveRead['dim'] {
  return (projection) => {
    if (!dimmed.size) return projection;
    return {
      ...projection,
      nodes: projection.nodes.map((node) => (dimmed.has(node.id) ? { ...node, className: withClass(node.className, 'sk-dim') } : node)),
      edges: projection.edges.map((edge) => (dimmed.has(edge.source) || dimmed.has(edge.target)
        ? { ...edge, className: withClass(edge.className, 'sk-dim'), data: edge.data ? { ...edge.data, dimmed: true } : undefined }
        : edge)),
    };
  };
}

export interface ReadInput {
  model: DiagramModel;
  layout: LayoutState;
  /** Slug of the open diagram: tags live on the shared entities its elements are linked to. */
  slug: string;
  id: string;
  saved?: readonly Perspective[];
  shared?: SharedModel;
}

const same = (a: ReadInput, b: ReadInput) => a.model === b.model && a.layout === b.layout && a.slug === b.slug && a.id === b.id && a.saved === b.saved && a.shared === b.shared;
let last: { input: ReadInput; result: PerspectiveRead | null } | null = null;

/**
 * `null` when the diagram offers no perspective with that id (deleted, or the file changed under a guest). The last
 * answer is kept: the canvas and the banner ask for the same thing in the same render.
 */
export function readThrough(input: ReadInput): PerspectiveRead | null {
  if (last && same(last.input, input)) return last.result;
  const result = compute(input);
  last = { input, result };
  return result;
}

function compute({ model, layout, slug, id, saved, shared }: ReadInput): PerspectiveRead | null {
  const perspective = localizedPerspectives(saved).find((candidate) => candidate.id === id);
  if (!perspective) return null;
  const view = resolvePerspective(model, sharedTagsOf(shared, slug), perspective);
  return { perspective, view, ...projectPerspective(model, layout, view), dim: dimmer(view.dimmed), reading: view.hidden.size > 0, dims: view.dimmed.size > 0 };
}
