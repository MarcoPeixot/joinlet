import { useDiagram } from '../state/appStore';

/** Only with something to edit (or the AI draft's legend) does the Inspector show; otherwise the canvas stays clear. */
export function useInspectorOpen(): boolean {
  return useDiagram((s) => s.readOnly !== null || s.selection.nodes.length + s.selection.edges.length > 0);
}
