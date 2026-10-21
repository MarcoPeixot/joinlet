import { applyOps, emptyModel, syncLayout } from '@strukt/core';
import type { DiagramModel, DiagramOp, LayoutState } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { placeBatch, placeNear, placeNew, positionedRects } from './place';

function build(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

const layout = (nodes: LayoutState['nodes']): LayoutState => ({ nodes, edges: {} });

describe('positionedRects', () => {
  it('keeps only placed elements and wraps groups around placed children', () => {
    const m = build([{ op: 'add_group', id: 'G' }, { op: 'add_node', id: 'A', parentId: 'G' }, { op: 'add_node', id: 'B', parentId: 'G' }]);
    const rects = positionedRects(m, layout({ A: { x: 100, y: 100 }, B: { x: 400, y: 100 } }), new Set(['B']));
    expect(rects).toEqual({ A: { x: 100, y: 100, w: 160, h: 64 }, G: { x: 72, y: 56, w: 216, h: 136 } });
  });
});

describe('placeNear', () => {
  const chain = build([
    { op: 'add_node', id: 'A' },
    { op: 'add_node', id: 'B' },
    { op: 'add_node', id: 'C' },
    { op: 'connect', from: 'A', to: 'B' },
    { op: 'connect', from: 'C', to: 'A' },
  ]);
  const rectsA = { A: { x: 0, y: 0, w: 160, h: 64 } };

  it('goes after an incoming neighbor in the diagram direction', () => {
    expect(placeNear(chain, rectsA, 'B', 'right')).toEqual({ x: 240, y: 0 });
    expect(placeNear(chain, rectsA, 'B', 'down')).toEqual({ x: 0, y: 144 });
  });

  it('goes before an outgoing neighbor', () => {
    expect(placeNear(chain, rectsA, 'C', 'right')).toEqual({ x: -240, y: 0 });
  });

  it('slides off occupied spots', () => {
    const rects = { ...rectsA, X: { x: 240, y: 0, w: 160, h: 64 } };
    expect(placeNear(chain, rects, 'B', 'right')).toEqual({ x: 240, y: 88 });
  });

  it('prefers positioned siblings over a neighbor outside the group', () => {
    const m = build([
      { op: 'add_node', id: 'X' },
      { op: 'add_group', id: 'G' },
      { op: 'add_node', id: 'A', parentId: 'G' },
      { op: 'add_node', id: 'N', parentId: 'G' },
      { op: 'connect', from: 'X', to: 'N' },
    ]);
    const rects = positionedRects(m, layout({ X: { x: 1000, y: 0 }, A: { x: 0, y: 0 } }), new Set(['N']));
    expect(placeNear(m, rects, 'N', 'right')).toEqual({ x: 240, y: 0 });
  });

  it('lands inside an empty parent group that has a stored box', () => {
    const m = build([{ op: 'add_group', id: 'G' }, { op: 'add_node', id: 'N', parentId: 'G' }]);
    const rects = positionedRects(m, layout({ G: { x: 500, y: 300 } }), new Set(['N']));
    expect(placeNear(m, rects, 'N', 'down')).toEqual({ x: 528, y: 344 });
  });

  it('goes to the right of everything when isolated, or to the origin on an empty canvas', () => {
    const m = build([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }, { op: 'add_node', id: 'C' }]);
    const rects = { A: { x: 0, y: 0, w: 160, h: 64 }, B: { x: 0, y: 200, w: 160, h: 64 } };
    expect(placeNear(m, rects, 'C', 'down')).toEqual({ x: 240, y: 0 });
    expect(placeNear(m, {}, 'C', 'down')).toEqual({ x: 0, y: 0 });
  });
});

describe('placeNew', () => {
  it('places new elements one after another without overlaps, skipping derived groups', () => {
    const m = build([
      { op: 'add_node', id: 'A' },
      { op: 'add_node', id: 'B' },
      { op: 'add_node', id: 'C' },
      { op: 'connect', from: 'A', to: 'B' },
      { op: 'connect', from: 'A', to: 'C' },
      { op: 'add_group', id: 'G' },
      { op: 'add_node', id: 'X', parentId: 'G' },
      { op: 'add_node', id: 'Y', parentId: 'G' },
      { op: 'add_group', id: 'Empty' },
    ]);
    const placed = placeNew(m, layout({ A: { x: 0, y: 0 } }), ['B', 'C', 'G', 'X', 'Y', 'Empty'], 'right');
    expect(placed).toEqual({
      B: { x: 240, y: 0 },
      C: { x: 240, y: 88 },
      X: { x: 480, y: 0 },
      Y: { x: 720, y: 0 },
      Empty: { x: 988, y: -44 },
    });
  });
});

