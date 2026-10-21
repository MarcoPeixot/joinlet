import { describe, expect, it } from 'vitest';
import { applyOps } from './applyOps';
import { copyElements, pasteOps } from './clipboard';
import { computeRects } from './geometry';
import { emptyModel } from './model';
import type { DiagramModel, DiagramOp } from './model';
import { findFreeSpot, nextPosition } from './placement';
import { snapRect } from './snap';

function build(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

describe('placement', () => {
  const source = { x: 0, y: 0, w: 100, h: 50 };
  it('places the next node centered in the chosen direction', () => {
    expect(nextPosition(source, 'right', { w: 100, h: 50 })).toEqual({ x: 180, y: 0 });
    expect(nextPosition(source, 'down', { w: 60, h: 60 })).toEqual({ x: 20, y: 130 });
    expect(nextPosition(source, 'left', { w: 100, h: 50 })).toEqual({ x: -180, y: 0 });
    expect(nextPosition(source, 'up', { w: 100, h: 50 })).toEqual({ x: 0, y: -130 });
  });
  it('slides along the perpendicular axis until the spot is free', () => {
    const occupied = [{ x: 180, y: 0, w: 100, h: 50 }];
    expect(findFreeSpot({ x: 180, y: 0 }, { w: 100, h: 50 }, 'right', occupied)).toEqual({ x: 180, y: 74 });
  });
});

describe('snapRect', () => {
  const others = [{ x: 0, y: 0, w: 100, h: 50 }];
  it('snaps edges within the threshold and reports a guide', () => {
    const result = snapRect({ x: 4, y: 200, w: 100, h: 50 }, others);
    expect(result.x).toBe(0);
    expect(result.y).toBe(200);
    expect(result.guides).toEqual([{ axis: 'x', pos: 0, from: 0, to: 250 }]);
  });
  it('snaps centers', () => {
    expect(snapRect({ x: 200, y: 3, w: 100, h: 50 }, others).y).toBe(0);
    expect(snapRect({ x: 23, y: 300, w: 60, h: 20 }, others).x).toBe(20);
  });
  it('ignores far rects', () => {
    expect(snapRect({ x: 30, y: 300, w: 10, h: 10 }, others)).toEqual({ x: 30, y: 300, guides: [] });
  });
});

describe('clipboard', () => {
  const model = build([
    { op: 'add_group', id: 'G', color: 'blue' },
    { op: 'add_node', id: 'API', parentId: 'G', icon: 'server' },
    { op: 'add_node', id: 'DB', parentId: 'G', shape: 'cylinder' },
    { op: 'add_node', id: 'Out' },
    { op: 'connect', from: 'API', to: 'DB', label: 'SQL' },
    { op: 'connect', from: 'API', to: 'Out' },
  ]);
  const layout = { nodes: { API: { x: 0, y: 0 }, DB: { x: 200, y: 0, w: 300, h: 90 }, Out: { x: 500, y: 0 } }, edges: {} };

  it('copies a group with its children and only internal edges', () => {
    const clip = copyElements(model, layout, ['G']);
    expect(clip.elements.map((el) => el.id)).toEqual(['G', 'API', 'DB']);
    expect(clip.edges.map((e) => e.id)).toEqual(['API→DB']);
  });

  it('detaches copied children from parents outside the copy', () => {
    const clip = copyElements(model, layout, ['API']);
    expect(clip.elements[0]?.parentId).toBeUndefined();
  });

  it('pastes with fresh names, offset positions and the same properties', () => {
    const { ops, positions, ids } = pasteOps(model, copyElements(model, layout, ['G']), { x: 10, y: 10 });
    const result = applyOps(model, ops);
    if (!result.ok) throw new Error(result.error.message);
    expect(ids).toEqual(['G 2', 'API 2', 'DB 2']);
    expect(result.model.elements['DB 2']).toMatchObject({ parentId: 'G 2', shape: 'cylinder' });
    expect(result.model.elements['G 2']).toMatchObject({ color: 'blue' });
    expect(result.model.edges.at(-1)).toMatchObject({ from: 'API 2', to: 'DB 2', label: 'SQL' });
    expect(positions['API 2']).toMatchObject({ x: 10, y: 10 });
  });

  it('carries explicit layout boxes only, never computed sizes', () => {
    const { ops, positions } = pasteOps(model, copyElements(model, layout, ['G']), { x: 10, y: 10 });
    expect(positions).toEqual({ 'API 2': { x: 10, y: 10 }, 'DB 2': { x: 210, y: 10, w: 300, h: 90 } });
    const result = applyOps(model, ops);
    if (!result.ok) throw new Error(result.error.message);
    const before = computeRects(model, layout);
    const after = computeRects(result.model, { nodes: { ...layout.nodes, ...positions }, edges: {} });
    expect(after['G 2']).toEqual({ ...before.G!, x: before.G!.x + 10, y: before.G!.y + 10 });
  });
});

describe('clipboard with names that are Object.prototype members', () => {
  it('never takes a box from Object.prototype when pasting', () => {
    const m = build([{ op: 'add_node', id: 'constructor' }, { op: 'add_node', id: 'toString' }]);
    const clip = copyElements(m, { nodes: { toString: { x: 5, y: 5 } }, edges: {} }, ['constructor', 'toString']);
    expect(pasteOps(m, clip, { x: 10, y: 10 }).positions).toEqual({ 'toString 2': { x: 15, y: 15 } });
  });
});
