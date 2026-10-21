import { StorageConflict, commentsPath, createMemoryAdapter, parseComments, printComments } from '@strukt/workspace';
import type { StorageAdapter } from '@strukt/workspace';
import { describe, expect, it, vi } from 'vitest';
import type { Who } from './identity';
import { createCommentsStore } from './store';
import type { CommentTarget, CommentsDeps } from './store';

const ANA: Who = { name: 'Ana Souza', color: '#3972dc', cid: 'aaaaaaaaaaaa', owner: 'i:ana', moderator: true, canWrite: true, named: true };
const BIA: Who = { name: 'Bia', color: '#c75c8f', cid: 'bbbbbbbbbbbb', owner: 'i:bia', moderator: false, canWrite: true, named: true };
const VERA: Who = { name: 'Vera', color: '#319b77', cid: 'cccccccccccc', owner: 'i:vera', moderator: false, canWrite: false, named: true };
const MAPA: CommentTarget = { kind: 'diagram', slug: 'mapa' };
const PATH = commentsPath('diagram', 'mapa');
const node = (id = 'API'): { type: 'node'; id: string } => ({ type: 'node', id });

/** What the host's REST surface does for a guest: a write names the text it read, and loses if the file changed since. */
function checking(shared: StorageAdapter, hook?: () => Promise<void>): StorageAdapter {
  const baseline = new Map<string, string | null>();
  return {
    ...shared,
    read: async (path) => { const text = await shared.read(path); baseline.set(path, text); return text; },
    write: async (path, text) => {
      await hook?.();
      if ((await shared.read(path)) !== (baseline.get(path) ?? null)) throw new StorageConflict('Arquivo alterado fora da sessão.');
      await shared.write(path, text);
    },
  };
}

