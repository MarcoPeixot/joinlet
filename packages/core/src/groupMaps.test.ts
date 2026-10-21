import { describe, expect, it } from 'vitest';
import { computeRects } from './geometry';
import { descendantsOf, topLevel } from './tree';
import { fingerprint, syntheticModels } from './testing';

const sha = (value: unknown) => fingerprint(JSON.stringify(value));

// Characterization: captured from the O(G·N) implementation, must survive the O(N) refactor unchanged.
describe.each(Object.entries(syntheticModels()))('group maps on %s', (_name, { model, layout }) => {
  it('computeRects', () => {
    const rects = computeRects(model, layout);
    expect(Object.keys(rects).length).toBe(model.order.length);
    expect(sha(model.order.map((id) => [id, rects[id]]))).toMatchSnapshot();
  });

  it('computeRects with a frozen group', () => {
    const group = model.order.find((id) => model.elements[id]?.kind === 'group');
    const rects = computeRects(model, layout, group ? { [group]: { x: 1, y: 2, w: 3, h: 4 } } : {});
    expect(sha(model.order.map((id) => [id, rects[id]]))).toMatchSnapshot();
  });

  it('descendantsOf every element', () => {
    expect(sha(model.order.map((id) => [id, descendantsOf(model, id)]))).toMatchSnapshot();
  });

  it('topLevel', () => {
    expect(sha(topLevel(model, model.order))).toMatchSnapshot();
  });
});