describe('names that collide with Object.prototype', () => {
  it('treats a "constructor" node without a box as unplaced and places it', () => {
    const m = build([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'constructor' }, { op: 'connect', from: 'A', to: 'constructor' }]);
    expect(positionedRects(m, layout({ A: { x: 0, y: 0 } }))).toEqual({ A: { x: 0, y: 0, w: 160, h: 64 } });
    expect(placeNew(m, layout({ A: { x: 0, y: 0 } }), ['constructor', 'toString'], 'right')).toEqual({ constructor: { x: 240, y: 0 } });
  });

  it('never reads Object.prototype for neighbors, siblings or parents that have no rect yet', () => {
    const names = ['constructor', 'toString', 'valueOf', 'hasOwnProperty'];
    const m = build([
      { op: 'add_node', id: 'A' },
      { op: 'add_group', id: 'isPrototypeOf' },
      ...names.map((id) => ({ op: 'add_node' as const, id, parentId: 'isPrototypeOf' })),
      { op: 'connect', from: 'constructor', to: 'toString' },
      { op: 'connect', from: 'valueOf', to: 'hasOwnProperty' },
    ]);
    const placed = placeNew(m, layout({ A: { x: 0, y: 0 } }), names, 'right');
    expect(Object.keys(placed)).toEqual(names);
    for (const box of Object.values(placed)) expect([box.x, box.y].every(Number.isFinite)).toBe(true);
  });

  it('keeps a regrouped box when the group has no rect of its own yet', () => {
    const m = build([{ op: 'add_node', id: 'A' }]);
    const ops: DiagramOp[] = [{ op: 'add_group', id: 'toString' }, { op: 'move_to_group', id: 'A', parentId: 'toString' }];
    const result = applyOps(m, ops);
    if (!result.ok) throw new Error(result.error.message);
    expect(placeBatch(result.model, syncLayout(layout({ A: { x: 0, y: 0 } }), result.model, ops), ops).positions).toEqual({});
  });
});

describe('placeBatch', () => {
  /** Applies `ops` like the store does and asks where the batch's elements go. */
  function batch(base: DiagramOp[], nodes: LayoutState['nodes'], ops: DiagramOp[]) {
    const result = applyOps(build(base), ops);
    if (!result.ok) throw new Error(result.error.message);
    return placeBatch(result.model, syncLayout(layout(nodes), result.model, ops), ops);
  }
  const pair: DiagramOp[] = [{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }, { op: 'connect', from: 'A', to: 'B' }];
  const grouped: DiagramOp[] = [
    { op: 'add_group', id: 'G' },
    { op: 'add_node', id: 'A', parentId: 'G' },
    { op: 'add_node', id: 'C', parentId: 'G' },
    { op: 'add_node', id: 'B' },
  ];
  const spread = { A: { x: 100, y: 100 }, C: { x: 500, y: 100 } };

  it('places every element the batch created, insert_between and renamed additions included', () => {
    const inserted = batch(pair, { A: { x: 0, y: 0 }, B: { x: 600, y: 0 } }, [{ op: 'insert_between', from: 'A', to: 'B', node: { id: 'M' } }]);
    expect(inserted).toEqual({ positions: { M: { x: 240, y: 0 } }, autoLayout: false });
    const renamed = batch(pair, { A: { x: 0, y: 0 }, B: { x: 600, y: 0 } }, [
      { op: 'add_node', id: 'X' },
      { op: 'rename', id: 'X', to: 'Y' },
      { op: 'rename', id: 'A', to: 'Z' },
    ]);
    expect(Object.keys(renamed.positions)).toEqual(['Y']);
  });

  it('re-places a survivor moved into a group it lies outside of, next to its new siblings', () => {
    const { positions } = batch(grouped, { ...spread, B: { x: 1400, y: 600 } }, [{ op: 'move_to_group', id: 'B', parentId: 'G' }]);
    expect(positions).toEqual({ B: { x: 740, y: 100 } });
  });

  it('keeps survivors that already lie inside their new group, or that left their group', () => {
    expect(batch(grouped, { ...spread, B: { x: 300, y: 100 } }, [{ op: 'move_to_group', id: 'B', parentId: 'G' }]).positions).toEqual({});
    expect(batch(grouped, { ...spread, B: { x: 1400, y: 600 } }, [{ op: 'move_to_group', id: 'A', parentId: null }]).positions).toEqual({});
  });

  it('asks for auto-layout only when no kept element has a position', () => {
    expect(batch([], {}, pair).autoLayout).toBe(true);
    expect(batch(pair, {}, [{ op: 'add_node', id: 'C' }]).autoLayout).toBe(true);
    expect(batch(pair, { A: { x: 0, y: 0 } }, [{ op: 'add_node', id: 'C' }]).autoLayout).toBe(false);
    expect(batch(pair, { A: { x: 0, y: 0 } }, [{ op: 'remove', id: 'A' }, { op: 'add_group', id: 'A' }]).autoLayout).toBe(true);
  });
});
