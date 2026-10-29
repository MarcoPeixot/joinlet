import type { ID } from '@strukt/core';
import type { BoardCard } from '@strukt/workspace';
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { DiagramState, DiagramStore } from '../state/diagramStore';
import { diagramStore } from '../state/appStore';

/** What the Overview adds on top of the canvas (board/OverviewCanvas.tsx): its cards and the edits only it has. */
export interface OverviewScope {
  /** The card an element stands for (a diagram/doc/sketch or a note), or undefined for a section. */
  card(id: ID): BoardCard | undefined;
  /** A note created on the canvas takes the keyboard. */
  focusId: ID | null;
  setNote(id: ID, patch: { text?: string; color?: string }): void;
  /** Manual elbow of a connection (`bend`, a fraction of the gap), or null to route it again. */
  setBend(edgeId: ID, bend: number | null): void;
  bend(edgeId: ID): number | undefined;
  open(id: ID): void;
}

/**
 * The one canvas (canvas/DiagramCanvas.tsx) draws either the open diagram or the Overview: the same interactions,
 * each on its own store (its own model, layout and undo history). Everything inside the canvas reads the store from
 * here, never the app's diagram store directly.
 */
export interface CanvasScope {
  kind: 'diagram' | 'overview';
  store: DiagramStore;
  overview?: OverviewScope;
}

const DIAGRAM: CanvasScope = { kind: 'diagram', store: diagramStore };
const Scope = createContext<CanvasScope>(DIAGRAM);

export const CanvasScopeProvider = Scope.Provider;
export const useCanvasScope = (): CanvasScope => useContext(Scope);

/** `useDiagram` for whichever store this canvas draws. */
export function useCanvasStore<T>(selector: (state: DiagramState) => T): T {
  return useStore(useContext(Scope).store, selector);
}
