import { applyOps, emptyModel } from '@strukt/core';
import type { DiagramOp, Rect } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { snapDraggedRect } from './snapping';

function model(ops: DiagramOp[]) {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

describe('snapDraggedRect', () => {
  it("snaps to a sibling's top edge within threshold", () => {
    const m = model([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }]);
    const rects: Record<string, Rect> = {
      A: { x: 0, y: 100, w: 160, h: 64 },
      B: { x: 300, y: 100, w: 160, h: 64 },
    };
    // A is dragged to y=104, 4px below B's top (within the 6px default threshold).
    const result = snapDraggedRect(m, rects, 'A', 0, 104);
    expect(result).toMatchObject({ x: 0, y: 100 });
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0]).toMatchObject({ axis: 'y', pos: 100 });
  });

  it('does not snap beyond the threshold', () => {
    const m = model([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }]);
    const rects: Record<string, Rect> = {
      A: { x: 0, y: 100, w: 160, h: 64 },
      B: { x: 300, y: 200, w: 160, h: 64 },
    };
    const result = snapDraggedRect(m, rects, 'A', 0, 104);
    expect(result).toEqual({ x: 0, y: 104, guides: [] });
  });

  it("ignores its own ancestor chain (a child can't snap to its parent group's edge)", () => {
    const m = model([{ op: 'add_group', id: 'G' }, { op: 'add_node', id: 'C', parentId: 'G' }]);
    const rects: Record<string, Rect> = {
      G: { x: 40, y: 40, w: 300, h: 200 },
      C: { x: 60, y: 84, w: 160, h: 64 },
    };
    // C dragged 4px from G's own top edge — would spuriously "snap" if G weren't excluded.
    const result = snapDraggedRect(m, rects, 'C', 60, 44);
    expect(result).toEqual({ x: 60, y: 44, guides: [] });
  });

  it("ignores its own descendants (a group can't snap to a rect it contains)", () => {
    const m = model([{ op: 'add_group', id: 'G' }, { op: 'add_node', id: 'C', parentId: 'G' }]);
    const rects: Record<string, Rect> = {
      G: { x: 40, y: 40, w: 300, h: 200 },
      C: { x: 60, y: 84, w: 160, h: 64 },
    };
    // G dragged 4px from its own child's top edge — would spuriously "snap" if C weren't excluded.
    const result = snapDraggedRect(m, rects, 'G', 40, 80);
    expect(result).toEqual({ x: 40, y: 80, guides: [] });
  });
});
