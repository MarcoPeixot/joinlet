import { applyOps, computeRects, emptyModel } from '@strukt/core';
import type { DiagramOp, LayoutState } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { dropPreview, emptiedGroups } from './dropPreview';

function model(ops: DiagramOp[]) {
  const r = applyOps(emptyModel(), ops);
  if (!r.ok) throw new Error(r.error.message);
  return r.model;
}

describe('dropPreview', () => {
  const base = model([
    { op: 'add_group', id: 'Outer' },
    { op: 'add_group', id: 'G', parentId: 'Outer' },
    { op: 'add_node', id: 'In', parentId: 'G' },
    { op: 'add_node', id: 'N' },
  ]);
  const at = (x: number, y: number): LayoutState => ({ nodes: { In: { x: 100, y: 100 }, N: { x, y } }, edges: {} });

  it('names the group a drop would put the element in, drawn as it will be after the drop', () => {
    const layout = at(150, 110);
    const preview = dropPreview(base, layout, {}, 'N')!;
    expect(preview.target).toBe('G');
    const dropped = computeRects(model([
      { op: 'add_group', id: 'Outer' }, { op: 'add_group', id: 'G', parentId: 'Outer' },
      { op: 'add_node', id: 'In', parentId: 'G' }, { op: 'add_node', id: 'N', parentId: 'G' },
    ]), layout);
    expect(preview.frames).toEqual({ G: dropped.G, Outer: dropped.Outer });
  });

  it('is nothing when the drop keeps the element where it is', () => {
    expect(dropPreview(base, at(900, 900), {}, 'N')).toEqual({ target: null, frames: {} });
    expect(dropPreview(base, { nodes: { In: { x: 110, y: 100 }, N: { x: 900, y: 900 } }, edges: {} }, {}, 'In')).toEqual({ target: 'G', frames: {} });
  });

  it('shrinks the group an element leaves to the size it will have without it', () => {
    const two = model([
      { op: 'add_group', id: 'G' }, { op: 'add_node', id: 'A', parentId: 'G' }, { op: 'add_node', id: 'B', parentId: 'G' },
    ]);
    const before: LayoutState = { nodes: { A: { x: 0, y: 0 }, B: { x: 0, y: 150 } }, edges: {} };
    const pinned = { G: computeRects(two, before).G! };
    const out: LayoutState = { nodes: { A: { x: 0, y: 0 }, B: { x: 900, y: 900 } }, edges: {} };
    const preview = dropPreview(two, out, pinned, 'B')!;
    expect(preview.target).toBeNull();
    const alone = model([{ op: 'add_group', id: 'G' }, { op: 'add_node', id: 'A', parentId: 'G' }, { op: 'add_node', id: 'B' }]);
    expect(preview.frames.G).toEqual(computeRects(alone, out).G);
    expect(preview.frames.G!.h).toBeLessThan(pinned.G.h);
  });

  it('once out, takes the element back only at the border it shrank to, not the one it had', () => {
    const two = model([
      { op: 'add_group', id: 'G' }, { op: 'add_node', id: 'A', parentId: 'G' }, { op: 'add_node', id: 'B', parentId: 'G' },
    ]);
    const start: LayoutState = { nodes: { A: { x: 0, y: 0 }, B: { x: 0, y: 200 } }, edges: {} };
    const pinned = { G: computeRects(two, start).G! };
    const shrunk = computeRects(model([{ op: 'add_group', id: 'G' }, { op: 'add_node', id: 'A', parentId: 'G' }, { op: 'add_node', id: 'B' }]), start).G!;
    // B's top edge between the shrunk bottom border and the original one.
    const between: LayoutState = { nodes: { A: { x: 0, y: 0 }, B: { x: 0, y: shrunk.y + shrunk.h + 20 } }, edges: {} };
    expect(between.nodes.B!.y).toBeLessThan(pinned.G.y + pinned.G.h);
    expect(dropPreview(two, between, pinned, 'B', 'G')!.target).toBe('G'); // still in: judged at its starting size
    expect(dropPreview(two, between, pinned, 'B', null)!.target).toBeNull(); // already out: judged at its new size
    const touching: LayoutState = { nodes: { A: { x: 0, y: 0 }, B: { x: 0, y: shrunk.y + shrunk.h } }, edges: {} };
    expect(dropPreview(two, touching, pinned, 'B', null)!.target).toBe('G');
  });

  it('keeps a group the element leaves empty where it was, at its size', () => {
    const pinned = computeRects(base, at(900, 900));
    const preview = dropPreview(base, { nodes: { In: { x: 700, y: 700 }, N: { x: 900, y: 900 } }, edges: {} }, { G: pinned.G!, Outer: pinned.Outer! }, 'In')!;
    expect(preview.frames.G).toEqual(pinned.G);
  });

  it('takes the element in as soon as its box touches the group, and lets go once it no longer does', () => {
    const layout = (x: number): LayoutState => ({ nodes: { In: { x: 100, y: 100 }, N: { x, y: 110 } }, edges: {} });
    const g = computeRects(base, layout(900)).G!;
    const outer = computeRects(base, layout(900)).Outer!;
    // Just past G's right border (and inside Outer's padding): touching G, so G takes it in.
    expect(dropPreview(base, layout(g.x + g.w - 2), {}, 'N', null)!.target).toBe('G');
    // Clear of G but still touching Outer: Outer holds it.
    expect(dropPreview(base, layout(outer.x + outer.w - 2), {}, 'N', null)!.target).toBe('Outer');
    // Clear of everything: back at the top level.
    expect(dropPreview(base, layout(outer.x + outer.w + 20), {}, 'N', null)!.target).toBeNull();
  });

  it('keeps the group it is in for a few pixels past the border, so the edge never flickers', () => {
    const layout = (x: number): LayoutState => ({ nodes: { In: { x: 100, y: 100 }, N: { x, y: 110 } }, edges: {} });
    const outer = computeRects(base, layout(900)).Outer!;
    const justOff = outer.x + outer.w + 3;
    expect(dropPreview(base, layout(justOff), {}, 'N', 'Outer')!.target).toBe('Outer');
    expect(dropPreview(base, layout(justOff), {}, 'N', null)!.target).toBeNull();
  });

  it('counts a group emptied only when nothing it holds stays inside it', () => {
    expect(emptiedGroups(base, new Map([['In', null]]))).toEqual(['G']); // Outer still holds G, kept in place
    expect(emptiedGroups(base, new Map([['In', 'Outer']]))).toEqual(['G']);
    expect(emptiedGroups(base, new Map([['N', 'G']]))).toEqual([]);
  });

  it('decides from the rects without the preview, so leaving the grown group lets go of it', () => {
    const layout = at(150, 110);
    const grown = dropPreview(base, layout, {}, 'N')!.frames;
    expect(dropPreview(base, at(900, 900), grown, 'N')?.target).toBeNull();
  });
});
