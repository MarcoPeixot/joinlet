import { describe, expect, it, vi } from 'vitest';
import type { ChatReply } from '../ai/client';
import { loadChats } from './history';
import { createChatStore } from './store';

type Request = (turns: { role: string; content: string }[], context: string, signal: AbortSignal, onText: (piece: string) => void, sessionId?: string) => Promise<ChatReply>;

function setup(reply: (n: number, onText: (piece: string) => void) => Promise<ChatReply> | ChatReply = () => ({ kind: 'ok', reply: 'Resposta' }), withStorage = false) {
  let n = 0;
  let now = 1_000;
  const request = vi.fn<Request>(async (_turns, _context, _signal, onText) => reply(n++, onText));
  const data: Record<string, string> = {};
  const storage = { get: (key: string) => data[key] ?? null, set: (key: string, value: string) => { data[key] = value; } };
  const make = () => createChatStore({ request, getContext: () => 'CTX', now: () => ++now, ...(withStorage ? { storage } : {}) });
  return { store: make(), make, request, storage, data };
}

describe('chat store', () => {
  it('sends the question with the context and appends the answer', async () => {
    const { store, request } = setup();
    await store.getState().send('  O que faz a API?  ');
    expect(request).toHaveBeenCalledWith([{ role: 'user', content: 'O que faz a API?' }], 'CTX', expect.any(AbortSignal), expect.any(Function), expect.any(String), undefined, expect.any(Function), expect.any(Function));
    expect(store.getState().messages.map((m) => [m.role, m.content])).toEqual([['user', 'O que faz a API?'], ['assistant', 'Resposta']]);
    expect(store.getState()).toMatchObject({ status: 'idle', error: null });
  });

  it('keeps the provider session stable within a conversation and changes it for a new one', async () => {
    const { store, request } = setup();
    await store.getState().send('Primeira pergunta');
    const first = store.getState().activeId;
    await store.getState().send('Segunda pergunta');
    store.getState().newChat();
    await store.getState().send('Outra conversa');
    expect(request.mock.calls.map((call) => call[4])).toEqual([first, first, store.getState().activeId]);
    expect(store.getState().activeId).not.toBe(first);
  });

  it('shows the question right away while waiting', async () => {
    let release!: (reply: ChatReply) => void;
    const { store } = setup(() => new Promise<ChatReply>((resolve) => (release = resolve)));
    const pending = store.getState().send('oi');
    expect(store.getState()).toMatchObject({ status: 'loading' });
    expect(store.getState().messages).toHaveLength(1);
    release({ kind: 'ok', reply: 'olá' });
    await pending;
    expect(store.getState().messages).toHaveLength(2);
  });

  it('grows the answer piece by piece and ends with the whole text', async () => {
    let finish!: () => void;
    const { store } = setup((_n, onText) => new Promise<ChatReply>((resolve) => {
      onText('Olá, ');
      finish = () => { onText('mundo.'); resolve({ kind: 'ok', reply: 'Olá, mundo.' }); };
    }));
    const pending = store.getState().send('oi');
    expect(store.getState().messages.map((m) => m.content)).toEqual(['oi', 'Olá, ']);
    expect(store.getState().status).toBe('loading');
    finish();
    await pending;
    expect(store.getState().messages.map((m) => m.content)).toEqual(['oi', 'Olá, mundo.']);
    expect(store.getState().status).toBe('idle');
  });

  it('keeps the history for the next turn', async () => {
    const { store, request } = setup((n) => ({ kind: 'ok', reply: `r${n}` }));
    await store.getState().send('a');
    await store.getState().send('b');
    expect(request.mock.calls[1]![0]).toEqual([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'r0' }, { role: 'user', content: 'b' }]);
  });

  it('ignores blank text and a second send while loading', async () => {
    const { store, request } = setup(() => new Promise<ChatReply>(() => {}));
    await store.getState().send('   ');
    expect(request).not.toHaveBeenCalled();
    void store.getState().send('um');
    await store.getState().send('dois');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('turns an offline server and an error into a message the panel can show, keeping the question', async () => {
    const offline = setup(() => ({ kind: 'offline', reason: 'Servidor de IA fora do ar.' }));
    await offline.store.getState().send('oi');
    expect(offline.store.getState()).toMatchObject({ status: 'idle', error: 'Servidor de IA fora do ar.', offline: true });
    expect(offline.store.getState().messages).toHaveLength(1);
    const failed = setup(() => ({ kind: 'error', message: 'Deu ruim.' }));
    await failed.store.getState().send('oi');
    expect(failed.store.getState()).toMatchObject({ error: 'Deu ruim.', offline: false });
  });

  it('retry resends the last question after a failure without duplicating it', async () => {
    const { store, request } = setup((n) => (n === 0 ? { kind: 'error', message: 'x' } : { kind: 'ok', reply: 'agora foi' }));
    await store.getState().send('oi');
    await store.getState().retry();
    expect(store.getState().messages.map((m) => m.content)).toEqual(['oi', 'agora foi']);
    expect(request.mock.calls[1]![0]).toEqual([{ role: 'user', content: 'oi' }]);
    expect(store.getState().error).toBeNull();
  });

  it('an answer cut short stays on screen, marked, and retry replaces it', async () => {
    const { store, request } = setup((n, onText) => {
      if (n === 0) { onText('só metade'); return { kind: 'error', message: 'A resposta foi interrompida.' }; }
      return { kind: 'ok', reply: 'completa' };
    });
    await store.getState().send('oi');
    expect(store.getState().messages.map((m) => [m.content, m.interrupted ?? false])).toEqual([['oi', false], ['só metade', true]]);
    expect(store.getState().error).toBe('A resposta foi interrompida.');
    await store.getState().retry();
    expect(store.getState().messages.map((m) => m.content)).toEqual(['oi', 'completa']);
    expect(request.mock.calls[1]![0]).toEqual([{ role: 'user', content: 'oi' }]);
  });

  it('stop cancels the answer in flight and keeps what was written, marked', async () => {
    const { store, request } = setup((_n, onText) => new Promise<ChatReply>(() => { onText('parcial'); }));
    void store.getState().send('oi');
    const signal = request.mock.calls[0]![2];
    store.getState().stop();
    expect(signal.aborted).toBe(true);
    expect(store.getState()).toMatchObject({ status: 'idle', error: null });
    expect(store.getState().messages.map((m) => [m.content, m.interrupted ?? false])).toEqual([['oi', false], ['parcial', true]]);
  });

  it('clear aborts the request in flight and deletes the conversation', async () => {
    const { store, request } = setup(() => new Promise<ChatReply>(() => {}));
    void store.getState().send('oi');
    const signal = request.mock.calls[0]![2];
    store.getState().clear();
    expect(signal.aborted).toBe(true);
    expect(store.getState()).toMatchObject({ messages: [], status: 'idle', error: null, chats: [], activeId: null });
  });

  it('an answer that arrives after clear is dropped', async () => {
    let release!: (reply: ChatReply) => void;
    const { store } = setup(() => new Promise<ChatReply>((resolve) => (release = resolve)));
    const pending = store.getState().send('oi');
    store.getState().clear();
    release({ kind: 'ok', reply: 'tarde' });
    await pending;
    expect(store.getState().messages).toEqual([]);
  });

  it('keeps only the latest turns in the request so a long chat stays inside the server limits', async () => {
    const { store, request } = setup();
    for (let i = 0; i < 25; i++) await store.getState().send(`p${i}`);
    const turns = request.mock.calls[24]![0];
    expect(turns.length).toBeLessThanOrEqual(40);
    expect(turns[0]!.role).toBe('user');
    expect(turns[turns.length - 1]).toEqual({ role: 'user', content: 'p24' });
  });
});

describe('chat store: conversations kept across reloads', () => {
  it('moves the conversations saved under the old name-based key to the workspace id, keeping the old copy', async () => {
    const { store, make, data } = setup(() => ({ kind: 'ok', reply: 'Feito.' }), true);
    store.getState().bind('Navegador::Pagamentos');
    await store.getState().send('Pergunta antiga');
    const upgraded = make();
    upgraded.getState().bind('ws:abc', 'Navegador::Pagamentos');
    expect(upgraded.getState().messages.map((m) => m.content)).toEqual(['Pergunta antiga', 'Feito.']);
    await upgraded.getState().send('Pergunta nova');
    expect(JSON.parse(data['strukt:chats:ws:abc']!)[0].messages).toHaveLength(4);
    expect(JSON.parse(data['strukt:chats:Navegador::Pagamentos']!)[0].messages).toHaveLength(2);
  });

  it('renaming the workspace keeps its conversations and the answer in flight', async () => {
    let release!: (reply: ChatReply) => void;
    const { store, make } = setup(() => new Promise<ChatReply>((resolve) => (release = resolve)), true);
    store.getState().bind('ws:abc', 'Navegador::Pagamentos');
    const pending = store.getState().send('Ainda respondendo');
    store.getState().bind('ws:abc', 'Navegador::Cobrança');
    expect(store.getState()).toMatchObject({ status: 'loading' });
    release({ kind: 'ok', reply: 'Pronto.' });
    await pending;
    expect(store.getState().messages.map((m) => m.content)).toEqual(['Ainda respondendo', 'Pronto.']);
    const reopened = make();
    reopened.getState().bind('ws:abc', 'Navegador::Cobrança');
    expect(reopened.getState().messages.map((m) => m.content)).toEqual(['Ainda respondendo', 'Pronto.']);
  });

  it('does not touch the conversations an id already has when the old key also has some', async () => {
    const { store, make } = setup(() => ({ kind: 'ok', reply: 'R' }), true);
    store.getState().bind('ws:abc', 'Navegador::A');
    await store.getState().send('Do id');
    const other = make();
    other.getState().bind('Navegador::A');
    await other.getState().send('Do nome antigo');
    const again = make();
    again.getState().bind('ws:abc', 'Navegador::A');
    expect(again.getState().messages.map((m) => m.content)).toEqual(['Do id', 'R']);
  });

  it('two workspaces with the same name and place keep separate conversations once they have ids', async () => {
    const { store, make } = setup(() => ({ kind: 'ok', reply: 'R' }), true);
    store.getState().bind('ws:a', 'Navegador::App');
    await store.getState().send('Só do A');
    const other = make();
    other.getState().bind('ws:b', 'Navegador::App');
    other.getState().newChat();
    await other.getState().send('Só do B');
    const a = make();
    a.getState().bind('ws:a', 'Navegador::App');
    expect(a.getState().chats.map((c) => c.title)).toEqual(['Só do A']);
  });

  it('saves the conversation of a workspace and brings it back after a reload', async () => {
    const { store, make, data } = setup(() => ({ kind: 'ok', reply: 'A API fala com o banco.' }), true);
    store.getState().bind('repo');
    await store.getState().send('O que a API faz?');
    expect(Object.keys(data).sort()).toEqual(['strukt:chat-active:repo', 'strukt:chats:repo']);
    const again = make();
    again.getState().bind('repo');
    expect(again.getState().messages.map((m) => m.content)).toEqual(['O que a API faz?', 'A API fala com o banco.']);
    expect(again.getState().chats.map((c) => c.title)).toEqual(['O que a API faz?']);
  });

  it('keeps answers apart when the conversation continues after a reload (ids start above the saved ones)', async () => {
    const { store, make } = setup((n) => ({ kind: 'ok', reply: `Resposta ${n + 1}` }), true);
    store.getState().bind('repo');
    await store.getState().send('Q1');
    const again = make();
    again.getState().bind('repo');
    await again.getState().send('Q2');
    const messages = again.getState().messages;
    expect(new Set(messages.map((m) => m.id)).size).toBe(messages.length);
    expect(messages.map((m) => m.content)).toEqual(['Q1', 'Resposta 1', 'Q2', 'Resposta 2']);
  });

  it('keeps an answer streaming after a reload from touching the saved ones', async () => {
    const { store, make } = setup((n, onText) => { onText(`Parte ${n}`); return { kind: 'ok', reply: `Resposta ${n}` }; }, true);
    store.getState().bind('repo');
    await store.getState().send('Q1');
    const again = make();
    again.getState().bind('repo');
    await again.getState().send('Q2');
    expect(again.getState().messages.map((m) => m.content)).toEqual(['Q1', 'Resposta 0', 'Q2', 'Resposta 1']);
  });

  it('saves the question before the answer comes (a reload mid-answer keeps it)', async () => {
    const { store, storage } = setup(() => new Promise<ChatReply>(() => {}), true);
    store.getState().bind('repo');
    void store.getState().send('Pergunta longa');
    expect(loadChats(storage, 'repo')[0]!.messages.map((m) => m.content)).toEqual(['Pergunta longa']);
  });

  it('keeps each workspace its own and switches without mixing or leaking an answer in flight', async () => {
    let release!: (reply: ChatReply) => void;
    const { store } = setup((n) => (n === 0 ? new Promise<ChatReply>((resolve) => (release = resolve)) : { kind: 'ok', reply: 'outra' }), true);
    store.getState().bind('a');
    const pending = store.getState().send('no A');
    store.getState().bind('b');
    expect(store.getState()).toMatchObject({ messages: [], status: 'idle', activeId: null });
    release({ kind: 'ok', reply: 'tarde' });
    await pending;
    expect(store.getState().messages).toEqual([]);
    await store.getState().send('no B');
    store.getState().bind('a');
    expect(store.getState().messages.map((m) => m.content)).toEqual(['no A']);
  });

  it('starts a new conversation without losing the old one, and opens, lists and deletes them', async () => {
    const { store } = setup((n) => ({ kind: 'ok', reply: `r${n}` }), true);
    store.getState().bind('repo');
    await store.getState().send('primeira');
    const first = store.getState().activeId!;
    store.getState().newChat();
    expect(store.getState()).toMatchObject({ messages: [], activeId: null });
    expect(store.getState().chats).toHaveLength(1);
    await store.getState().send('segunda');
    expect(store.getState().chats.map((c) => c.title)).toEqual(['segunda', 'primeira']);
    store.getState().openChat(first);
    expect(store.getState().messages.map((m) => m.content)).toEqual(['primeira', 'r0']);
    store.getState().deleteChat(first);
    expect(store.getState().chats.map((c) => c.title)).toEqual(['segunda']);
    expect(store.getState().activeId).toBeNull();
  });

  it('clear removes the saved copy too', async () => {
    const { store, storage } = setup(undefined, true);
    store.getState().bind('repo');
    await store.getState().send('oi');
    store.getState().clear();
    expect(loadChats(storage, 'repo')).toEqual([]);
  });

  it('works without any storage', async () => {
    const { store } = setup();
    store.getState().bind('repo');
    await store.getState().send('oi');
    expect(store.getState().messages).toHaveLength(2);
  });
});

describe('chat store: assistants', () => {
  const run = { name: 'Revisar pontos únicos de falha', scope: 'diagram' as const };

  function withContext(getContext: (options?: { scope?: string; changes?: true }) => string | Promise<string>, reply: ChatReply = { kind: 'ok', reply: 'ok' }) {
    const request = vi.fn<Request>(async () => reply);
    const data: Record<string, string> = {};
    const storage = { get: (key: string) => data[key] ?? null, set: (key: string, value: string) => { data[key] = value; } };
    const make = () => createChatStore({ request, getContext, now: () => 1, storage });
    return { store: make(), make, request };
  }

  it('sends the instruction as the question, asks the context for the assistant\'s scope and remembers who ran it', async () => {
    const getContext = vi.fn(() => 'CTX');
    const { store, request } = withContext(getContext);
    await store.getState().send('Revise o diagrama.', run);
    expect(getContext).toHaveBeenCalledWith({ scope: 'diagram' });
    expect(request.mock.calls[0]![0]).toEqual([{ role: 'user', content: 'Revise o diagrama.' }]);
    expect(store.getState().messages[0]).toMatchObject({ role: 'user', content: 'Revise o diagrama.', assistant: run });
    expect(store.getState().messages[1]).not.toHaveProperty('assistant');
  });

  it('passes the changes flag only for an assistant that asks for it', async () => {
    const getContext = vi.fn(() => 'CTX');
    const { store } = withContext(getContext);
    await store.getState().send('Resuma.', { name: 'Mudanças', scope: 'diagram', changes: true });
    expect(getContext).toHaveBeenLastCalledWith({ scope: 'diagram', changes: true });
  });

  it('a follow-up question goes back to the whole workspace', async () => {
    const getContext = vi.fn(() => 'CTX');
    const { store } = withContext(getContext);
    await store.getState().send('Revise.', run);
    await store.getState().send('E o banco?');
    expect(getContext).toHaveBeenLastCalledWith(undefined);
  });

  it('retry keeps the assistant\'s scope', async () => {
    const getContext = vi.fn(() => 'CTX');
    let first = true;
    const request = vi.fn<Request>(async () => (first ? ((first = false), { kind: 'error', message: 'x' } as ChatReply) : { kind: 'ok', reply: 'ok' }));
    const store = createChatStore({ request, getContext, now: () => 1 });
    await store.getState().send('Revise.', { ...run, changes: true });
    await store.getState().retry();
    expect(getContext).toHaveBeenCalledTimes(2);
    expect(getContext).toHaveBeenLastCalledWith({ scope: 'diagram', changes: true });
  });

  it('titles the conversation with the assistant\'s name, and saves who ran it', async () => {
    const { store, make } = withContext(() => 'CTX');
    store.getState().bind('w');
    await store.getState().send('Revise o diagrama com cuidado.', run);
    expect(store.getState().chats[0]!.title).toBe('Revisar pontos únicos de falha');
    const reopened = make();
    reopened.getState().bind('w');
    expect(reopened.getState().messages[0]).toMatchObject({ assistant: run });
  });

  it('waits for an async context, and a stop while waiting drops the question\'s answer', async () => {
    let release!: (text: string) => void;
    const { store, request } = withContext(() => new Promise<string>((resolve) => (release = resolve)));
    const pending = store.getState().send('oi');
    expect(store.getState().status).toBe('loading');
    expect(request).not.toHaveBeenCalled();
    store.getState().stop();
    release('CTX');
    await pending;
    expect(request).not.toHaveBeenCalled();
    expect(store.getState().status).toBe('idle');
    expect(store.getState().messages).toHaveLength(1);
  });

  it('shows a context that fails to build as an error, not as a crash', async () => {
    const { store, request } = withContext(() => { throw new Error('sem versões'); });
    await store.getState().send('oi');
    expect(request).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({ status: 'idle', error: 'sem versões' });
  });
});

describe('chat workbench continuity', () => {
  it('restores the chosen conversation and its independent draft, including after a reload', async () => {
    const { store, make } = setup(undefined, true);
    store.getState().bind('workspace');
    await store.getState().send('Primeira');
    const first = store.getState().activeId!;
    store.getState().setDraft('Pergunta ainda não enviada');
    store.getState().newChat();
    store.getState().setDraft('Rascunho da nova conversa');
    expect(store.getState().draft).toBe('Rascunho da nova conversa');
    store.getState().openChat(first);
    expect(store.getState().draft).toBe('Pergunta ainda não enviada');
    const loaded = make(); loaded.getState().bind('workspace');
    expect(loaded.getState().activeId).toBe(first);
    expect(loaded.getState().draft).toBe('Pergunta ainda não enviada');
    loaded.getState().newChat();
    expect(loaded.getState().draft).toBe('Rascunho da nova conversa');
    loaded.getState().bind('outro');
    expect(loaded.getState().draft).toBe('');
  });
  it('keeps a manual title while the conversation continues and after reloading', async () => {
    const { store, make } = setup(undefined, true);
    store.getState().bind('workspace');
    await store.getState().send('Pergunta');
    store.getState().renameChat(store.getState().activeId!, 'Decisões de arquitetura');
    await store.getState().send('Detalhe mais');
    const loaded = make(); loaded.getState().bind('workspace');
    expect(loaded.getState().chats[0]!.title).toBe('Decisões de arquitetura');
  });
  it('switching chats keeps the partial streamed answer and drops a late completion', async () => {
    let finish!: (value: ChatReply) => void;
    const { store, make } = setup((_n, onText) => { onText('Resposta parcial'); return new Promise<ChatReply>(resolve => { finish = resolve; }); }, true);
    store.getState().bind('workspace');
    const pending = store.getState().send('Explique');
    const first = store.getState().activeId!;
    store.getState().newChat();
    finish({ kind: 'ok', reply: 'Resposta que chegou tarde' }); await pending;
    expect(store.getState().messages).toEqual([]);
    const loaded = make(); loaded.getState().bind('workspace'); loaded.getState().openChat(first);
    expect(loaded.getState().messages.at(-1)).toMatchObject({ content: 'Resposta parcial', interrupted: true });
  });
  it('checkpoints the incoming text so a reload mid-stream recovers the partial answer', async () => {
    vi.useFakeTimers();
    try {
      const { store, make } = setup((_n, onText) => { onText('Já recebido'); return new Promise<ChatReply>(() => {}); }, true);
      store.getState().bind('workspace'); void store.getState().send('Explique');
      await vi.advanceTimersByTimeAsync(450);
      const loaded = make(); loaded.getState().bind('workspace');
      expect(loaded.getState().messages.at(-1)).toMatchObject({ content: 'Já recebido', interrupted: true });
      store.getState().stop();
    } finally { vi.useRealTimers(); }
  });
});

it('persists model choices per conversation and workspace without changing defaults or an in-flight request', async () => {
  const data = new Map<string, string>();
  const storage = { get: (key: string) => data.get(key) ?? null, set: (key: string, value: string) => { data.set(key, value); } };
  let release!: (reply: ChatReply) => void;
  const request = vi.fn<import('./store').ChatDeps['request']>().mockResolvedValue({ kind: 'ok', reply: 'Certo.' });
  const make = () => createChatStore({ request, storage, getContext: () => 'CTX' });
  const store = make(); store.getState().bind('a');
  const go = { provider: 'opencodego' as const, model: 'qwen3.8-flash' };
  const router = { provider: 'openrouter' as const, model: 'openrouter/auto' };
  store.getState().setModelChoice(go);
  await store.getState().send('Consulta com Go');
  const first = store.getState().activeId!;
  expect(request.mock.calls.at(-1)?.[5]).toEqual(go);
  store.getState().newChat(); store.getState().setModelChoice(router);
  await store.getState().send('Consulta com Router');
  const second = store.getState().activeId!;
  const again = make(); again.getState().bind('a');
  expect(again.getState().modelChoice).toEqual(router);
  again.getState().openChat(first); expect(again.getState().modelChoice).toEqual(go);
  request.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = again.getState().send('Continue');
  again.getState().setModelChoice(router);
  expect(again.getState().modelChoice).toEqual(go);
  expect(request.mock.calls.at(-1)?.[5]).toEqual(go);
  release({ kind: 'ok', reply: 'Certo.' }); await pending;
  again.getState().openChat(second); expect(again.getState().modelChoice).toEqual(router);
  again.getState().bind('b'); expect(again.getState().modelChoice).toBeNull();
  again.getState().bind('a'); again.getState().setModelChoice(null);
  await again.getState().send('Padrão'); expect(request.mock.calls.at(-1)?.[5]).toBeUndefined();
});

it('sends confirmed application receipts to the model so later turns do not deny applied tools', async () => {
  const { store, request } = setup(() => ({ kind: 'ok', reply: 'Alteração preparada.', change: { summary: 'Pastas organizadas.', undo: () => {} } }));
  await store.getState().send('Organize em pastas');
  await store.getState().send('O que você alterou?');
  expect(request.mock.calls.at(-1)![0][1]?.content).toContain('[Resultado confirmado pelo Joinlet: Pastas organizadas.]');
});


it('shows transient web search progress and ignores late updates after cancellation or switching chats', async () => {
  let update!: (activity: import('@strukt/core').ChatSearchActivity) => void;
  let resolve!: (reply: ChatReply) => void;
  const store = createChatStore({ getContext: () => 'CTX', request: async (_turns, _context, _signal, _onText, _id, _selection, onSearch) => { update = onSearch!; return new Promise(done => { resolve = done; }); } });
  const pending = store.getState().send('Pesquise práticas atuais');
  update({ query: 'PostgreSQL docs', status: 'searching' });
  expect(store.getState().searchActivity).toEqual({ query: 'PostgreSQL docs', status: 'searching' });
  update({ query: 'PostgreSQL docs', status: 'complete', count: 3 });
  expect(store.getState().searchActivity?.count).toBe(3);
  store.getState().stop();
  update({ query: 'atrasada', status: 'searching' });
  expect(store.getState().searchActivity).toBeNull();
  resolve({ kind: 'ok', reply: 'Resposta atrasada' }); await pending;
  expect(store.getState().messages.some(m => m.content === 'Resposta atrasada')).toBe(false);
});

describe('Jo activity lifecycle', () => {
  it('tracks real text and apply phases, and ignores callbacks after cancellation', async () => {
    let text!: (piece: string) => void;
    let apply!: (phase: 'applying') => void;
    let finish!: (reply: ChatReply) => void;
    const store = createChatStore({ getContext: () => 'CTX', request: (_turns,_context,_signal,onText,_id,_model,_search,onActivity) => {
      text=onText; apply=onActivity!;
      return new Promise(resolve=>{finish=resolve;});
    }});
    const pending = store.getState().send('Review');
    expect(store.getState().activity).toBe('thinking');
    text('Working'); expect(store.getState().activity).toBe('writing');
    apply('applying'); expect(store.getState().activity).toBe('applying');
    store.getState().stop();
    const previous = store.getState().activity;
    text('stale'); apply('applying');
    expect(store.getState().status).toBe('idle');
    expect(store.getState().activity).toBe(previous);
    finish({ kind:'ok', reply:'Working' }); await pending;
    expect(store.getState().messages.at(-1)?.content).toBe('Working');
  });
});
