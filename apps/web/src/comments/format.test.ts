import { emptyModel } from '@strukt/core';
import type { DiagramModel } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { anchorLabel, relativeTime, splitMentions } from './format';

const NOW = Date.parse('2026-10-03T12:00:00.000Z');

describe('relativeTime', () => {
  it('speaks in the unit that fits, in Portuguese', () => {
    expect(relativeTime(NOW - 5_000, NOW)).toBe('agora');
    expect(relativeTime(NOW - 90_000, NOW)).toBe('há 1 min');
    expect(relativeTime(NOW - 12 * 60_000, NOW)).toBe('há 12 min');
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe('há 3 h');
    expect(relativeTime(NOW - 30 * 3_600_000, NOW)).toBe('ontem');
    expect(relativeTime(NOW - 4 * 86_400_000, NOW)).toBe('há 4 dias');
    expect(relativeTime(NOW - 40 * 86_400_000, NOW)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
  it('a clock a little ahead still reads as now', () => {
    expect(relativeTime(NOW + 30_000, NOW)).toBe('agora');
  });
});

describe('splitMentions', () => {
  it('marks the names that were mentioned, and nothing else, without losing a character', () => {
    const parts = splitMentions('Oi @Ana Souza e @bia, e @Zeca não', ['Ana Souza', 'Bia']);
    expect(parts).toEqual([
      { text: 'Oi ' }, { text: '@Ana Souza', mention: true }, { text: ' e ' }, { text: '@bia', mention: true }, { text: ', e @Zeca não' },
    ]);
    expect(parts.map((part) => part.text).join('')).toBe('Oi @Ana Souza e @bia, e @Zeca não');
  });
  it('leaves plain text, and text with markup, as text', () => {
    expect(splitMentions('sem menção', [])).toEqual([{ text: 'sem menção' }]);
    expect(splitMentions('<b>@Ana</b> & co', ['Ana'])).toEqual([{ text: '<b>' }, { text: '@Ana', mention: true }, { text: '</b> & co' }]);
    expect(splitMentions('', ['Ana'])).toEqual([]);
  });
  it('does not mark an @ inside a word', () => {
    expect(splitMentions('ana@ana.com', ['Ana'])).toEqual([{ text: 'ana@ana.com' }]);
  });
});

describe('anchorLabel', () => {
  const model: DiagramModel = { ...emptyModel(), elements: { API: { kind: 'node', id: 'API', label: 'API de Pagamentos' } as never, DB: { kind: 'node', id: 'DB' } as never }, order: ['API', 'DB'], edges: [{ id: 'e1', from: 'API', to: 'DB', connector: 'arrow' } as never] };
  it('names a node by its label, an edge by its ends, a point and a passage', () => {
    expect(anchorLabel({ type: 'node', id: 'API' }, model)).toEqual({ text: 'API de Pagamentos', orphan: false, icon: 'node' });
    expect(anchorLabel({ type: 'node', id: 'DB' }, model)).toEqual({ text: 'DB', orphan: false, icon: 'node' });
    expect(anchorLabel({ type: 'edge', id: 'e1' }, model)).toEqual({ text: 'API de Pagamentos → DB', orphan: false, icon: 'edge' });
    expect(anchorLabel({ type: 'point', x: 1, y: 2 }, model)).toEqual({ text: 'Ponto do canvas', orphan: false, icon: 'point' });
    expect(anchorLabel({ type: 'text', quote: 'um trecho citado', prefix: '', suffix: '', from: 0 }, null)).toEqual({ text: '“um trecho citado”', orphan: false, icon: 'text' });
  });
  it('says so when the node or connection is gone, and cuts a long quote', () => {
    expect(anchorLabel({ type: 'node', id: 'Fantasma' }, model)).toEqual({ text: 'Fantasma', orphan: true, icon: 'node', note: 'elemento removido' });
    expect(anchorLabel({ type: 'edge', id: 'x' }, model)).toMatchObject({ orphan: true, note: 'conexão removida' });
    expect(anchorLabel({ type: 'text', quote: 'a'.repeat(200), prefix: '', suffix: '', from: 0 }, null).text.length).toBeLessThanOrEqual(62);
  });
  it('never reads a name like constructor from the prototype', () => {
    expect(anchorLabel({ type: 'node', id: 'constructor' }, model)).toMatchObject({ orphan: true });
    expect(anchorLabel({ type: 'edge', id: 'toString' }, model)).toMatchObject({ orphan: true });
  });
});
