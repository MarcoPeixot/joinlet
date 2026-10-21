import { describe, expect, it } from 'vitest';
import { SHORTCUT_GROUPS, filterShortcuts } from './shortcuts';

describe('filterShortcuts', () => {
  it('keeps every group when there is no query', () => {
    expect(filterShortcuts('')).toEqual(SHORTCUT_GROUPS);
  });

  it('matches labels ignoring case and accents, and drops empty groups', () => {
    const found = filterShortcuts('DESFAZER');
    expect(found.map((g) => g.title)).toEqual(['Edição']);
    expect(found[0]!.items.map((i) => i.label)).toEqual(['Desfazer']);
    expect(filterShortcuts('SELEÇÃO').flatMap((g) => g.items.map((i) => i.label))).toContain('Agrupar seleção / novo grupo');
  });

  it('matches the keys too', () => {
    expect(filterShortcuts('⌘K').flatMap((g) => g.items.map((i) => i.keys))).toContain('⌘K');
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(filterShortcuts('zzz')).toEqual([]);
  });
});
