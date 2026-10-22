import { systemMessage } from '../i18n';
import type { ID, Rect, SnapGuide } from '@strukt/core';
import type { ReachDirection } from '../diagram/focus';
import type { PerspectiveRead } from '../perspectives/project';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { CODE_WIDTH, clampCodeWidth } from './codeWidth';
import { resolveAccent } from './accent';
import type { Accent } from './accent';
import { resolveTheme, THEME_PREFS } from './theme';
import { isMobileViewport } from './useBreakpoint';
import type { Theme, ThemePref } from './theme';

export type RightPanel = 'versions' | 'flows' | 'model' | 'accuracy' | 'github' | 'perspectives' | 'chat' | 'comments' | 'timeline';

export interface UiState {
  /** The visitor's choice (Automático follows the OS). */
  themePref: ThemePref;
  /** The choice resolved to light|dark: what the canvas, the palette and the export read. */
  theme: Theme;
  editingId: string | null;
  guides: SnapGuide[];
  /** Group rects pinned while a child is dragged (see computeRects). */
  frozen: Record<string, Rect> | null;
  paletteOpen: boolean;
  toast: string | null;
  /** Optional button on the toast ("Desfazer"); cleared with the toast. */
  toastAction: ToastAction | null;
  /** Total life of the current toast in ms, whether its timer is held (hover/focus) and a per-toast counter: they drive the progress bar. */
  toastMs: number;
  toastPaused: boolean;
  toastId: number;
  /** Bumped to make the toast's action button take keyboard focus. */
  toastFocusRequest: number;
  /** Bumped to ask the canvas to fit the whole diagram in view. */
  fitRequest: number;
  fitNodes: ID[] | null;
  /** Pixels at the bottom of the canvas covered by the expanded AI composer; `fitView` keeps clear of them. */
  fitInsetBottom: number;
  codeOpen: boolean;
  /** "Animar fluxo": packets travel along the connections (a visitor preference, not diagram data). */
  flowAnimation: boolean;
  /** The single right-hand panel slot: at most one of these is shown (the Inspector shows when it is null). */
  rightPanel: RightPanel | null;
  activeTag: string | null;
  /** The perspective the canvas and the exports read the open diagram through (a reading view: never saved, never in undo). */
  activePerspective: { diagram: string; id: string; name: string } | null;
  /** The open diagram as that perspective reads it, kept by `perspectives/engine` (null while none is applied). */
  perspectiveRead: PerspectiveRead | null;
  activeFlowEdges: string[];
  activeFlowNodes: string[];
  /** Modo apresentação: the chrome is hidden and the canvas is read-only (see present/presentStore.ts). */
  presenting: boolean;
  diagramTrail: string[];
  /** Visitor layout preferences: the workspace sidebar and the docked code panel's width. */
  sidebarOpen: boolean;
  codeWidth: number;
  sidebarWidth: number;
  dockWidth: number;
  minimap: boolean;
  /** Passport "Antes/Depois": the whole chain lit instead of the neighbours (only while `origin` is focused). */
  reach: { origin: ID; direction: ReachDirection } | null;
  /** Passport row under the pointer: only that edge pulses. */
  focusPreview: ID | null;
  /** Propriedades of a node or group: the passport ("Visão") or the fields ("Editar"). */
  inspectorTab: 'overview' | 'edit';
  /** Configurações › Geral › Cor de destaque (`data-accent` on <html>). */
  accent: Accent;
  /** Configurações › Geral: no sliding or scaling anywhere, whatever the OS says. */
  reduceMotion: boolean;
  /** Sidebar sections the visitor folded (a per-visitor preference). */
  closedSections: SidebarSection[];
  /** Sidebar folders the visitor folded, as `<kind>:<path>`. */
  closedFolders: string[];
}

export type SidebarSection = 'diagram' | 'doc' | 'sketch';
const SECTIONS: readonly SidebarSection[] = ['diagram', 'doc', 'sketch'];

