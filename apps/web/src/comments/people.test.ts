import { describe, expect, it } from 'vitest';
import { mentionCandidates, rememberPeople, remembered } from './people';

const store = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
};

describe('who can be mentioned', () => {
  it('lists who is in the room, then who commented before and who was seen earlier; never yourself, once each', () => {
    const list = mentionCandidates({
      present: [{ name: 'Bia', color: '#c75c8f' }, { name: 'Eu', color: '#3972dc' }],
      authors: [{ name: 'bia', color: '#111111' }, { name: 'Cadu', color: '#319b77' }],
      seen: [{ name: 'Dani', color: '#a572d4' }, { name: 'Cadu', color: '#000000' }],
      self: 'eu',
    });
    expect(list).toEqual([
      { name: 'Bia', color: '#c75c8f', here: true }, { name: 'Cadu', color: '#319b77', here: false }, { name: 'Dani', color: '#a572d4', here: false },
    ]);
  });

  it('filters by what was typed after the @, ignoring case and accents, the name\'s start first', () => {
    const base = { present: [], authors: [{ name: 'Ana Luiza', color: '#3972dc' }, { name: 'Luana', color: '#c75c8f' }, { name: 'João', color: '#319b77' }], seen: [], self: '' };
    expect(mentionCandidates({ ...base, query: 'lu' }).map((p) => p.name)).toEqual(['Luana', 'Ana Luiza']);
    expect(mentionCandidates({ ...base, query: 'JOAO' }).map((p) => p.name)).toEqual(['João']);
    expect(mentionCandidates({ ...base, query: 'zz' })).toEqual([]);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ name: `Pessoa ${i}`, color: '#3972dc' }));
    expect(mentionCandidates({ present: [], authors: many, seen: [], self: '' }).length).toBeLessThanOrEqual(50);
  });
});

describe('people seen before', () => {
  it('remembers the last names seen in the room, newest first, and survives broken storage', () => {
    const storage = store();
    rememberPeople(storage, [{ name: 'Ana', color: '#3972dc' }]);
    rememberPeople(storage, [{ name: 'Bia', color: '#c75c8f' }, { name: 'ana', color: '#3972dc' }]);
    expect(remembered(storage).map((p) => p.name)).toEqual(['Bia', 'ana']);
    storage.setItem('strukt:people', '{nope');
    expect(remembered(storage)).toEqual([]);
    expect(remembered({ getItem: () => { throw new Error('blocked'); }, setItem: () => {} })).toEqual([]);
  });

  it('keeps at most 30 and never stores a hostile record', () => {
    const storage = store();
    rememberPeople(storage, Array.from({ length: 45 }, (_, i) => ({ name: `P${i}`, color: '#3972dc' })));
    expect(remembered(storage)).toHaveLength(30);
    storage.setItem('strukt:people', JSON.stringify([{ name: '__proto__', color: '#3972dc' }, { name: 'x'.repeat(100), color: '#3972dc' }, { name: 'Ok', color: 'red' }, { name: 'Bom', color: '#3972dc' }]));
    expect(remembered(storage).map((p) => p.name)).toEqual(['Bom']);
  });
});
