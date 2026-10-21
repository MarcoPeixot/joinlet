import { describe, expect, it } from 'vitest';
import { compact, flip } from './edit';

describe('compact', () => {
  it('drops empty lists and defaults', () => {
    expect(compact({ id: 'a', name: 'A', description: '', tags: [], levels: [], include: [], hide: [], collapsed: [], mode: 'hide', collapse: false })).toEqual({ id: 'a', name: 'A' });
  });

  it('keeps what is set', () => {
    const full = { id: 'a', name: 'A', description: 'd', tags: ['x:y'], levels: ['container' as const], include: ['N'], hide: ['M'], collapsed: ['G'], mode: 'dim' as const, collapse: true };
    expect(compact(full)).toEqual(full);
  });

  it('does not change what it was given', () => {
    const input = { id: 'a', name: 'A', tags: [] };
    compact(input);
    expect(input).toEqual({ id: 'a', name: 'A', tags: [] });
  });
});

describe('flip', () => {
  it('adds and removes, without mutating', () => {
    const list = ['a'];
    expect(flip(list, 'b')).toEqual(['a', 'b']);
    expect(flip(list, 'a')).toEqual([]);
    expect(flip(undefined, 'x')).toEqual(['x']);
    expect(list).toEqual(['a']);
  });
});
