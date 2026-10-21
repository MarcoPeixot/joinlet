import type { FitViewOptions } from '@xyflow/react';

/** Margins around the diagram when it is fitted; a phone has no room to waste. */
const PADDING_DESKTOP = 0.2;
const PADDING_MOBILE = 0.08;
/** The tool palette floats over the canvas's left edge (12 px gutter + ~44 px column + a breath), and on a phone as a row under the bar. */
const PALETTE_CLEAR_LEFT = 76;
const PALETTE_CLEAR_TOP_MOBILE = 116;

/**
 * `fitView` options. `bottomInset` (px) keeps the fitted diagram clear of whatever covers the bottom of the
 * canvas (the expanded AI composer). The tool palette is clear too: on a canvas too narrow for the fractional
 * margin (a twelfth of the pane at 0.2) to clear it (`paneWidth` known) the left margin grows to its width; on a phone the top margin does.
 */
export function fitOptionsFor(mobile: boolean, bottomInset: number, paneWidth = 0): FitViewOptions {
  const padding = mobile ? PADDING_MOBILE : PADDING_DESKTOP;
  // React Flow turns a fractional padding p into a margin of (p / (1 + p)) / 2 of the pane per side.
  const margin = (paneWidth * padding) / (2 * (1 + padding));
  const left = !mobile && paneWidth > 0 && margin < PALETTE_CLEAR_LEFT ? `${PALETTE_CLEAR_LEFT}px` : padding;
  const top = mobile ? `${PALETTE_CLEAR_TOP_MOBILE}px` : padding;
  const bottom = bottomInset > 0 ? (`${Math.round(bottomInset)}px` as const) : padding;
  if (left === padding && top === padding && bottom === padding) return { padding, maxZoom: 1 };
  return { padding: { top, left, right: padding, bottom }, maxZoom: 1 };
}
