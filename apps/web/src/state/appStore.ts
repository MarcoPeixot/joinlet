import { useStore } from 'zustand';
import { createDiagramStore } from './diagramStore';
import type { DiagramState } from './diagramStore';

/** The diagram being edited; the workspace (workspace/boot.ts) loads the current diagram into it. */
export const diagramStore = createDiagramStore();

export function useDiagram<T>(selector: (state: DiagramState) => T): T {
  return useStore(diagramStore, selector);
}
