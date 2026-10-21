import { describe, expect, it } from 'vitest';
import { MAX_CHATS, chatTitle, loadChats, saveChats } from './history';
import type { Chat } from './history';

const memory = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return { data, storage: { get: (key: string) => data[key] ?? null, set: (key: string, value: string) => { data[key] = value; } } };
};
const chat = (id: string, updatedAt: number, content = 'oi'): Chat => ({ id, title: chatTitle(content), updatedAt, messages: [{ id: 1, role: 'user', content }, { id: 2, role: 'assistant', content: 'olá' }] });

describe('chatTitle', () => {
  it('is the first line of the first question, cut with an ellipsis', () => {
    expect(chatTitle('  O que faz a API?\nSegunda linha ')).toBe('O que faz a API?');
    expect(chatTitle('x'.repeat(100))).toBe(`${'x'.repeat(47)}…`);
    expect(chatTitle('   ')).toBe('Nova conversa');
  });
});

describe('chat history', () => {
  it('round-trips the conversations of a workspace, newest first, apart from the others', () => {
    const { storage } = memory();
    saveChats(storage, 'a', [chat('1', 10), chat('2', 20)]);
    saveChats(storage, 'b', [chat('3', 5)]);
    expect(loadChats(storage, 'a').map((c) => c.id)).toEqual(['2', '1']);
    expect(loadChats(storage, 'b').map((c) => c.id)).toEqual(['3']);
    expect(loadChats(storage, 'c')).toEqual([]);
  });

  it('renumbers repeated message ids saved by an older version, keeping every message', () => {
    const { data, storage } = memory();
    const messages = [{ id: 1, role: 'user', content: 'Q1' }, { id: 2, role: 'assistant', content: 'R1' }, { id: 2, role: 'user', content: 'Q2' }, { id: 2, role: 'assistant', content: 'R2' }];
    data['strukt:chats:a'] = JSON.stringify([{ id: 'c1', title: 'Q1', updatedAt: 1, messages }]);
    const loaded = loadChats(storage, 'a')[0]!.messages;
    expect(loaded.map((m) => m.content)).toEqual(['Q1', 'R1', 'Q2', 'R2']);
    expect(new Set(loaded.map((m) => m.id)).size).toBe(4);
  });

  it('keeps only the latest conversations', () => {
    const { storage } = memory();
    saveChats(storage, 'a', Array.from({ length: MAX_CHATS + 5 }, (_, i) => chat(String(i), i)));
    const loaded = loadChats(storage, 'a');
    expect(loaded).toHaveLength(MAX_CHATS);
    expect(loaded[0]!.id).toBe(String(MAX_CHATS + 4));
  });

  it('drops the oldest conversations when the text is too big for the browser storage', () => {
    const { storage, data } = memory();
    const big = 'z'.repeat(60_000);
    saveChats(storage, 'a', [chat('old', 1, big), chat('mid', 2, big), chat('new', 3, big)].map((c) => ({ ...c, messages: [{ id: 1, role: 'user' as const, content: c.messages[0]!.content }] })));
    expect(data['strukt:chats:a']!.length).toBeLessThanOrEqual(150_000);
    expect(loadChats(storage, 'a').map((c) => c.id)).toEqual(['new', 'mid']);
  });

  it('never trusts what it reads: garbage, wrong shapes and unknown roles are dropped', () => {
    expect(loadChats(memory({ 'strukt:chats:a': 'not json' }).storage, 'a')).toEqual([]);
    expect(loadChats(memory({ 'strukt:chats:a': '{"x":1}' }).storage, 'a')).toEqual([]);
    const mixed = JSON.stringify([
      { id: 'ok', title: 'T', updatedAt: 1, messages: [{ id: 1, role: 'user', content: 'a' }, { id: 2, role: 'system', content: 'b' }, { id: 3, role: 'assistant', content: 7 }, { id: 4, role: 'assistant', content: 'c', interrupted: true }] },
      { id: 5, title: 'bad id', updatedAt: 1, messages: [] },
      { id: '__proto__', title: 'x', updatedAt: 1, messages: [] },
      null,
    ]);
    const loaded = loadChats(memory({ 'strukt:chats:a': mixed }).storage, 'a');
    expect(loaded.map((c) => c.id)).toEqual(['ok']);
    expect(loaded[0]!.messages).toEqual([{ id: 1, role: 'user', content: 'a' }, { id: 4, role: 'assistant', content: 'c', interrupted: true }]);
  });

  it('survives a storage that throws', () => {
    const broken = { get: () => { throw new Error('blocked'); }, set: () => { throw new Error('full'); } };
    expect(loadChats(broken, 'a')).toEqual([]);
    expect(() => saveChats(broken, 'a', [chat('1', 1)])).not.toThrow();
  });
});

describe('chat history: assistant runs', () => {
  it('keeps who ran a question and drops a malformed marker', () => {
    const { storage } = memory();
    const base = chat('1', 10);
    const run = { name: 'Auditar segurança', scope: 'workspace' as const, changes: true as const };
    saveChats(storage, 'a', [{ ...base, messages: [{ id: 1, role: 'user', content: 'x', assistant: run }, { id: 2, role: 'assistant', content: 'y' }] }]);
    expect(loadChats(storage, 'a')[0]!.messages[0]).toEqual({ id: 1, role: 'user', content: 'x', assistant: run });
    const hostile = JSON.stringify([{ id: '1', title: 't', updatedAt: 1, messages: [
      { id: 1, role: 'user', content: 'a', assistant: { name: 3, scope: 'workspace' } },
      { id: 2, role: 'user', content: 'b', assistant: { name: 'x', scope: 'galaxia' } },
      { id: 3, role: 'user', content: 'c', assistant: 'x' },
      { id: 4, role: 'user', content: 'd', assistant: { name: 'n'.repeat(300), scope: 'diagram', __proto__: { polluted: 1 } } },
      { id: 5, role: 'assistant', content: 'e', assistant: { name: 'x', scope: 'diagram' } },
    ] }]);
    const { storage: raw } = memory({ 'strukt:chats:b': hostile });
    const messages = loadChats(raw, 'b')[0]!.messages;
    expect(messages.map((m) => m.assistant)).toEqual([undefined, undefined, undefined, { name: 'n'.repeat(60), scope: 'diagram' }, undefined]);
  });
});