function setup(adapter: StorageAdapter | null, who: Who, extra: Partial<CommentsDeps> = {}) {
  let clock = 1_000_000;
  let serial = 0;
  const ticks: Array<{ ms: number; fn: () => void; live: boolean }> = [];
  const notes: string[] = [];
  const seen = new Map<string, number>();
  const deps: CommentsDeps = {
    adapter: () => adapter, who: () => who, now: () => ++clock, newId: () => `${who.cid.slice(0, 2)}${++serial}x`, notify: (message) => void notes.push(message),
    every: (ms, fn) => { const entry = { ms, fn, live: true }; ticks.push(entry); return () => { entry.live = false; }; },
    seen: { get: (key) => seen.get(key) ?? 0, set: (key, at) => void seen.set(key, at) },
    names: () => ['Ana Souza', 'Bia', 'Vera'],
    ...extra,
  };
  const comments = createCommentsStore(deps);
  const tick = async (ms: number) => { for (const entry of ticks.filter((e) => e.live && e.ms === ms)) entry.fn(); await new Promise((resolve) => setTimeout(resolve, 5)); };
  return { comments, state: () => comments.store.getState(), notes, seen, tick, ticks, advance: (ms: number) => { clock += ms; } };
}
const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('opening an item', () => {
  it('loads what is in the file, and an item without comments is simply empty', async () => {
    const adapter = createMemoryAdapter();
    const first = setup(adapter, ANA);
    first.comments.attach(MAPA);
    await settled();
    expect(first.state()).toMatchObject({ loaded: true, broken: null, error: null });
    expect(first.state().file.threads).toEqual([]);
    await first.comments.createThread(node(), 'Sobre a API');
    const second = setup(adapter, BIA);
    second.comments.attach(MAPA);
    await settled();
    expect(second.state().file.threads.map((t) => t.messages[0]!.text)).toEqual(['Sobre a API']);
  });

  it('reports a broken file and refuses to write over it', async () => {
    const adapter = createMemoryAdapter({ [PATH]: '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> x\n' });
    const { comments, state, notes } = setup(adapter, ANA);
    comments.attach(MAPA);
    await settled();
    expect(state().broken).toMatch(/JSON/);
    expect(await comments.createThread(node(), 'oi')).toBe(false);
    expect(notes[0]).toMatch(/Corrija ou apague/);
    expect(await adapter.read(PATH)).toContain('<<<<<<<');
  });

  it('switching item forgets the last one, and a late answer for it is dropped', async () => {
    const adapter = createMemoryAdapter();
    const slow = { ...adapter, read: vi.fn(async (path: string) => { if (path.endsWith('diagram-mapa.json')) await new Promise((resolve) => setTimeout(resolve, 40)); return adapter.read(path); }) };
    await adapter.write(commentsPath('diagram', 'mapa'), printComments({ version: 1, threads: [{ id: 't1', anchor: node(), by: 'i:ana', created: 1, status: 'open', statusAt: 1, messages: [{ id: 'm1', owner: 'i:ana', author: { name: 'Ana Souza', color: '#3972dc' }, text: 'do mapa', at: 1 }] }] }));
    const { comments, state } = setup(slow, ANA);
    comments.attach(MAPA);
    comments.attach({ kind: 'diagram', slug: 'outro' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(state().target).toEqual({ kind: 'diagram', slug: 'outro' });
    expect(state().file.threads).toEqual([]);
  });
});

describe('writing', () => {
  it('shows a new conversation at once and has it in the file when it resolves', async () => {
    const adapter = createMemoryAdapter();
    const { comments, state } = setup(adapter, ANA);
    comments.attach(MAPA);
    await settled();
    const done = comments.createThread(node('API'), 'Esse serviço fala com @Bia?');
    expect(state().file.threads).toHaveLength(1);
    expect(await done).toBe(true);
    const thread = state().file.threads[0]!;
    expect(thread).toMatchObject({ anchor: node('API'), by: 'i:ana', status: 'open' });
    expect(thread.messages[0]).toMatchObject({ owner: 'i:ana', author: { name: 'Ana Souza', color: '#3972dc' }, mentions: ['Bia'], text: 'Esse serviço fala com @Bia?' });
    expect(state().active).toBe(thread.id);
    expect(parseComments(await adapter.read(PATH), 'diagram').file.threads).toHaveLength(1);
  });

  it('reply, edit, resolve, reopen and delete reach the file', async () => {
    const adapter = createMemoryAdapter();
    const { comments, state } = setup(adapter, ANA);
    comments.attach(MAPA);
    await settled();
    await comments.createThread(node(), 'Primeira');
    const id = state().file.threads[0]!.id;
    expect(await comments.reply(id, 'Segunda')).toBe(true);
    const reply = state().file.threads[0]!.messages[1]!;
    expect(await comments.edit(id, reply.id, 'Segunda corrigida @Vera')).toBe(true);
    expect(await comments.setStatus(id, 'resolved')).toBe(true);
    let disk = parseComments(await adapter.read(PATH), 'diagram').file.threads[0]!;
    expect(disk).toMatchObject({ status: 'resolved', statusBy: { name: 'Ana Souza' } });
    expect(disk.messages[1]).toMatchObject({ text: 'Segunda corrigida @Vera', mentions: ['Vera'] });
    expect(await comments.setStatus(id, 'open')).toBe(true);
    expect(await comments.remove(id, reply.id)).toBe(true);
    disk = parseComments(await adapter.read(PATH), 'diagram').file.threads[0]!;
    expect(disk.status).toBe('open');
    expect(disk.messages[1]).toMatchObject({ text: '', deleted: expect.any(Number) });
    expect(await comments.deleteThread(id)).toBe(true);
    expect(state().file.threads[0]!.deleted).toBeDefined();
    expect(await adapter.read(PATH)).not.toContain('Primeira');
  });

  it('takes the change back and keeps the error when the write fails', async () => {
    const adapter = createMemoryAdapter();
    const failing: StorageAdapter = { ...adapter, write: async () => { throw new Error('Este convite só pode comentar.'); } };
    const { comments, state, notes } = setup(failing, ANA);
    comments.attach(MAPA);
    await settled();
    const done = comments.createThread(node(), 'não vai');
    expect(state().file.threads).toHaveLength(1);
    expect(await done).toBe(false);
    expect(state().file.threads).toEqual([]);
    expect(state().error).toMatch(/só pode comentar/);
    expect(notes[0]).toMatch(/Não foi possível salvar/);
    expect(state().draft).toBeNull();
  });

  it('refuses at once what the rules forbid: an empty comment, someone else\'s message, a read-only link', async () => {
    const adapter = createMemoryAdapter();
    const ana = setup(adapter, ANA);
    ana.comments.attach(MAPA);
    await settled();
    expect(await ana.comments.createThread(node(), '   ')).toBe(false);
    expect(ana.notes[0]).toMatch(/Escreva/);
    await ana.comments.createThread(node(), 'da Ana');
    const thread = ana.state().file.threads[0]!;
    const bia = setup(adapter, BIA);
    bia.comments.attach(MAPA);
    await settled();
    expect(await bia.comments.edit(thread.id, thread.messages[0]!.id, 'forjado')).toBe(false);
    expect(await bia.comments.remove(thread.id, thread.messages[0]!.id)).toBe(false);
    expect(await bia.comments.deleteThread(thread.id)).toBe(false);
    expect(bia.notes.join(' ')).toMatch(/próprios comentários/);
    // A moderator may.
    expect(await ana.comments.edit(thread.id, thread.messages[0]!.id, 'da Ana, corrigido')).toBe(true);
    const vera = setup(adapter, VERA);
    vera.comments.attach(MAPA);
    await settled();
    expect(await vera.comments.reply(thread.id, 'oi')).toBe(false);
    expect(vera.notes[0]).toMatch(/só permite ver/);
    expect(parseComments(await adapter.read(PATH), 'diagram').file.threads[0]!.messages).toHaveLength(1);
  });

  it('keeps the draft until the first message is in', async () => {
    const adapter = createMemoryAdapter();
    const { comments, state } = setup(adapter, ANA);
    comments.attach(MAPA);
    await settled();
    comments.startDraft({ type: 'point', x: 10, y: 20 });
    expect(state().draft).toEqual({ anchor: { type: 'point', x: 10, y: 20 } });
    comments.cancelDraft();
    expect(state().draft).toBeNull();
    comments.startDraft({ type: 'point', x: 10, y: 20 });
    await comments.createThread({ type: 'point', x: 10, y: 20 }, 'aqui');
    expect(state().draft).toBeNull();
    expect(state().file.threads[0]!.anchor).toEqual({ type: 'point', x: 10, y: 20 });
  });
});

describe('two people at once', () => {
  it('see each other\'s comments within a poll, and keep both when they write at the same moment', async () => {
    const shared = createMemoryAdapter();
    let race: (() => Promise<void>) | null = null;
    const ana = setup(checking(shared, async () => { const run = race; race = null; await run?.(); }), ANA);
    const bia = setup(checking(shared), BIA);
    ana.comments.attach(MAPA);
    bia.comments.attach(MAPA);
    await settled();
    // Bia's comment lands between Ana's read and Ana's write.
    race = async () => { await bia.comments.createThread(node('DB'), 'Da Bia'); };
    await ana.comments.createThread(node('API'), 'Da Ana');
    expect(parseComments(await shared.read(PATH), 'diagram').file.threads.map((t) => t.messages[0]!.text).sort()).toEqual(['Da Ana', 'Da Bia']);
    // Neither sees the other's until the next poll; after it, both see both.
    await bia.tick(3000);
    await ana.tick(3000);
    for (const person of [ana, bia]) expect(person.state().file.threads.map((t) => t.messages[0]!.text).sort()).toEqual(['Da Ana', 'Da Bia']);
    expect(ana.state().file).toEqual(bia.state().file);
  });

  it('a resolution travels to the other screen, and a reopened thread too', async () => {
    const shared = createMemoryAdapter();
    const ana = setup(checking(shared), ANA);
    const bia = setup(checking(shared), BIA);
    ana.comments.attach(MAPA);
    bia.comments.attach(MAPA);
    await settled();
    await ana.comments.createThread(node(), 'Pergunta');
    await bia.tick(3000);
    const id = bia.state().file.threads[0]!.id;
    await bia.comments.setStatus(id, 'resolved');
    await ana.tick(3000);
    expect(ana.state().file.threads[0]!.status).toBe('resolved');
    await ana.comments.setStatus(id, 'open');
    await bia.tick(3000);
    expect(bia.state().file.threads[0]!.status).toBe('open');
  });

  it('does not touch the screen when a poll finds nothing new', async () => {
    const adapter = createMemoryAdapter();
    const { comments, state, tick } = setup(adapter, ANA);
    comments.attach(MAPA);
    await settled();
    await comments.createThread(node(), 'oi');
    const before = state().file;
    await tick(3000);
    expect(state().file).toBe(before);
  });

  it('does not poll while the tab is hidden, and stops polling after it is detached', async () => {
    const adapter = createMemoryAdapter();
    let visible = true;
    const read = vi.spyOn(adapter, 'read');
    const { comments, tick } = setup(adapter, ANA, { visible: () => visible });
    comments.attach(MAPA);
    await settled();
    read.mockClear();
    visible = false;
    await tick(3000);
    expect(read).not.toHaveBeenCalled();
    visible = true;
    await tick(3000);
    expect(read).toHaveBeenCalledTimes(1);
    comments.detach();
    read.mockClear();
    await tick(3000);
    expect(read).not.toHaveBeenCalled();
  });
});

describe('mentions for you', () => {
  async function room() {
    const adapter = createMemoryAdapter();
    const bia = setup(adapter, BIA);
    bia.comments.attach(MAPA);
    await settled();
    await bia.comments.createThread(node(), 'Ana Souza, olha @Ana Souza');
    await bia.comments.createThread(node('DB'), 'Sem menção');
    const docs = setup(adapter, BIA);
    docs.comments.attach({ kind: 'doc', slug: 'adr' });
    await settled();
    await docs.comments.createThread({ type: 'text', quote: 'x', prefix: '', suffix: '', from: 0 }, 'Outro item, @Ana Souza');
    return adapter;
  }

  it('counts, in the other items too, the open conversations that mention you, and what is new since you looked', async () => {
    const adapter = await room();
    const ana = setup(adapter, ANA);
    ana.comments.attach(MAPA);
    await settled();
    expect(ana.state().summary).toEqual({ 'diagram:mapa': { open: 2, mentions: 1, fresh: 1 }, 'doc:adr': { open: 1, mentions: 1, fresh: 1 } });
    ana.comments.markSeen();
    await ana.comments.scan();
    expect(ana.state().summary['diagram:mapa']).toEqual({ open: 2, mentions: 1, fresh: 0 });
    expect(ana.state().summary['doc:adr']!.fresh).toBe(1);
    expect(ana.state().seenAt).toBeGreaterThan(0);
    expect(ana.seen.has('diagram:mapa')).toBe(true);
  });

  it('nobody is told about their own mention of themselves', async () => {
    const adapter = await room();
    const bia = setup(adapter, BIA);
    bia.comments.attach(MAPA);
    await settled();
    expect(Object.values(bia.state().summary).map((entry) => entry.mentions)).toEqual([0, 0]);
  });
});
