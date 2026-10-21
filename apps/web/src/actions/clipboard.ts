import { copyElements, pasteOps, topLevel } from '@strukt/core';
import type { ClipboardData } from '@strukt/core';
import { diagramStore } from '../state/appStore';

let clipboard: ClipboardData | null = null;
let pasteCount = 0;

export function copySelection(): boolean {
  const { model, layout, selection } = diagramStore.getState();
  if (!selection.nodes.length) return false;
  clipboard = copyElements(model, layout, topLevel(model, selection.nodes));
  pasteCount = 0;
  return true;
}

export function pasteClipboard(): void {
  if (!clipboard) return;
  const state = diagramStore.getState();
  pasteCount++;
  const { ops, positions, ids } = pasteOps(state.model, clipboard, { x: 32 * pasteCount, y: 32 * pasteCount });
  if (state.apply(ops, positions)) state.select({ nodes: topLevel(diagramStore.getState().model, ids), edges: [] });
}

export function duplicateSelection(): void {
  if (copySelection()) pasteClipboard();
}