const THEME_KEY = 'strukt:theme';
const FLOW_KEY = 'strukt:flow';
const SIDEBAR_KEY = 'strukt:sidebar';
const CODE_WIDTH_KEY = 'strukt:code-width';
const MINIMAP_KEY = 'strukt:minimap';
const MOTION_KEY = 'strukt:reduce-motion';
const ACCENT_KEY = 'strukt:accent';
const SECTIONS_KEY = 'strukt:sections';
const FOLDERS_KEY = 'strukt:folders-closed';

function readClosedFolders(): string[] {
  try {
    const saved: unknown = JSON.parse(readPref(FOLDERS_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string' && /^(diagram|doc|sketch):.+/.test(id)) : [];
  } catch {
    return [];
  }
}

function readPref(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writePref(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // still applies for this session
  }
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

function systemDark(): boolean {
  return globalThis.matchMedia?.(DARK_QUERY).matches ?? false;
}

function initialThemePref(): ThemePref {
  const saved = readPref(THEME_KEY);
  return THEME_PREFS.find((pref) => pref === saved) ?? 'dark';
}

function initialFlowAnimation(): boolean {
  try {
    return globalThis.localStorage?.getItem(FLOW_KEY) === 'on';
  } catch {
    return false;
  }
}

export const uiStore = createStore<UiState>()(() => ({
  themePref: initialThemePref(),
  theme: resolveTheme(initialThemePref(), systemDark()),
  editingId: null,
  guides: [],
  frozen: null,
  paletteOpen: false,
  toast: null,
  toastAction: null,
  toastMs: 0,
  toastPaused: false,
  toastId: 0,
  toastFocusRequest: 0,
  fitRequest: 0,
  fitNodes: null,
  fitInsetBottom: 0,
  codeOpen: false,
  flowAnimation: initialFlowAnimation(),
  rightPanel: null,
  activeTag: null,
  activePerspective: null,
  perspectiveRead: null,
  activeFlowEdges: [],
  activeFlowNodes: [],
  presenting: false,
  diagramTrail: [],
  sidebarWidth: Math.max(220, Math.min(360, Number(readPref('strukt:sidebar-width')) || 260)),
  dockWidth: Math.max(320, Math.min(640, Number(readPref('strukt:dock-width')) || 384)),
  sidebarOpen: readPref(SIDEBAR_KEY) === 'open' || (readPref(SIDEBAR_KEY) === null && !isMobileViewport()),
  codeWidth: Number(readPref(CODE_WIDTH_KEY) ?? CODE_WIDTH.initial) || CODE_WIDTH.initial,
  // Off by default on phones: 175 px of minimap is ~45% of the screen width.
  minimap: readPref(MINIMAP_KEY) === null ? !isMobileViewport() : readPref(MINIMAP_KEY) !== 'off',
  reach: null,
  focusPreview: null,
  inspectorTab: 'overview',
  accent: resolveAccent(readPref(ACCENT_KEY)),
  reduceMotion: readPref(MOTION_KEY) === 'on',
  closedFolders: readClosedFolders(),
  closedSections: SECTIONS.filter((kind) => (readPref(SECTIONS_KEY) ?? '').split(',').includes(kind)),
}));

export function useUi<T>(selector: (state: UiState) => T): T {
  return useStore(uiStore, selector);
}

export function setTheme(pref: ThemePref): void {
  uiStore.setState({ themePref: pref, theme: resolveTheme(pref, systemDark()) });
  writePref(THEME_KEY, pref);
}

// With "Automático" the resolved theme follows the OS while the app is open.
try {
  globalThis.matchMedia?.(DARK_QUERY).addEventListener?.('change', (event) => {
    const { themePref } = uiStore.getState();
    if (themePref === 'system') uiStore.setState({ theme: resolveTheme(themePref, event.matches) });
  });
} catch {
  // no matchMedia: the theme stays as resolved at load
}

export interface ToastAction {
  label: string;
  run(): void;
  /** Called when the toast goes away without the action being run (timeout, replaced, dismissed). */
  onExpire?(): void;
}

const TOAST_MS = 3500;
/** A toast with an action stays long enough to be reached and used ("Desfazer"). */
const TOAST_ACTION_MS = 8000;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastRemaining = 0;
let toastStartedAt = 0;
let toastPaused = false;

const armToast = (ms: number) => {
  clearTimeout(toastTimer);
  toastRemaining = ms;
  toastStartedAt = Date.now();
  toastTimer = setTimeout(dismissToast, ms);
};

/** Plain toasts held back while an action toast (an undo offer) is up; shown FIFO once it leaves. */
const TOAST_QUEUE_CAP = 5;
let toastQueue: string[] = [];

/** Drops the held-back toasts (tests). */
export function clearToastQueue(): void {
  toastQueue = [];
}

const enqueueToast = (message: string, front = false) => {
  if (toastQueue.includes(message) || (!front && message === uiStore.getState().toast)) return;
  if (front) toastQueue.unshift(message);
  else toastQueue.push(message);
  if (toastQueue.length > TOAST_QUEUE_CAP) toastQueue = front ? toastQueue.slice(0, TOAST_QUEUE_CAP) : toastQueue.slice(-TOAST_QUEUE_CAP);
};

/** Ends the toast; `onExpire` of its action fires unless the action was the reason. Then the next queued toast shows. */
export function dismissToast(): void {
  clearTimeout(toastTimer);
  toastTimer = undefined;
  toastPaused = false;
  const expired = uiStore.getState().toastAction;
  uiStore.setState({ toast: null, toastAction: null, toastPaused: false });
  expired?.onExpire?.();
  const next = uiStore.getState().toast === null ? toastQueue.shift() : undefined;
  if (next !== undefined) showToast(next);
}

/**
 * Shows `message`. A plain toast replaces the current plain one (and its timer), but never a toast that offers an
 * action (an undo offer): it waits in a small FIFO queue (deduplicated) and shows when the offer leaves. A toast
 * with an action replaces whatever is showing; a plain toast it displaced goes back to the head of the queue.
 */
export function showToast(message: string, action?: ToastAction): void {
  message = systemMessage(message);
  const { toast: current, toastAction: replaced } = uiStore.getState();
  if (!action && replaced) {
    enqueueToast(message);
    return;
  }
  if (action && current && !replaced) enqueueToast(current, true);
  toastPaused = false;
  const ms = action ? TOAST_ACTION_MS : TOAST_MS;
  uiStore.setState((s) => ({ toast: message, toastAction: action ?? null, toastMs: ms, toastPaused: false, toastId: s.toastId + 1 }));
  armToast(ms);
  replaced?.onExpire?.();
}

/** Holds the auto-dismiss while the pointer or focus is on the toast (WCAG 2.2.1). */
export function pauseToast(): void {
  if (toastPaused || !uiStore.getState().toast) return;
  toastPaused = true;
  uiStore.setState({ toastPaused: true });
  clearTimeout(toastTimer);
  toastRemaining = Math.max(0, toastRemaining - (Date.now() - toastStartedAt));
}

/** Resumes with the time that was left when it was paused. */
export function resumeToast(): void {
  if (!toastPaused || !uiStore.getState().toast) return;
  toastPaused = false;
  uiStore.setState({ toastPaused: false });
  armToast(toastRemaining);
}

/** Runs the toast's action once and dismisses the toast (without `onExpire`). */
export function runToastAction(): void {
  const action = uiStore.getState().toastAction;
  uiStore.setState({ toastAction: null });
  dismissToast();
  action?.run();
}

/** Asks the toast to move keyboard focus to its action button (keyboard-triggered deletes). */
export function focusToastAction(): void {
  uiStore.setState((s) => ({ toastFocusRequest: s.toastFocusRequest + 1 }));
}

export function requestFit(nodes?: ID[]): void {
  uiStore.setState((s) => ({ fitRequest: s.fitRequest + 1, fitNodes: nodes ?? null }));
}

export function toggleCode(): void {
  uiStore.setState((s) => ({ codeOpen: !s.codeOpen }));
}

export function setFlowAnimation(on: boolean): void {
  uiStore.setState({ flowAnimation: on });
  try {
    globalThis.localStorage?.setItem(FLOW_KEY, on ? 'on' : 'off');
  } catch {
    // still applies for this session
  }
}

export function toggleFlowAnimation(): void {
  setFlowAnimation(!uiStore.getState().flowAnimation);
}

/** ⌘\ and the top bar button. */
/** Folds or unfolds a sidebar folder and remembers the choice. */
export function toggleFolder(kind: SidebarSection, path: string): void {
  const id = `${kind}:${path}`;
  const closed = uiStore.getState().closedFolders;
  const next = closed.includes(id) ? closed.filter((item) => item !== id) : [...closed, id];
  uiStore.setState({ closedFolders: next });
  writePref(FOLDERS_KEY, JSON.stringify(next));
}

/** Folds or unfolds a sidebar section and remembers the choice. */
export function toggleSection(kind: SidebarSection): void {
  const closed = uiStore.getState().closedSections;
  const next = closed.includes(kind) ? closed.filter((item) => item !== kind) : [...closed, kind];
  uiStore.setState({ closedSections: next });
  writePref(SECTIONS_KEY, next.join(','));
}

export function toggleSidebar(): void {
  const open = !uiStore.getState().sidebarOpen;
  uiStore.setState({ sidebarOpen: open });
  writePref(SIDEBAR_KEY, open ? 'open' : 'closed');
}

/** Picking an item on a phone dismisses the overlay sidebar; not saved, so it does not change the desktop preference. */
export function closeSidebarOnMobile(): void {
  if (isMobileViewport() && uiStore.getState().sidebarOpen) uiStore.setState({ sidebarOpen: false });
}

/** While dragging the divider; `persist` once the drag ends. */
export function setCodeWidth(width: number, persist = false): void {
  const next = clampCodeWidth(width, globalThis.innerWidth ?? 1600);
  uiStore.setState({ codeWidth: next });
  if (persist) writePref(CODE_WIDTH_KEY, String(next));
}

export function toggleMinimap(): void {
  const on = !uiStore.getState().minimap;
  uiStore.setState({ minimap: on });
  writePref(MINIMAP_KEY, on ? 'on' : 'off');
}

export function setAccent(accent: Accent): void {
  uiStore.setState({ accent });
  writePref(ACCENT_KEY, accent);
}

export function setReduceMotion(on: boolean): void {
  uiStore.setState({ reduceMotion: on });
  writePref(MOTION_KEY, on ? 'on' : 'off');
}

export function setMinimap(on: boolean): void {
  if (uiStore.getState().minimap !== on) toggleMinimap();
}

export function setSidebarOpen(open: boolean): void {
  if (uiStore.getState().sidebarOpen !== open) toggleSidebar();
}

/** Opens `panel` in the right-hand slot (replacing any other); toggling the open one closes it. */
export function toggleRightPanel(panel: RightPanel): void {
  uiStore.setState((s) => ({ rightPanel: s.rightPanel === panel ? null : panel }));
}

/** Clears the slot; with `panel`, only when that panel is the one shown. */
export function closeRightPanel(panel?: RightPanel): void {
  uiStore.setState((s) => (panel && s.rightPanel !== panel ? s : { rightPanel: null }));
}

export function setSidebarWidth(width: number, persist = false): void {
  const sidebarWidth = Math.max(220, Math.min(360, Number.isFinite(width) ? width : 260));
  uiStore.setState({ sidebarWidth });
  if (persist) writePref('strukt:sidebar-width', String(sidebarWidth));
}
export function setDockWidth(width: number, persist = false): void {
  const dockWidth = Math.max(320, Math.min(640, Number.isFinite(width) ? width : 384));
  uiStore.setState({ dockWidth });
  if (persist) writePref('strukt:dock-width', String(dockWidth));
}
