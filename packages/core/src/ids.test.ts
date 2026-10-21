import { describe, expect, it } from 'vitest';
import { connectorStyle } from './connector';
import { edgeId, uniqueName } from './ids';
import { levenshtein, suggest } from './suggest';

describe('uniqueName', () => {
  it('returns the base when free and numbers collisions', () => {
    const taken = new Set(['API', 'API 2']);
    expect(uniqueName('DB', (n) => taken.has(n))).toBe('DB');
    expect(uniqueName('API', (n) => taken.has(n))).toBe('API 3');
    expect(uniqueName('API 2', (n) => taken.has(n))).toBe('API 3');
    expect(uniqueName('  ', () => false)).toBe('Nó');
  });
});

describe('edgeId', () => {
  it('derives from endpoints and numbers duplicates', () => {
    expect(edgeId('A', 'B', new Set())).toBe('A→B');
    expect(edgeId('A', 'B', new Set(['A→B']))).toBe('A→B#2');
  });
});

describe('suggest', () => {
  it('finds close names case-insensitively', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(suggest('databse', ['Database', 'Queue'])).toEqual(['Database']);
    expect(suggest('zzz', ['Database'])).toEqual([]);
  });
});

describe('connectorStyle', () => {
  it('maps Eraser connectors', () => {
    expect(connectorStyle('>')).toEqual({ dashed: false, startArrow: false, endArrow: true });
    expect(connectorStyle('<>')).toEqual({ dashed: false, startArrow: true, endArrow: true });
    expect(connectorStyle('-->')).toEqual({ dashed: true, startArrow: false, endArrow: true });
    expect(connectorStyle('-')).toEqual({ dashed: false, startArrow: false, endArrow: false });
  });
});
