import { describe, expect, it } from 'vitest';
import type { Command } from '../actions/commands';
import { fuzzyScore, matchesQuery, paletteGroups } from './commandSearch';

describe('matchesQuery', () => {
  it('matches across punctuation: "cores forte" finds "Cores: Forte"', () => {
    expect(matchesQuery('Cores: Forte', 'cores forte')).toBe(true);
  });

  it('matches token prefixes: "exp svg" finds "Exportar SVG"', () => {
    expect(matchesQuery('Exportar SVG', 'exp svg')).toBe(true);
  });

  it('is accent-insensitive both ways', () => {
    expect(matchesQuery('Aquarela', 'aquarela')).toBe(true);
    expect(matchesQuery('Título', 'titulo')).toBe(true);
    expect(matchesQuery('Titulo', 'título')).toBe(true);
  });

  it('matches everything on an empty query', () => {
    expect(matchesQuery('Cores: Forte', '')).toBe(true);
    expect(matchesQuery('Cores: Forte', '   ')).toBe(true);
  });

  it('rejects a query whose tokens do not all prefix-match', () => {
    expect(matchesQuery('Cores: Forte', 'cores pastel')).toBe(false);
    expect(matchesQuery('Cores: Forte', 'xyz')).toBe(false);
  });
});

describe('fuzzyScore', () => {
  it('matches subsequences, case and diacritics insensitive', () => {
    expect(fuzzyScore('Exportar SVG', 'exsvg')).not.toBeNull();
    expect(fuzzyScore('Configurações', 'CONFIGURACOES')).not.toBeNull();
    expect(fuzzyScore('Título', 'tit')).not.toBeNull();
  });
  it('rejects when the letters are not in order', () => {
    expect(fuzzyScore('Exportar SVG', 'gvs')).toBeNull();
    expect(fuzzyScore('Desfazer', 'xyz')).toBeNull();
  });
  it('empty query matches with the same score for everything', () => {
    expect(fuzzyScore('Desfazer', '')).toBe(fuzzyScore('Refazer', '  '));
    expect(fuzzyScore('Desfazer', '')).not.toBeNull();
  });
  it('ranks contiguous and word-start matches above scattered ones', () => {
    const contiguous = fuzzyScore('Exportar SVG', 'exp')!;
    const scattered = fuzzyScore('Editar xml por completo', 'exp')!;
    expect(contiguous).toBeGreaterThan(scattered);
  });
  it('never throws on regex-looking or odd input', () => {
    for (const query of ['(', '[', '\\', '.*', '(?<a>', '\u0000', 'a'.repeat(500), '🙂', '$^']) {
      expect(() => fuzzyScore('Exportar (SVG) [x] \\', query)).not.toThrow();
    }
    expect(fuzzyScore('Exportar (SVG)', '(')).toBe(0);
    expect(fuzzyScore('Exportar (SVG)', 'zz(')).toBeNull();
  });
});

const cmd = (id: string, title: string, section: Command['section']): Command => ({ id, title, section, run: () => {} });
const SAMPLE = [
  cmd('a', 'Adicionar nó', 'Ações'),
  cmd('b', 'Diagrama: API', 'Ir para'),
  cmd('c', 'Cores: Forte', 'Aparência'),
  cmd('d', 'Editar com IA', 'IA'),
  cmd('e', 'Duplicar seleção', 'Ações'),
];

describe('paletteGroups', () => {
  it('groups by section in canonical order and keeps command order', () => {
    const groups = paletteGroups(SAMPLE, '', []);
    expect(groups.map((g) => g.label)).toEqual(['Ações', 'Ir para', 'Aparência', 'IA']);
    expect(groups[0]!.items.map((c) => c.id)).toEqual(['a', 'e']);
  });
  it('puts Recentes first when there are any, and skips unknown ids', () => {
    const groups = paletteGroups(SAMPLE, '', ['d', 'zzz', 'a']);
    expect(groups[0]!.label).toBe('Recentes');
    expect(groups[0]!.items.map((c) => c.id)).toEqual(['d', 'a']);
  });
  it('filters and hides Recentes and empty sections while searching', () => {
    const groups = paletteGroups(SAMPLE, 'dup', ['d']);
    expect(groups.map((g) => g.label)).toEqual(['Ações']);
    expect(groups[0]!.items.map((c) => c.id)).toEqual(['e']);
  });
  it('ranks within a section and is stable for equal scores', () => {
    const list = [cmd('1', 'Abrir x', 'Ações'), cmd('2', 'Abrir y', 'Ações'), cmd('3', 'Abrir z', 'Ações')];
    expect(paletteGroups(list, 'abrir', [])[0]!.items.map((c) => c.id)).toEqual(['1', '2', '3']);
  });
  it('survives hostile queries', () => {
    expect(() => paletteGroups(SAMPLE, '([\\', [])).not.toThrow();
    expect(paletteGroups(SAMPLE, 'zz([\\', [])).toEqual([]);
  });
});
