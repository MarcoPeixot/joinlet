import { describe, expect, it } from 'vitest';
import { boundsFitViewport } from './fitView';

describe('boundsFitViewport', () => {
  const box = { x: 100, y: 100, w: 200, h: 100 };
  it('is true when everything is inside the visible area', () => {
    expect(boundsFitViewport(box, [0, 0, 1], 800, 600)).toBe(true);
  });
  it('is false when panned or zoomed so a part is outside', () => {
    expect(boundsFitViewport(box, [-150, 0, 1], 800, 600)).toBe(false);
    expect(boundsFitViewport(box, [0, 0, 4], 800, 600)).toBe(false);
    expect(boundsFitViewport(box, [0, 0, 1], 250, 600)).toBe(false);
  });
  it('an empty diagram fits; an unmeasured pane does not', () => {
    expect(boundsFitViewport(null, [0, 0, 1], 800, 600)).toBe(true);
    expect(boundsFitViewport(box, [0, 0, 1], 0, 0)).toBe(false);
  });
});
