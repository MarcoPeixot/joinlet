import { newThread, textAnchor } from '@strukt/workspace';
import { describe, expect, it } from 'vitest';
import { resolveDocThreads } from './docRanges';

const author = { name: 'Ana', color: '#3972dc' };
const thread = (id: string, doc: string, passage: string) => {
  const from = doc.indexOf(passage);
  return newThread({ id, anchor: textAnchor(doc, from, from + passage.length), message: { id: `${id}m`, owner: 'i:a', author, text: 'oi', at: 1 } });
};

describe('resolveDocThreads', () => {
  const doc = 'Primeiro parágrafo sobre pagamentos.\n\nSegundo parágrafo sobre cobrança e faturas.\n';
  it('follows each passage through an edit, and reports the one that is gone', () => {
    const threads = [thread('a', doc, 'pagamentos'), thread('b', doc, 'cobrança e faturas')];
    const edited = `Um título novo\n\n${doc.replace('cobrança e faturas', 'outra coisa')}`;
    const found = resolveDocThreads(edited, threads);
    expect(edited.slice(found.get('a')!.from, found.get('a')!.to)).toBe('pagamentos');
    expect(found.get('b')).toBeNull();
  });
  it('ignores anchors that are not passages of a doc', () => {
    const node = newThread({ id: 'n', anchor: { type: 'node', id: 'API' }, message: { id: 'nm', owner: 'i:a', author, text: 'oi', at: 1 } });
    expect(resolveDocThreads(doc, [node]).size).toBe(0);
  });
});
