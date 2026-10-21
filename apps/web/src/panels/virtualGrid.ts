/**
 * Row windowing for a sectioned grid (the icon picker): each section is an optional header row followed by
 * rows of `columns` items. Items are addressed by their index in the flat order of all sections.
 */

export interface GridSection {
  key: string;
  /** Untitled sections get no header row. */
  title?: string;
  size: number;
}

export interface GridMetrics {
  columns: number;
  rowHeight: number;
  headerHeight: number;
}

export type GridRow =
  | { kind: 'header'; key: string; title: string; count: number; top: number; height: number }
  | { kind: 'items'; key: string; start: number; end: number; top: number; height: number };

export interface GridLayout {
  rows: GridRow[];
  /** Indexes into `rows` of the item rows, in order. */
  itemRows: number[];
  height: number;
  itemCount: number;
}

type ItemRow = Extract<GridRow, { kind: 'items' }>;

export type GridMove = 'up' | 'down' | 'left' | 'right';

export function layoutGrid(sections: readonly GridSection[], { columns, rowHeight, headerHeight }: GridMetrics): GridLayout {
  const rows: GridRow[] = [];
  const itemRows: number[] = [];
  let top = 0;
  let start = 0;
  for (const section of sections) {
    if (section.size <= 0) continue;
    if (section.title !== undefined) {
      rows.push({ kind: 'header', key: `${section.key}:header`, title: section.title, count: section.size, top, height: headerHeight });
      top += headerHeight;
    }
    for (let offset = 0; offset < section.size; offset += columns) {
      const end = start + Math.min(columns, section.size - offset);
      itemRows.push(rows.length);
      rows.push({ kind: 'items', key: `${section.key}:${offset}`, start, end, top, height: rowHeight });
      top += rowHeight;
      start = end;
    }
  }
  return { rows, itemRows, height: top, itemCount: start };
}

/** Index of the first row whose bottom edge is below `y`. */
function firstRowEndingAfter(rows: readonly GridRow[], y: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]!.top + rows[mid]!.height <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Rows `[from, to)` that intersect the viewport, widened by `overscan` rows on each side. */
export function visibleRange(layout: GridLayout, scrollTop: number, viewportHeight: number, overscan: number): { from: number; to: number } {
  const { rows } = layout;
  const first = firstRowEndingAfter(rows, scrollTop);
  let last = first;
  while (last < rows.length && rows[last]!.top < scrollTop + viewportHeight) last += 1;
  return { from: Math.max(0, first - overscan), to: Math.min(rows.length, last + overscan) };
}

/** Position in `itemRows` of the row holding `index` (a valid item index). */
function itemRowPosition(layout: GridLayout, index: number): number {
  let lo = 0;
  let hi = layout.itemRows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((layout.rows[layout.itemRows[mid]!] as ItemRow).start <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The item row holding `index`, or -1. */
export function rowOfItem(layout: GridLayout, index: number): number {
  if (index < 0 || index >= layout.itemCount) return -1;
  return layout.itemRows[itemRowPosition(layout, index)]!;
}

/** Arrow-key movement: left/right through the flat order, up/down to the same column of the next item row. */
export function moveActive(layout: GridLayout, index: number, move: GridMove): number {
  if (layout.itemCount === 0) return -1;
  if (index < 0 || index >= layout.itemCount) return 0;
  if (move === 'left') return Math.max(0, index - 1);
  if (move === 'right') return Math.min(layout.itemCount - 1, index + 1);
  const position = itemRowPosition(layout, index);
  const target = layout.itemRows[position + (move === 'down' ? 1 : -1)];
  if (target === undefined) return index;
  const current = layout.rows[layout.itemRows[position]!] as ItemRow;
  const next = layout.rows[target] as ItemRow;
  return next.start + Math.min(index - current.start, next.end - next.start - 1);
}

/** The scrollTop that brings `index` fully into view (with its section header when it opens the section). */
export function scrollToReveal(layout: GridLayout, index: number, scrollTop: number, viewportHeight: number): number {
  const row = rowOfItem(layout, index);
  if (row < 0) return scrollTop;
  const { top, height } = layout.rows[row]!;
  if (top < scrollTop) {
    const above = layout.rows[row - 1];
    return above?.kind === 'header' ? above.top : top;
  }
  if (top + height > scrollTop + viewportHeight) return top + height - viewportHeight;
  return scrollTop;
}
