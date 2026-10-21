import { describe, expect, it } from 'vitest';
import { applyCommentOp, newThread } from './comments';
import type { CommentAuthor, CommentsFile } from './comments';
import { commentParticipants, findMentions, isMentioned, mentionsFor, normalizeName } from './commentMentions';

const ANA: CommentAuthor = { name: 'Ana Souza', color: '#3972dc' };
const BIA: CommentAuthor = { name: 'Bia', color: '#c75c8f' };

describe('normalizeName', () => {
  it('ignores case, accents and repeated spaces', () => {
    expect(normalizeName('  José   da  SILVA ')).toBe('jose da silva');
    expect(normalizeName('Ana Souza')).toBe(normalizeName('ana  souza'));
  });
});

describe('findMentions', () => {
  const people = ['Ana', 'Ana Souza', 'Bia', 'José Luís'];

  it('finds @Name among who is (or was) in the room, as the name is written there', () => {
    expect(findMentions('Oi @Bia, olha isso', people)).toEqual(['Bia']);
    expect(findMentions('@bia e @JOSE LUIS', people)).toEqual(['Bia', 'José Luís']);
  });

  it('prefers the longest name, and does not mistake a longer word for a short name', () => {
    expect(findMentions('@Ana Souza vê isso', people)).toEqual(['Ana Souza']);
    expect(findMentions('@Ana vê isso', people)).toEqual(['Ana']);
    expect(findMentions('@Anabela vê isso', people)).toEqual([]);
    expect(findMentions('@Bianca', people)).toEqual([]);
  });

  it('ignores an @ inside a word (an e-mail), and names nobody has', () => {
    expect(findMentions('fale com bia@empresa.com', people)).toEqual([]);
    expect(findMentions('@Zeca e @', people)).toEqual([]);
  });

  it('counts a person once and handles punctuation and the end of the text', () => {
    expect(findMentions('@Bia, @Bia! (@Bia)', people)).toEqual(['Bia']);
    expect(findMentions('fim @Bia', people)).toEqual(['Bia']);
    expect(findMentions('@Bia.', people)).toEqual(['Bia']);
  });

  it('is linear on hostile text', () => {
    const started = Date.now();
    findMentions('@'.repeat(100_000), people);
    findMentions(`@${'a'.repeat(100_000)}`, people);
    findMentions('@Ana '.repeat(20_000), people);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe('mentions for you', () => {
  const file = (): CommentsFile => {
    let f: CommentsFile = { version: 1, threads: [] };
    const first = newThread({ id: 't1', anchor: { type: 'node', id: 'API' }, message: { id: 'm1', owner: 'i:bia', author: BIA, text: 'Oi @Ana Souza', at: 1000, mentions: ['Ana Souza'] } });
    f = applyCommentOp(f, { op: 'thread', thread: first });
    f = applyCommentOp(f, { op: 'thread', thread: newThread({ id: 't2', anchor: { type: 'node', id: 'DB' }, message: { id: 'm2', owner: 'i:ana', author: ANA, text: 'Eu mesma @Ana Souza', at: 2000, mentions: ['Ana Souza'] } }) });
    f = applyCommentOp(f, { op: 'thread', thread: newThread({ id: 't3', anchor: { type: 'node', id: 'Web' }, message: { id: 'm3', owner: 'i:bia', author: BIA, text: 'Sem menção', at: 3000 } }) });
    return f;
  };

  it('matches a message by the normalized name, not by its own text', () => {
    const message = file().threads[0]!.messages[0]!;
    expect(isMentioned(message, 'ana souza')).toBe(true);
    expect(isMentioned(message, 'Bia')).toBe(false);
    expect(isMentioned(message, '')).toBe(false);
  });

  it('lists open conversations that others opened to mention you, never your own message', () => {
    const { threads, fresh } = mentionsFor(file(), 'ANA SOUZA', 'i:ana');
    expect(threads.map((thread) => thread.id)).toEqual(['t1']);
    expect(fresh).toBe(1);
  });

  it('counts as fresh only what is newer than the last time you looked', () => {
    expect(mentionsFor(file(), 'Ana Souza', 'i:ana', 1000).fresh).toBe(0);
    expect(mentionsFor(file(), 'Ana Souza', 'i:ana', 999).fresh).toBe(1);
  });

  it('leaves out resolved and deleted conversations, and deleted messages', () => {
    const resolved = applyCommentOp(file(), { op: 'status', thread: 't1', status: 'resolved', by: ANA, at: 5000 });
    expect(mentionsFor(resolved, 'Ana Souza', 'i:ana').threads).toEqual([]);
    const deleted = applyCommentOp(file(), { op: 'delete', thread: 't1', at: 5000 });
    expect(mentionsFor(deleted, 'Ana Souza', 'i:ana').threads).toEqual([]);
  });

  it('lists everyone who wrote, with their latest name and color, for the mention picker', () => {
    const people = commentParticipants(file());
    expect(people).toEqual([{ name: 'Ana Souza', color: '#3972dc' }, { name: 'Bia', color: '#c75c8f' }]);
  });
});
