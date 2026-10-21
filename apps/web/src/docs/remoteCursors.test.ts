import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { resolveCursors, selectionPresence } from './remoteCursors';
import type { Collaborator } from '../workspace/collaboration';

const peer = (name: string, doc?: { anchor: number; head: number }, ytext?: Y.Text): Collaborator => ({
  id: name,
  name,
  color: '#3972dc',
  cid: `${name.toLowerCase()}-123456`,
  ...(doc && ytext ? { state: { doc: selectionPresence(ytext, doc.anchor, doc.head) } } : {}),
});

function room(text = 'olá mundo') {
  const doc = new Y.Doc();
  const ytext = doc.getText('content');
  ytext.insert(0, text);
  return { doc, ytext };
}

describe('resolveCursors', () => {
  it('turns relative positions into the current offsets', () => {
    const { ytext } = room();
    expect(resolveCursors([peer('Ana', { anchor: 2, head: 6 }, ytext)], ytext)).toEqual([{ from: 2, to: 6, name: 'Ana', color: '#3972dc' }]);
  });

  it('follows concurrent edits: the cursor stays on the same text', () => {
    const { ytext } = room();
    const ana = peer('Ana', { anchor: 4, head: 4 }, ytext);
    ytext.insert(0, 'XX');
    expect(resolveCursors([ana], ytext)).toEqual([{ from: 6, to: 6, name: 'Ana', color: '#3972dc' }]);
  });

  it('orders a backwards selection and skips people with no document selection or a position from another type', () => {
    const { doc, ytext } = room();
    expect(resolveCursors([peer('Ana', { anchor: 6, head: 2 }, ytext), peer('Bia')], ytext)).toEqual([{ from: 2, to: 6, name: 'Ana', color: '#3972dc' }]);
    const other = doc.getText('outro');
    other.insert(0, 'abc');
    expect(resolveCursors([peer('Cris', { anchor: 1, head: 2 }, other)], ytext)).toEqual([]);
  });

  it('survives garbage state and clamps to the text', () => {
    const { ytext } = room('abc');
    const bad: Collaborator = { id: 'x', name: 'X', color: '#3972dc', state: { doc: { anchor: { item: { client: 1, clock: 999 }, assoc: 0 }, head: { tname: 'content', assoc: 0 } } } };
    const result = resolveCursors([bad], ytext);
    for (const cursor of result) { expect(cursor.from).toBeGreaterThanOrEqual(0); expect(cursor.to).toBeLessThanOrEqual(3); }
  });
});
