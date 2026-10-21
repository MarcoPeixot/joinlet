import { applyCommentOp, newThread } from '@strukt/workspace';
import type { CommentThread } from '@strukt/workspace';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommentText, activityOf, mentionsYou } from './ThreadCard';

const ana = { name: 'Ana Souza', color: '#3972dc' };
const bia = { name: 'Bia', color: '#c75c8f' };
const base = (text: string, mentions?: string[]): CommentThread => newThread({
  id: 't1', anchor: { type: 'node', id: 'API' }, message: { id: 'm1', owner: 'i:bia', author: bia, text, at: 1000, ...(mentions ? { mentions } : {}) },
});

describe('mentionsYou', () => {
  it('is true for an open conversation where someone else mentioned you, never for your own words or a resolved one', () => {
    const thread = base('Oi @Ana Souza', ['Ana Souza']);
    expect(mentionsYou(thread, 'ana souza', 'i:ana')).toBe(true);
    expect(mentionsYou(thread, 'Ana Souza', 'i:bia')).toBe(false);
    expect(mentionsYou(base('Sem menção'), 'Ana Souza', 'i:ana')).toBe(false);
    const resolved = applyCommentOp({ version: 1, threads: [thread] }, { op: 'status', thread: 't1', status: 'resolved', by: ana, at: 2000 }).threads[0]!;
    expect(mentionsYou(resolved, 'Ana Souza', 'i:ana')).toBe(false);
  });
});

describe('activityOf', () => {
  it('is the latest thing that happened in the conversation: a message, an edit or a status change', () => {
    let file = { version: 1 as const, threads: [base('a')] };
    expect(activityOf(file.threads[0]!)).toBe(1000);
    file = applyCommentOp(file, { op: 'reply', thread: 't1', message: { id: 'm2', owner: 'i:ana', author: ana, text: 'b', at: 3000 } });
    expect(activityOf(file.threads[0]!)).toBe(3000);
    file = applyCommentOp(file, { op: 'status', thread: 't1', status: 'resolved', by: ana, at: 5000 });
    expect(activityOf(file.threads[0]!)).toBe(5000);
  });
});

describe('what a comment can inject', () => {
  it('renders the text of a comment as text, whatever it contains, and picks out the mentioned names', () => {
    const hostile = '<img src=x onerror=alert(1)> <script>alert(2)</script> [x](javascript:alert(3)) @Ana Souza';
    const message = { id: 'm', owner: 'i:bia', author: bia, text: hostile, at: 1, mentions: ['Ana Souza'] };
    const html = renderToStaticMarkup(<CommentText message={message} />);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<a ');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toMatch(/<span class="[^"]*text-accent[^"]*">@Ana Souza<\/span>/);
  });
});
