/**
 * How much room the canvas has once the docked chrome has taken its share. The right-hand panels, the sidebar
 * and the code panel all sit beside the canvas (not over it), so what is left is plain arithmetic.
 */

/** Every right-slot panel (Propriedades, Versões, Chat…) is this wide: one width, whatever the panel. */
export const PANEL_WIDTH = 360;
/** Reserve the floating panel plus its twelve-pixel outer gutters. */
export const DOCK_WIDTH = PANEL_WIDTH + 24;
export const SIDEBAR_WIDTH = 260;
/** Below this the canvas is not worth drawing on: something else gives way. */
export const CANVAS_MIN = 420;

export interface Docked {
  sidebar: boolean;
  sidebarWidth?: number;
  dockWidth?: number;
  /** Width (px) of the code panel when it is open; null when it is closed. */
  code: number | null;
  /** A reserved right-slot panel is up. */
  dock: boolean;
}

/** What is left for the canvas next to what is docked. */
export function canvasWidth(viewport: number, { sidebar, code, dock, sidebarWidth = SIDEBAR_WIDTH, dockWidth = DOCK_WIDTH }: Docked): number {
  return viewport - (sidebar ? sidebarWidth : 0) - (code ?? 0) - (dock ? dockWidth : 0);
}

/** The sidebar steps aside (for as long as the panel is open) when the panel would squeeze the canvas too far. */
export function sidebarShouldYield(viewport: number, docked: Docked): boolean {
  return (docked.dock || docked.code !== null) && docked.sidebar && canvasWidth(viewport, docked) < CANVAS_MIN;
}


/** Keep a useful canvas when Code and a right-hand panel cannot both fit beside it. */
export function codeShouldFloat(viewport: number, code: number, dock: number): boolean {
  return viewport - code - dock < CANVAS_MIN;
}


/** Shared desktop dock width; the extra eight pixels match the workbench gutters. */
export function dockMaxWidth(viewport: number): number {
  return Math.max(320, Math.min(640, viewport - CANVAS_MIN - 8));
}
export function dockPanelWidth(viewport: number, preferred: number): number {
  return Math.min(preferred, dockMaxWidth(viewport));
}
