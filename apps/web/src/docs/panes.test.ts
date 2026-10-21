import { describe, expect, it } from 'vitest';
import { reconcilePanes } from './panes';

describe('document pane navigation', () => {
  const source = {};
  const state = { source, slugs: ['a', 'b'], active: 0 };
  it('focuses an already open document without replacing either slot', () => {
    expect(reconcilePanes(state, 'b', ['a', 'b', 'c'], source)).toEqual({ ...state, active: 1 });
    expect(reconcilePanes(state, 'a', ['a', 'b'], source)).toBe(state);
  });
  it('opens sidebar navigation in the active slot', () => {
    expect(reconcilePanes({ ...state, active: 1 }, 'c', ['a', 'b', 'c'], source).slugs).toEqual(['a', 'c']);
  });
  it('drops a deleted inactive pane and resets across workspaces', () => {
    expect(reconcilePanes(state, 'a', ['a'], source).slugs).toEqual(['a']);
    expect(reconcilePanes(state, 'c', ['a', 'b', 'c'], {}).slugs).toEqual(['c']);
  });
});
