import { own } from '@strukt/core';
import type { ColorMode, LayoutRole } from '@strukt/core';
import { CANVAS } from '../ui/theme';
import type { Theme } from '../ui/theme';

/** Eraser stock palette (MIT, eraserlabs/eraser-diagrams). `white` is the near-black hairline token. */
export const PALETTE: Record<string, string> = {
  white: '#242424',
  yellow: '#d3d61e',
  green: '#30a050',
  blue: '#2866c4',
  purple: '#c43dcf',
  red: '#bd413a',
  orange: '#c38424',
  black: '#3a3a3a',
};

/** Joinlet extension: names used in Eraser examples that the stock palette lacks. */
export const EXTENDED_COLORS: Record<string, string> = {
  gray: '#6b6b6b',
  grey: '#6b6b6b',
  silver: '#a3a3a3',
  pink: '#d6409f',
  cyan: '#1a9fd0',
  teal: '#1f9e8f',
  indigo: '#5b5bd6',
};

export const SWATCHES = ['blue', 'green', 'purple', 'red', 'orange', 'yellow', 'black', 'gray'] as const;

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function hexToHsl(hex: string): Hsl {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sn = s / 100;
  const ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = ln - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function resolveColor(token?: string): string | null {
  if (!token) return null;
  const t = token.trim().toLowerCase();
  const named = own(PALETTE, t) ?? own(EXTENDED_COLORS, t);
  if (named) return named;
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(t);
  if (!match) return null;
  const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join('') : match[1];
  return `#${hex}`;
}

function withLightness(hex: string, l: number, saturationScale = 1): string {
  const c = hexToHsl(hex);
  return hslToHex({ h: c.h, s: Math.min(100, c.s * saturationScale), l });
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const INK: Record<Theme, string> = { light: '#111827', dark: '#f5f7f2' };
const inkOn = (hex: string) => (luminance(hex) > 0.4 ? INK.light : '#ffffff');
/** Subtle depth shared by the canvas and SVG export. */
const SHADOW: Record<Theme, string> = { light: 'rgba(24, 28, 40, 0.06)', dark: 'rgba(0, 0, 0, 0.2)' };
/** Uncolored elements: quiet cards with a hairline. */
const QUIET = {
  light: { fill: '#ffffff', stroke: '#bcc8d7', group: '#b8c5d6', edge: '#53657d', groupFill: '#f3f6fa', caption: '#526176' },
  dark: { fill: '#151d23', stroke: '#43535d', group: '#2b363e', edge: '#a5b4bb', groupFill: '#111a20', caption: '#b5bfc4' },
} as const;

/** Icon tiles keep color as a restrained tint; uncolored tiles follow the panel. */
export function stickerFill(token: string | undefined, theme: Theme): string {
  const c = resolveColor(token);
  if (!c) return QUIET[theme].fill;
  return theme === 'light' ? withLightness(c, 97, 0.25) : withLightness(c, 14, 0.18);
}

export const captionColor = (theme: Theme): string => QUIET[theme].caption;

export function cardColors(token: string | undefined, role: LayoutRole | undefined, theme: Theme) {
  const tone = resolveColor(token) ?? (role === 'shared' ? '#7a8a99' : role === 'entry' ? '#ae5571' : '#5b8fc7');
  return {
    fill: QUIET[theme].fill,
    stroke: QUIET[theme].stroke,
    text: INK[theme], muted: QUIET[theme].caption,
    icon: theme === 'light' ? withLightness(tone, 26, 0.85) : withLightness(tone, 72, 0.4),
  };
}

export interface NodeColors {
  fill: string;
  stroke: string;
  text: string;
  icon: string;
  shadow: string;
}

export function nodeColors(token: string | undefined, mode: ColorMode, theme: Theme): NodeColors {
  const c = resolveColor(token);
  const shadow = SHADOW[theme];
  if (!c) {
    const fill = mode === 'outline' ? 'transparent' : QUIET[theme].fill;
    return { fill, stroke: QUIET[theme].stroke, text: INK[theme], icon: INK[theme], shadow };
  }
  const accent = theme === 'light' ? c : withLightness(c, 64);
  if (mode === 'bold') {
    const fill = theme === 'light' ? c : withLightness(c, 44);
    return { fill, stroke: fill, text: inkOn(fill), icon: inkOn(fill), shadow };
  }
  if (mode === 'outline') return { fill: 'transparent', stroke: accent, text: INK[theme], icon: accent, shadow };
  const fill = QUIET[theme].fill;
  const stroke = theme === 'light' ? withLightness(c, 64, 0.45) : withLightness(c, 36, 0.3);
  return { fill, stroke, text: INK[theme], icon: accent, shadow };
}

export interface GroupColors {
  fill: string;
  stroke: string;
  titleSurface: string;
  titleText: string;
  shadow: string;
}

export function groupColors(token: string | undefined, mode: ColorMode, theme: Theme): GroupColors {
  const c = resolveColor(token);
  const shadow = SHADOW[theme];
  if (!c) {
    return { fill: mode === 'outline' ? 'transparent' : QUIET[theme].groupFill, stroke: QUIET[theme].group, titleSurface: 'transparent', titleText: QUIET[theme].caption, shadow };
  }
  const accent = theme === 'light' ? c : withLightness(c, 60);
  if (mode === 'bold') {
    const surface = theme === 'light' ? c : withLightness(c, 40);
    const fill = theme === 'light' ? withLightness(c, 94) : withLightness(c, 14, 0.5);
    return { fill, stroke: accent, titleSurface: surface, titleText: inkOn(surface), shadow };
  }
  if (mode === 'outline') return { fill: 'transparent', stroke: accent, titleSurface: 'transparent', titleText: INK[theme], shadow };
  return {
    fill: theme === 'light' ? withLightness(c, 97, 0.4) : QUIET[theme].groupFill,
    stroke: theme === 'light' ? withLightness(c, 65, 0.45) : withLightness(c, 35, 0.3),
    titleSurface: 'transparent',
    titleText: theme === 'light' ? withLightness(c, 29, 0.55) : QUIET[theme].caption,
    shadow,
  };
}

export function edgeColor(token: string | undefined, theme: Theme): string {
  const c = resolveColor(token);
  if (!c) return QUIET[theme].edge;
  return theme === 'light' ? c : withLightness(c, 64);
}

/** Connection labels are text: the line color, nudged along its lightness until it reads (AA, 4.5:1) on the canvas. */
export function edgeLabelColor(token: string | undefined, theme: Theme): string {
  const base = edgeColor(token, theme);
  const bg = luminance(CANVAS[theme].bg);
  const reads = (hex: string) => {
    const [hi, lo] = [luminance(hex), bg].sort((a, b) => b - a);
    return (hi! + 0.05) / (lo! + 0.05) >= 4.6;
  };
  if (reads(base)) return base;
  const { h, s, l } = hexToHsl(base);
  const step = theme === 'light' ? -1 : 1;
  for (let next = l + step; next >= 0 && next <= 100; next += step) {
    const candidate = hslToHex({ h, s, l: next });
    if (reads(candidate)) return candidate;
  }
  return theme === 'light' ? '#000000' : '#ffffff';
}

/** A single-color brand mark in its own color, or null when it would vanish on the theme (GitHub's black on dark). */
export function legibleBrandColor(hex: string, theme: Theme): string | null {
  const { l } = hexToHsl(hex);
  return (theme === 'dark' && l < 22) || (theme === 'light' && l > 88) ? null : hex;
}
