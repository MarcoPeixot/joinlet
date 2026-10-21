import { describe, expect, it } from 'vitest';
import { locationLabel } from './catalog';
import { parseCatalog } from './catalogStorage';

const entry = { id: 'a', name: 'NORA', location: { kind: 'browser' as const, namespace: 'a' }, createdAt: 1, lastOpenedAt: 2 };

describe('workspace catalog', () => {
  it('recognizes an unmigrated store without manufacturing projects', () => {
    expect(parseCatalog(undefined)).toBeNull();
  });
  it('allows equal names while keeping distinct identities and namespaces', () => {
    const catalog = { version: 1, activeId: 'a', entries: [entry, { ...entry, id: 'b', location: { kind: 'browser', namespace: 'b' } }] };
    expect(parseCatalog(catalog)).toBe(catalog);
  });
  it('rejects duplicate ids and a missing active destination', () => {
    expect(() => parseCatalog({ version: 1, activeId: 'a', entries: [entry, entry] })).toThrow('preservados');
    expect(() => parseCatalog({ version: 1, activeId: 'missing', entries: [entry] })).toThrow('preservados');
    expect(() => parseCatalog({ version: 1, activeId: 'a', entries: [entry, { ...entry, id: 'b' }] })).toThrow('preservados');
  });
  it('rejects damaged locations and timestamps instead of replacing the catalog', () => {
    for (const altered of [{ ...entry, location: { kind: 'browser', namespace: 1 } }, { ...entry, lastOpenedAt: NaN }]) {
      expect(() => parseCatalog({ version: 1, activeId: 'a', entries: [altered] })).toThrow();
    }
  });
  it('reports where the project is stored', () => {
    expect(locationLabel(entry.location)).toBe('Neste navegador');
    expect(locationLabel({ kind: 'repository', root: '/repo' })).toBe('/repo/.arch');
  });
});
