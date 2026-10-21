import { describe, expect, it } from 'vitest';
import { layoutGrid, moveActive, rowOfItem, scrollToReveal, visibleRange } from './virtualGrid';
import type { GridLayout } from './virtualGrid';

const metrics = { columns: 4, rowHeight: 70, headerHeight: 30 };

/** Sections of 6 and 3 items with headers, an empty one, then 5 untitled items. */
function sample(): GridLayout {
  return layoutGrid(
    [
      { key: 'a', title: 'A', size: 6 },
      { key: 'empty', title: 'Vazia', size: 0 },
      { key: 'b', title: 'B', size: 3 },
      { key: 'c', size: 5 },
    ],
    metrics,
  );
}

describe('layoutGrid', () => {
  it('stacks a header row and item rows per section, skipping empty sections and absent titles', () => {
    const layout = sample();
    expect(layout.rows.map((row) => (row.kind === 'header' ? `H:${row.title}:${row.count}` : `${row.start}-${row.end}`))).toEqual([
      'H:A:6', '0-4', '4-6', 'H:B:3', '6-9', '9-13', '13-14',
    ]);
    expect(layout.rows.map((row) => row.top)).toEqual([0, 30, 100, 170, 200, 270, 340]);
    expect(layout.height).toBe(410);
    expect(layout.itemCount).toBe(14);
  });

  it('lays out nothing for no items', () => {
    expect(layoutGrid([{ key: 'a', title: 'A', size: 0 }], metrics)).toEqual({ rows: [], itemRows: [], height: 0, itemCount: 0 });
  });

  it('handles thousands of items with a single column', () => {
    const layout = layoutGrid([{ key: 'all', size: 5000 }], { columns: 1, rowHeight: 10, headerHeight: 0 });
    expect(layout.rows).toHaveLength(5000);
    expect(layout.height).toBe(50_000);
  });
});

describe('visibleRange', () => {
  it('returns only the rows that intersect the viewport, plus the overscan', () => {
    const layout = layoutGrid([{ key: 'all', size: 4000 }], metrics); // 1000 rows of 70 px
    expect(visibleRange(layout, 0, 350, 0)).toEqual({ from: 0, to: 5 });
    expect(visibleRange(layout, 7000, 350, 0)).toEqual({ from: 100, to: 105 });
    expect(visibleRange(layout, 7035, 350, 0)).toEqual({ from: 100, to: 106 });
    expect(visibleRange(layout, 7000, 350, 2)).toEqual({ from: 98, to: 107 });
  });

  it('clamps to the rows that exist', () => {
    const layout = sample();
    expect(visibleRange(layout, 0, 10_000, 3)).toEqual({ from: 0, to: 7 });
    expect(visibleRange(layout, 380, 100, 5)).toEqual({ from: 1, to: 7 });
    expect(visibleRange(layoutGrid([], metrics), 0, 500, 2)).toEqual({ from: 0, to: 0 });
  });
});

describe('rowOfItem', () => {
  it('finds the item row that holds an index', () => {
    const layout = sample();
    expect([0, 3, 4, 5, 6, 8, 9, 13].map((index) => rowOfItem(layout, index))).toEqual([1, 1, 2, 2, 4, 4, 5, 6]);
    expect(rowOfItem(layout, 99)).toBe(-1);
    expect(rowOfItem(layout, -1)).toBe(-1);
  });
});

describe('moveActive', () => {
  const layout = sample();

  it('moves left and right through the flat order, stopping at the ends', () => {
    expect(moveActive(layout, 4, 'right')).toBe(5);
    expect(moveActive(layout, 5, 'right')).toBe(6);
    expect(moveActive(layout, 13, 'right')).toBe(13);
    expect(moveActive(layout, 6, 'left')).toBe(5);
    expect(moveActive(layout, 0, 'left')).toBe(0);
  });

  it('moves up and down one row keeping the column, across section headers', () => {
    expect(moveActive(layout, 1, 'down')).toBe(5);
    expect(moveActive(layout, 5, 'down')).toBe(7);
    expect(moveActive(layout, 7, 'down')).toBe(10);
    expect(moveActive(layout, 10, 'up')).toBe(7);
    expect(moveActive(layout, 7, 'up')).toBe(5);
    expect(moveActive(layout, 5, 'up')).toBe(1);
  });

  it('clamps to the last item of a shorter row', () => {
    expect(moveActive(layout, 3, 'down')).toBe(5);
    expect(moveActive(layout, 12, 'down')).toBe(13);
    expect(moveActive(layout, 8, 'down')).toBe(11);
  });

  it('stays on the first or last row, and starts at 0 without an active item', () => {
    expect(moveActive(layout, 2, 'up')).toBe(2);
    expect(moveActive(layout, 13, 'down')).toBe(13);
    expect(moveActive(layout, -1, 'down')).toBe(0);
    expect(moveActive(layoutGrid([], metrics), -1, 'down')).toBe(-1);
  });
});

describe('scrollToReveal', () => {
  const layout = layoutGrid([{ key: 'all', size: 4000 }], metrics);

  it('keeps the scroll when the item is fully visible', () => {
    expect(scrollToReveal(layout, 0, 0, 350)).toBe(0);
    expect(scrollToReveal(layout, 19, 0, 350)).toBe(0);
  });

  it('scrolls just enough to show a row below or above the viewport', () => {
    expect(scrollToReveal(layout, 20, 0, 350)).toBe(70);
    expect(scrollToReveal(layout, 0, 700, 350)).toBe(0);
    expect(scrollToReveal(layout, 41, 700, 350)).toBe(700);
    expect(scrollToReveal(layout, 39, 700, 350)).toBe(630);
  });

  it('brings a section header into view with the first row under it', () => {
    const sections = sample();
    expect(scrollToReveal(sections, 6, 300, 200)).toBe(170);
    expect(scrollToReveal(sections, 0, 50, 200)).toBe(0);
  });
});
