import type { Typeface } from '@strukt/core';

/** What the canvas, the palette and the export draw with. */
export type Theme = 'light' | 'dark';

/** The visitor's choice; "system" follows the OS, "contrast" is the high-contrast chrome. */
export type ThemePref = 'system' | 'light' | 'dark' | 'contrast';

export const THEME_PREFS: readonly ThemePref[] = ['system', 'light', 'dark', 'contrast'];

/** The light|dark the canvas/export use; high contrast sits on the dark base (its canvas is the dark paper). */
export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return pref === 'light' ? 'light' : 'dark';
}

/** The `data-theme` written on <html>: the resolved theme, or "contrast" for the high-contrast chrome. */
export function themeAttribute(pref: ThemePref, systemDark: boolean): string {
  return pref === 'contrast' ? 'contrast' : resolveTheme(pref, systemDark);
}

/**
 * The neutral canvas (mirrors `--sk-canvas` in styles/app.css) uses a subtle dot grid.
 * The export draws the same `bg`, and edge labels sit on it.
 */
export const CANVAS: Record<Theme, { bg: string; dot: string; ink: string }> = {
  light: { bg: '#fbfcfe', dot: 'rgba(85, 105, 130, 0.24)', ink: '#111827' },
  dark: { bg: '#0d1318', dot: 'rgba(232, 232, 232, 0.20)', ink: '#f5f7f2' },
};

export const FONT_STACK: Record<Typeface, string> = {
  rough: "'Shantell Sans Variable', 'Comic Sans MS', sans-serif",
  clean: "'Sora Variable', system-ui, sans-serif",
  mono: "'Geist Mono Variable', ui-monospace, monospace",
};
