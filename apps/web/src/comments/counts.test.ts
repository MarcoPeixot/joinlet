import { applyCommentOp, emptyComments, newThread } from '@strukt/workspace';
import type { CommentsFile } from '@strukt/workspace';
import { describe, expect, it } from 'vitest';
import { commentCounts, describeCounts } from './counts';

const bia = { name: 'Bia', color: '#c75c8f' };
const file = (...texts: Array<[string, string[]?]>): CommentsFile => texts.reduce((acc, [text, mentions], index) => applyCommentOp(acc, { op: 'thread', thread: newThread({ id: `t${index}`, anchor: { type: 'node', id: 'API' }, message: { id: `m${index}`, owner: 'i:bia', author: bia, text, at: 1000 + index, ...(mentions ? { mentions } : {}) } }) }), emptyComments());
const ana = { name: 'Ana Souza', owner: 'i:ana' };

describe('commentCounts', () => {
  it('counts the open conversations here, and what mentions you here and in the other items', () => {
    const state = { file: file(['a'], ['@Ana Souza', ['Ana Souza']]), target: { kind: 'diagram' as const, slug: 'mapa' }, summary: { 'diagram:mapa': { open: 99, mentions: 99, fresh: 99 }, 'doc:adr': { open: 1, mentions: 2, fresh: 1 } } };
    expect(commentCounts(state, ana)).toEqual({ open: 2, mentions: 3 });
  });
  it('resolved conversations are not open, and with no item open only the others count', () => {
    const resolved = applyCommentOp(file(['a'], ['@Ana Souza', ['Ana Souza']]), { op: 'status', thread: 't1', status: 'resolved', by: bia, at: 5000 });
    expect(commentCounts({ file: resolved, target: { kind: 'doc', slug: 'x' }, summary: {} }, ana)).toEqual({ open: 1, mentions: 0 });
    expect(commentCounts({ file: emptyComments(), target: null, summary: { 'doc:adr': { open: 1, mentions: 2, fresh: 0 } } }, ana)).toEqual({ open: 0, mentions: 2 });
  });
});

describe('describeCounts', () => {
  it('says what there is, mentions first, and nothing when there is nothing', () => {
    expect(describeCounts({ open: 0, mentions: 0 })).toBe('');
    expect(describeCounts({ open: 1, mentions: 0 })).toBe('1 conversa aberta');
    expect(describeCounts({ open: 3, mentions: 1 })).toBe('1 menção para você, 3 conversas abertas');
    expect(describeCounts({ open: 0, mentions: 2 })).toBe('2 menções para você');
  });
});
