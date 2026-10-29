import type { Direction } from '@strukt/core';
import { useEffect } from 'react';
import { copySelectionImage } from '../actions/export';
import { copySelection, duplicateSelection, pasteClipboard } from '../actions/clipboard';
import { addNodeAt, deleteSelection, groupSelectionOrCreate, selectAll } from '../actions/elements';
import { flowchartStep } from '../actions/flowchart';
import { nudgeSelection } from '../actions/nudge';
import { docSession, toggleAi } from '../ai/session';
import { contextStore } from '../context/session';
import { settingsStore } from '../settings/store';
import { diagramStore } from '../state/appStore';
import type { DiagramStore } from '../state/diagramStore';
import { togglePresentation } from '../present/presentStore';
import { uiStore } from '../ui/uiStore';
import { openSaveVersion, versionStore } from '../versions/session';
import { catalogStore } from '../workspace/catalog';

const ARROWS: Record<string, Direction> = { arrowright: 'right', arrowleft: 'left', arrowup: 'up', arrowdown: 'down' };

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

const CONTROLS = 'button, a[href], [role="button"], [role="option"], [role="listbox"], [role="menu"], [role="dialog"]';

/**
 * A focused button, link or anything inside a listbox, menu or dialog: Enter, Space, arrows, Escape… belong to it
 * (activate the button, move in the list, close the dialog), not to the canvas. React Flow nodes and edges are
 * `role="group"` and stay handled.
 */
function isControl(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (['BUTTON', 'A', 'SUMMARY'].includes(el.tagName) || !!el.closest?.(CONTROLS));
}

/**
 * The canvas the keys act on (canvas/scope.tsx): the open diagram, or the Overview, which has its own store and
 * undo history but no AI, versions, flowchart or node keys; `remove` deletes its selection (item cards stay).
 */
export interface ShortcutCanvas {
  kind: 'diagram' | 'overview';
  store: DiagramStore;
  remove?: () => void;
}

const DIAGRAM_CANVAS: ShortcutCanvas = { kind: 'diagram', store: diagramStore };

/** The keys both canvases share: history, select all, delete, escape. Returns undefined for any other key. */
function sharedKey(event: KeyboardEvent, canvas: ShortcutCanvas, mod: boolean, key: string): boolean | undefined {
  const state = canvas.store.getState();
  if (mod && key === 'z') { if (event.shiftKey) state.redo(); else state.undo(); return true; }
  if (mod && key === 'y') { state.redo(); return true; }
  if (canvas.kind === 'overview') {
    if (mod && key === 'a') { state.select({ nodes: [...state.model.order], edges: state.model.edges.map((edge) => edge.id) }); return true; }
    if (!mod && (key === 'delete' || key === 'backspace')) { canvas.remove?.(); return true; }
  }
  if (!mod && key === 'escape') { state.select({ nodes: [], edges: [] }); return true; }
  return undefined;
}

/** Runs the shortcut for `event`; returns true when the key was handled (and must not reach anyone else). */
export function handleShortcut(event: KeyboardEvent, center: () => { x: number; y: number }, canvas: ShortcutCanvas = DIAGRAM_CANVAS): boolean {
  const projects = catalogStore.getState();
  if (projects.open || projects.creating || projects.busy) return false;
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  // ⌘S saves a version (never the browser's "Salvar página"), even while typing. Behind the doc modal, the
  // context modal or the command palette it is only swallowed: the dialog would open under them.
  // The Overview has no versions: ⌘S is only kept from the browser's "Salvar página" (every change saves itself).
  if (mod && key === 's' && canvas.kind === 'overview') return true;
  if (mod && key === 's') {
    const covered = docSession.store.getState().open || contextStore.getState().open || uiStore.getState().paletteOpen || settingsStore.getState().open;
    if (!covered) openSaveVersion();
    return true;
  }
  // While "Salvar versão" is open, block every other global shortcut, exactly like the doc/context modals.
  if (versionStore.getState().dialogOpen) return false;
  // The doc modal and the context modal render no focusable target (unlike the command palette's own guard
  // below), so keys would otherwise reach the diagram behind them; each has its own Escape listener that
  // keeps closing it.
  if (docSession.store.getState().open || contextStore.getState().open || settingsStore.getState().open) return false;
  // Presenting: the AI panel and the palette stay closed (a draft or command must not slip in behind the lock).
  if (mod && (key === 'j' || key === 'k') && uiStore.getState().presenting) return true;
  // ⌘J opens/closes the AI panel from anywhere, including its own prompt box.
  if (mod && key === 'j' && canvas.kind === 'diagram') {
    toggleAi();
    return true;
  }
  if (isTyping(event.target)) return false;
  const state = canvas.store.getState();
  if (mod && key === 'k') {
    uiStore.setState({ paletteOpen: true });
    return true;
  }
  // Modifier shortcuts (⌘Z, ⌘C…) stay global; plain keys go to the focused control.
  if (!mod && isControl(event.target)) return false;
  if (uiStore.getState().paletteOpen) return false;
  if (canvas.kind === 'overview') return sharedKey(event, canvas, mod, key) ?? false;
  if (mod && event.shiftKey && key === 'c') { void copySelectionImage(); return true; }
  // Presenting: P leaves; everything else belongs to the presentation (PresentMode) and edits nothing.
  if (uiStore.getState().presenting) {
    if (mod || event.shiftKey || key !== 'p') return false;
    togglePresentation();
    return true;
  }
  if (!mod && !event.shiftKey && !event.altKey && key === 'p') {
    togglePresentation();
    return true;
  }
  const arrow = ARROWS[key];
  if (mod) {
    if (arrow) {
      flowchartStep(arrow);
      return true;
    }
    if (key === 'z' || key === 'y') return sharedKey(event, canvas, mod, key) ?? false;
    const actions: Record<string, () => void> = {
      c: () => { if (copySelection()) void copySelectionImage(); },
      v: pasteClipboard,
      d: duplicateSelection,
      a: selectAll,
      g: () => groupSelectionOrCreate(center()),
    };
    const action = actions[key];
    action?.();
    return !!action;
  }
  if (arrow) {
    if (!state.selection.nodes.length) return false;
    nudgeSelection(arrow, event.shiftKey ? 10 : 1);
    return true;
  }
  if (key === 'delete' || key === 'backspace') {
    deleteSelection();
  } else if (key === 'enter' && state.selection.nodes.length === 1) {
    uiStore.setState({ editingId: state.selection.nodes[0] });
  } else if (key === 'escape') {
    state.select({ nodes: [], edges: [] });
  } else if (key === 'n') {
    addNodeAt(center(), 'shape');
  } else if (key === 'i') {
    addNodeAt(center(), 'icon');
  } else {
    return false;
  }
  return true;
}

export function useShortcuts(center: () => { x: number; y: number }, canvas: ShortcutCanvas = DIAGRAM_CANVAS): void {
  useEffect(() => {
    // Capture phase: handled keys never reach React Flow's own node key handlers.
    const onKeyDown = (event: KeyboardEvent) => {
      if (!handleShortcut(event, center, canvas)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [center, canvas]);
}
