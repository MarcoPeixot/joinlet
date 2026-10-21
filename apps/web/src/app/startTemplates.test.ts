import { describe, expect, it } from 'vitest';
import type { DiagramTemplate } from '@strukt/workspace';
import { pickStartTemplates } from './startTemplates';

const t = (id: string, category?: string): DiagramTemplate => ({ id, title: id, description: '', category, ops: [] });

describe('pickStartTemplates', () => {
  it('takes one template per category first, then fills in order', () => {
    const all = [t('a1', 'A'), t('a2', 'A'), t('b1', 'B'), t('c1', 'C'), t('a3', 'A')];
    expect(pickStartTemplates(all, 4).map((x) => x.id)).toEqual(['a1', 'b1', 'c1', 'a2']);
  });
  it('works with templates that have no category', () => {
    const all = [t('x'), t('y'), t('z')];
    expect(pickStartTemplates(all, 2).map((x) => x.id)).toEqual(['x', 'y']);
  });
  it('returns everything when the list is shorter than the limit, and nothing for an empty list', () => {
    expect(pickStartTemplates([t('only', 'A')], 4)).toHaveLength(1);
    expect(pickStartTemplates([], 4)).toEqual([]);
  });
  it('never returns the same template twice', () => {
    const all = [t('a', 'A'), t('b', 'A')];
    const ids = pickStartTemplates(all, 4).map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('puts the preferred ids first, in the given order, ignoring ids that do not exist', () => {
    const all = [t('a1', 'A'), t('b1', 'B'), t('c1', 'C'), t('d1', 'D')];
    expect(pickStartTemplates(all, 3, ['c1', 'ghost', 'a1']).map((x) => x.id)).toEqual(['c1', 'a1', 'b1']);
  });
});
