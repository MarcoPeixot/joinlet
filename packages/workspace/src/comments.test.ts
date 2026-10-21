import { describe, expect, it } from 'vitest';
import {
  COMMENT_LIMITS, CommentError, TOMBSTONE_MS, applyCommentOp, checkCommentWrite, emptyComments, liveMessages, liveThreads, mergeComments, newThread,
  parseComments, printComments, pruneComments, validateComments,
} from './comments';
import { commentsPath, parseCommentsPath } from './commentsPath';
import type { CommentAuthor, CommentMessage, CommentOp, CommentThread, CommentsFile } from './comments';

const ANA: CommentAuthor = { name: 'Ana', color: '#3972dc' };
const BIA: CommentAuthor = { name: 'Bia', color: '#c75c8f' };
const message = (id: string, owner: string, author: CommentAuthor, at: number, extra: Partial<CommentMessage> = {}): CommentMessage => ({ id, owner, author, text: `texto ${id}`, at, ...extra });
const node = (id: string, owner: string, author: CommentAuthor, at: number, anchorId = 'API'): CommentThread => newThread({ id, anchor: { type: 'node', id: anchorId }, message: message(`${id}m`, owner, author, at, { text: `Sobre ${anchorId}` }) });
const file = (...threads: CommentThread[]): CommentsFile => ({ version: 1, threads });
const roundTrip = (value: CommentsFile, kind: 'diagram' | 'doc' = 'diagram') => parseComments(printComments(value), kind).file;

describe('paths', () => {
  it('names the file by kind and slug', () => {
    expect(commentsPath('diagram', 'visao-geral')).toBe('comments/diagram-visao-geral.json');
    expect(commentsPath('doc', 'adr-1')).toBe('comments/doc-adr-1.json');
  });
  it('reads a path back, and only the ones that are comment files', () => {
    expect(parseCommentsPath('comments/diagram-mapa.json')).toEqual({ kind: 'diagram', slug: 'mapa' });
    expect(parseCommentsPath('comments/doc-doc-x.json')).toEqual({ kind: 'doc', slug: 'doc-x' });
    for (const bad of ['comments/sketch-a.json', 'comments/diagram-.json', 'comments/diagram-__proto__.json', 'comments/../strukt.json', 'comments/diagram-a/b.json', 'docs/doc-a.json', 'comments/diagram-a.json.bak', 'comments/diagram-a.md']) {
      expect(parseCommentsPath(bad), bad).toBeNull();
    }
  });
});

describe('format', () => {
  it('prints canonically and reads back what it printed', () => {
    const thread = { ...node('t1', 'i:ana', ANA, 1000), status: 'resolved' as const, statusAt: 2000, statusBy: BIA };
    thread.messages.push(message('t1r', 'i:bia', BIA, 1500, { mentions: ['Ana'], edited: 1600 }));
    const original = file(thread, newThread({ id: 't2', anchor: { type: 'point', x: 10.5, y: -3 }, message: message('t2m', 'c:xyz', ANA, 500) }));
    const text = printComments(original);
    expect(text.endsWith('}\n')).toBe(true);
    expect(parseComments(text, 'diagram')).toEqual({ file: { version: 1, threads: [original.threads[1], original.threads[0]] }, warnings: [], broken: false });
    // The key order never changes: a file in git diffs line by line.
    expect(Object.keys(JSON.parse(text).threads[1])).toEqual(['id', 'anchor', 'by', 'created', 'status', 'statusAt', 'statusBy', 'messages']);
    expect(printComments(roundTrip(original))).toBe(text);
  });

  it('reads nothing as an empty file and an empty file as nothing wrong', () => {
    for (const text of [null, '', '  \n']) expect(parseComments(text, 'doc')).toEqual({ file: emptyComments(), warnings: [], broken: false });
  });

  it('flags a file that is not JSON, not a comments file or from a newer version as broken (so nobody overwrites it)', () => {
    for (const text of ['<<<<<<< HEAD\n{}', '[]', '"x"', '{"version":1}', '{"version":2,"threads":[]}']) {
      const parsed = parseComments(text, 'diagram');
      expect(parsed.broken, text).toBe(true);
      expect(parsed.file.threads).toEqual([]);
      expect(parsed.warnings[0]).toMatch(/comentários/i);
    }
  });

  it('drops what it cannot read and keeps the rest, saying so once per kind of problem', () => {
    const good = node('good', 'i:a', ANA, 10);
    const text = JSON.stringify({ version: 1, threads: [
      good, 7, { id: 'x' }, { ...node('bad1', 'i:a', ANA, 10), anchor: { type: 'point', x: 'a', y: 1 } }, { ...node('bad2', 'i:a', ANA, 10), anchor: { type: 'text', quote: 'a', prefix: '', suffix: '', from: 0 } },
      { ...node('bad3', 'i:a', ANA, 10), messages: [] },
      { ...node('mixed', 'i:a', ANA, 10), messages: [message('ok', 'i:a', ANA, 11, { text: 'bom' }), { id: 'sem-texto', owner: 'i:a', author: ANA, at: 12 }, message('long', 'i:a', ANA, 13, { text: 'x'.repeat(COMMENT_LIMITS.text + 1) })] },
    ] });
    const parsed = parseComments(text, 'diagram');
    expect(parsed.broken).toBe(false);
    expect(parsed.file.threads.map((thread) => thread.id)).toEqual(['good', 'mixed']);
    // The thread's own first message was replaced by the three in `messages` above: only the readable one stays.
    expect(parsed.file.threads[1]!.messages.map((entry) => entry.id)).toEqual(['ok']);
    expect(parsed.warnings.length).toBeGreaterThan(0);
    expect(new Set(parsed.warnings).size).toBe(parsed.warnings.length);
    expect(validateComments(text, 'diagram')).not.toBeNull();
  });

  it('takes anchors by kind: nodes, edges and points in diagrams, passages in docs', () => {
    const passage = { type: 'text', quote: 'trecho', prefix: 'o ', suffix: ' x', from: 3 };
    const doc = newThread({ id: 'd1', anchor: passage as never, message: message('d1m', 'i:a', ANA, 1) });
    expect(parseComments(printComments(file(doc)), 'doc').file.threads).toHaveLength(1);
    expect(parseComments(printComments(file(doc)), 'diagram').file.threads).toHaveLength(0);
    const edge = newThread({ id: 'e1', anchor: { type: 'edge', id: 'A->B' }, message: message('e1m', 'i:a', ANA, 1) });
    expect(parseComments(printComments(file(edge)), 'diagram').file.threads).toHaveLength(1);
    expect(parseComments(printComments(file(edge)), 'doc').file.threads).toHaveLength(0);
  });

  it('never lets __proto__ (or a constructor-like name) become a key or an id', () => {
    const hostile = JSON.stringify({ version: 1, threads: [
      { ...node('__proto__', 'i:a', ANA, 1) },
      { ...node('t1', 'i:a', ANA, 1), anchor: { type: 'node', id: '__proto__' } },
      { ...node('t2', 'i:a', ANA, 1), by: '__proto__' },
      { ...node('t3', 'i:a', ANA, 1), messages: [{ ...message('__proto__', 'i:a', ANA, 1) }] },
      { ...node('constructor', 'i:a', ANA, 2, 'toString') },
      { __proto__: { polluted: true }, ...node('t4', 'i:a', ANA, 3), '__proto__x': 1 },
    ] }).replace('"by":"__proto__"', '"by":"__proto__"');
    const parsed = parseComments(hostile, 'diagram');
    expect(parsed.file.threads.map((thread) => thread.id)).toEqual(['constructor', 't4']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(parsed.file.threads[0]!.anchor)).toEqual(['type', 'id']);
    const raw = '{"version":1,"threads":[{"__proto__":{"polluted":1},"id":"p1","anchor":{"type":"node","id":"A"},"by":"i:a","created":1,"status":"open","messages":[{"id":"m1","owner":"i:a","author":{"name":"Ana","color":"#3972dc"},"text":"oi","at":1,"__proto__":{"x":1}}]}]}';
    const out = parseComments(raw, 'diagram');
    expect(out.file.threads).toHaveLength(1);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(JSON.stringify(out.file)).not.toContain('polluted');
  });

  it('cuts a file past the limits to the limits, with a warning', () => {
    const many = Array.from({ length: COMMENT_LIMITS.threads + 5 }, (_, index) => node(`t${index}`, 'i:a', ANA, index));
    const parsed = parseComments(JSON.stringify({ version: 1, threads: many }), 'diagram');
    expect(parsed.file.threads).toHaveLength(COMMENT_LIMITS.threads);
    expect(parsed.warnings[0]).toContain(String(COMMENT_LIMITS.threads));
    const long = node('c', 'i:a', ANA, 1);
    for (let i = 0; i < COMMENT_LIMITS.messagesPerThread + 3; i++) long.messages.push(message(`r${i}`, 'i:a', ANA, 10 + i));
    expect(parseComments(JSON.stringify({ version: 1, threads: [long] }), 'diagram').file.threads[0]!.messages).toHaveLength(COMMENT_LIMITS.messagesPerThread);
  });

  it('validates strictly: any problem, the size and the author colors', () => {
    expect(validateComments(printComments(file(node('t', 'i:a', ANA, 1))), 'diagram')).toBeNull();
    expect(validateComments('x'.repeat(COMMENT_LIMITS.bytes + 1), 'diagram')).toMatch(/tamanho/);
    expect(validateComments('{', 'diagram')).toMatch(/JSON/);
    const bad = file({ ...node('t', 'i:a', ANA, 1), by: 'com espaço' });
    expect(validateComments(printComments(bad), 'diagram')).not.toBeNull();
    expect(validateComments(JSON.stringify({ version: 1, threads: [{ ...node('t', 'i:a', { name: 'Ana', color: 'azul' }, 1) }] }), 'diagram')).not.toBeNull();
  });
});

describe('hostile files (duplicate ids, floods)', () => {
  // ~780 KB: thousands of threads with the same id, each with its own message, used to cost seconds in the merge.
  const flood = (count: number, id = (i: number) => 't') => JSON.stringify({ version: 1, threads: Array.from({ length: count }, (_, i) => ({ ...node(id(i), 'i:a', ANA, 1000 + i), messages: [message(`m${i}`, 'i:a', ANA, 1000 + i, { text: 'x' })] })) });
  const timed = <T>(run: () => T): { value: T; ms: number } => { const start = performance.now(); const value = run(); return { value, ms: performance.now() - start }; };

  it('refuses duplicate thread ids and duplicate message ids before any merge, in bounded time', () => {
    const text = flood(3600);
    expect(text.length).toBeGreaterThan(700_000);
    const { value, ms } = timed(() => validateComments(text, 'diagram'));
    expect(value).toMatch(/repetid/);
    expect(ms).toBeLessThan(150);
    const dupMessages = JSON.stringify({ version: 1, threads: [{ ...node('t', 'i:a', ANA, 1), messages: Array.from({ length: 4000 }, (_, i) => message('same', 'i:a', ANA, 10 + i, { text: 'x'.repeat(100) })) }] });
    const second = timed(() => validateComments(dupMessages, 'diagram'));
    expect(second.value).toMatch(/repetid/);
    expect(second.ms).toBeLessThan(150);
    expect(timed(() => checkCommentWrite(null, text, 'diagram', 'i:a', 5000)).ms).toBeLessThan(150);
  });

  it('reads a damaged file on disk in bounded time too: the raw entries are capped before they are read', () => {
    const { value, ms } = timed(() => parseComments(flood(3600), 'diagram'));
    expect(ms).toBeLessThan(150);
    expect(value.file.threads.length).toBeLessThanOrEqual(COMMENT_LIMITS.threads);
    expect(value.warnings.join(' ')).toMatch(/ignorado/);
    const many = flood(20_000, (i) => `t${i}`);
    const wide = timed(() => parseComments(many, 'diagram'));
    expect(wide.ms).toBeLessThan(400);
    expect(wide.value.file.threads).toHaveLength(COMMENT_LIMITS.threads);
  });

  it('still merges legitimate duplicate copies (a git merge) into the same thread, in one pass', () => {
    const a = node('t', 'i:a', ANA, 10);
    const b = { ...a, messages: [...a.messages, message('r1', 'i:b', BIA, 20)] };
    const c = { ...a, status: 'resolved' as const, statusAt: 30, statusBy: BIA, messages: [...a.messages, message('r2', 'i:c', BIA, 25)] };
    const parsed = parseComments(JSON.stringify({ version: 1, threads: [a, b, c] }), 'diagram').file;
    expect(printComments(parsed)).toBe(printComments(mergeComments(mergeComments(file(a), file(b)), file(c))));
    expect(parsed.threads[0]!.messages.map((entry) => entry.id)).toEqual(['tm', 'r1', 'r2']);
  });

  it('merges many replicas of one thread in about linear time', () => {
    const replicas = Array.from({ length: 400 }, (_, i) => ({ ...node('t', 'i:a', ANA, 10), messages: [message('tm', 'i:a', ANA, 10), message(`r${i}`, 'i:a', ANA, 20 + i)] }));
    const { value, ms } = timed(() => replicas.reduce((acc, thread) => mergeComments(acc, file(thread)), emptyComments()));
    expect(value.threads[0]!.messages).toHaveLength(401);
    expect(ms).toBeLessThan(500);
  });
});

describe('changes', () => {
  const base = file(node('t1', 'i:ana', ANA, 1000));
  const reply = (id: string, owner: string, author: CommentAuthor, at: number, text = 'resposta'): CommentOp => ({ op: 'reply', thread: 't1', message: message(id, owner, author, at, { text }) });

  it('adds a conversation, merging into one that is already there (a replay)', () => {
    const created = node('t2', 'i:bia', BIA, 2000, 'DB');
    const once = applyCommentOp(base, { op: 'thread', thread: created });
    expect(once.threads.map((thread) => thread.id)).toEqual(['t1', 't2']);
    expect(applyCommentOp(once, { op: 'thread', thread: created })).toEqual(once);
  });

  it('adds a reply once, even when replayed, and keeps messages in time order', () => {
    const op = reply('r2', 'i:bia', BIA, 3000);
    const once = applyCommentOp(applyCommentOp(base, reply('r1', 'i:bia', BIA, 2000)), op);
    expect(applyCommentOp(once, op)).toEqual(once);
    expect(once.threads[0]!.messages.map((entry) => entry.id)).toEqual(['t1m', 'r1', 'r2']);
  });

  it('ignores a reply to a conversation that is gone or deleted', () => {
    expect(applyCommentOp(base, { ...reply('r', 'i:b', BIA, 5), thread: 'nope' } as CommentOp)).toBe(base);
    const deleted = applyCommentOp(base, { op: 'delete', thread: 't1', at: 2000 });
    expect(applyCommentOp(deleted, reply('r', 'i:b', BIA, 3000))).toEqual(deleted);
  });

  it('refuses an empty comment and one over the limit', () => {
    expect(() => applyCommentOp(base, reply('r', 'i:b', BIA, 5, '   '))).toThrow(CommentError);
    expect(() => applyCommentOp(base, reply('r', 'i:b', BIA, 5, 'x'.repeat(COMMENT_LIMITS.text + 1)))).toThrow(/passa de/);
    expect(() => applyCommentOp(base, { op: 'thread', thread: newThread({ id: 'n', anchor: { type: 'node', id: 'A' }, message: message('nm', 'i:a', ANA, 1, { text: ' ' }) }) })).toThrow(CommentError);
  });

  it('refuses to pass the conversation, message and thread limits, in pt-BR', () => {
    let full = emptyComments();
    for (let i = 0; i < COMMENT_LIMITS.threads; i++) full = applyCommentOp(full, { op: 'thread', thread: node(`t${i}`, 'i:a', ANA, i + 1) });
    expect(() => applyCommentOp(full, { op: 'thread', thread: node('extra', 'i:a', ANA, 9999) })).toThrow(/limite|passou/i);
    let long = base;
    for (let i = 0; i < COMMENT_LIMITS.messagesPerThread - 1; i++) long = applyCommentOp(long, reply(`r${i}`, 'i:a', ANA, 2000 + i));
    expect(() => applyCommentOp(long, reply('over', 'i:a', ANA, 99_999))).toThrow(CommentError);
  });

  it('edits a message (text, mentions, edited date) and not one that was deleted', () => {
    const edited = applyCommentOp(base, { op: 'edit', thread: 't1', message: 't1m', text: 'Texto novo @Bia', mentions: ['Bia'], at: 5000 });
    expect(edited.threads[0]!.messages[0]).toMatchObject({ text: 'Texto novo @Bia', mentions: ['Bia'], edited: 5000, at: 1000 });
    const again = applyCommentOp(edited, { op: 'edit', thread: 't1', message: 't1m', text: 'Sem menção', mentions: [], at: 6000 });
    expect(again.threads[0]!.messages[0]!.mentions).toBeUndefined();
    const removed = applyCommentOp(applyCommentOp(base, reply('r', 'i:b', BIA, 2000)), { op: 'remove', thread: 't1', message: 'r', at: 3000 });
    expect(applyCommentOp(removed, { op: 'edit', thread: 't1', message: 'r', text: 'ressuscitou', mentions: [], at: 4000 })).toEqual(removed);
  });

  it('deletes a message as a tombstone with no text, and the conversation with its last message', () => {
    const withReply = applyCommentOp(base, reply('r', 'i:b', BIA, 2000, 'segredo'));
    const removed = applyCommentOp(withReply, { op: 'remove', thread: 't1', message: 'r', at: 3000 });
    expect(removed.threads[0]!.messages[1]).toEqual({ id: 'r', owner: 'i:b', author: BIA, text: '', at: 2000, deleted: 3000 });
    expect(printComments(removed)).not.toContain('segredo');
    expect(liveMessages(removed.threads[0]!)).toHaveLength(1);
    const empty = applyCommentOp(removed, { op: 'remove', thread: 't1', message: 't1m', at: 4000 });
    expect(empty.threads[0]!.deleted).toBe(4000);
    expect(liveThreads(empty)).toEqual([]);
  });

  it('deletes a conversation: every message goes with it and no text stays in the file', () => {
    const withReply = applyCommentOp(base, reply('r', 'i:b', BIA, 2000, 'dado sensível'));
    const gone = applyCommentOp(withReply, { op: 'delete', thread: 't1', at: 3000 });
    expect(gone.threads[0]!.deleted).toBe(3000);
    expect(gone.threads[0]!.messages.every((entry) => entry.deleted !== undefined && entry.text === '')).toBe(true);
    expect(printComments(gone)).not.toContain('dado sensível');
    expect(liveThreads(gone)).toEqual([]);
  });

  it('resolves and reopens; the latest change wins, whatever order they arrive in', () => {
    const resolved = applyCommentOp(base, { op: 'status', thread: 't1', status: 'resolved', by: BIA, at: 3000 });
    expect(resolved.threads[0]).toMatchObject({ status: 'resolved', statusAt: 3000, statusBy: BIA });
    const reopened = applyCommentOp(resolved, { op: 'status', thread: 't1', status: 'open', by: ANA, at: 4000 });
    expect(reopened.threads[0]).toMatchObject({ status: 'open', statusAt: 4000, statusBy: ANA });
    // A late arrival of an older change does nothing.
    expect(applyCommentOp(reopened, { op: 'status', thread: 't1', status: 'resolved', by: BIA, at: 3000 })).toEqual(reopened);
  });

  it('drops conversations deleted long ago (they hold no text) when a new one is opened', () => {
    const gone = applyCommentOp(base, { op: 'delete', thread: 't1', at: 1000 });
    expect(pruneComments(gone, 1000 + TOMBSTONE_MS - 1).threads).toHaveLength(1);
    expect(pruneComments(gone, 1000 + TOMBSTONE_MS).threads).toHaveLength(0);
    const opened = applyCommentOp(gone, { op: 'thread', thread: node('t9', 'i:b', BIA, 1000 + TOMBSTONE_MS + 5) });
    expect(opened.threads.map((thread) => thread.id)).toEqual(['t9']);
  });
});

/** A small seeded generator so a failing case can be replayed. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('merge', () => {
  const people = [{ owner: 'i:ana', author: ANA }, { owner: 'i:bia', author: BIA }, { owner: 'c:cadu', author: { name: 'Cadu', color: '#319b77' } }];

  /** A replica makes a random change on top of what it has (the ids it can act on are the ones it has seen). */
  function change(replica: CommentsFile, rnd: () => number, clock: { now: number }, serial: { n: number }): CommentsFile {
    const person = people[Math.floor(rnd() * people.length)]!;
    clock.now += 1 + Math.floor(rnd() * 3);
    const live = replica.threads.filter((thread) => thread.deleted === undefined);
    const thread = live[Math.floor(rnd() * live.length)];
    const roll = rnd();
    const id = `x${serial.n++}`;
    try {
      if (!thread || roll < 0.25) return applyCommentOp(replica, { op: 'thread', thread: node(id, person.owner, person.author, clock.now) });
      if (roll < 0.5) return applyCommentOp(replica, { op: 'reply', thread: thread.id, message: message(id, person.owner, person.author, clock.now, { text: `msg ${id}` }) });
      if (roll < 0.62) return applyCommentOp(replica, { op: 'edit', thread: thread.id, message: thread.messages[0]!.id, text: `editado ${id}`, mentions: [], at: clock.now });
      if (roll < 0.74) return applyCommentOp(replica, { op: 'remove', thread: thread.id, message: thread.messages[Math.floor(rnd() * thread.messages.length)]!.id, at: clock.now });
      if (roll < 0.9) return applyCommentOp(replica, { op: 'status', thread: thread.id, status: rnd() < 0.5 ? 'open' : 'resolved', by: person.author, at: clock.now });
      return applyCommentOp(replica, { op: 'delete', thread: thread.id, at: clock.now });
    } catch { return replica; }
  }

  it('is the same whichever copy is first, and merging a copy with itself changes nothing', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rnd = random(seed);
      const clock = { now: 1000 };
      const serial = { n: 0 };
      let a = emptyComments();
      let b = emptyComments();
      for (let step = 0; step < 25; step++) {
        if (rnd() < 0.5) a = change(a, rnd, clock, serial); else b = change(b, rnd, clock, serial);
        if (rnd() < 0.15) { const merged = mergeComments(a, b); a = merged; }
      }
      expect(printComments(mergeComments(a, b)), `seed ${seed}`).toBe(printComments(mergeComments(b, a)));
      expect(printComments(mergeComments(a, a))).toBe(printComments(a));
      expect(printComments(mergeComments(mergeComments(a, b), b))).toBe(printComments(mergeComments(a, b)));
    }
  });

  it('is associative: three replicas end in the same file whatever the order of the merges', () => {
    for (let seed = 100; seed <= 140; seed++) {
      const rnd = random(seed);
      const clock = { now: 1000 };
      const serial = { n: 0 };
      const replicas = [emptyComments(), emptyComments(), emptyComments()];
      for (let step = 0; step < 30; step++) {
        const index = Math.floor(rnd() * 3);
        replicas[index] = change(replicas[index]!, rnd, clock, serial);
        if (rnd() < 0.2) { const to = Math.floor(rnd() * 3); replicas[to] = mergeComments(replicas[to]!, replicas[index]!); }
      }
      const [a, b, c] = replicas as [CommentsFile, CommentsFile, CommentsFile];
      const left = printComments(mergeComments(mergeComments(a, b), c));
      expect(printComments(mergeComments(a, mergeComments(b, c))), `seed ${seed}`).toBe(left);
      expect(printComments(mergeComments(mergeComments(c, a), b))).toBe(left);
    }
  });

  it('keeps both sides\' new messages, the latest edit, a delete over an edit and the latest status', () => {
    const start = file(node('t1', 'i:ana', ANA, 1000));
    const bia = applyCommentOp(applyCommentOp(start, { op: 'reply', thread: 't1', message: message('rb', 'i:bia', BIA, 2000) }), { op: 'edit', thread: 't1', message: 't1m', text: 'versão da Bia', mentions: [], at: 2500 });
    const ana = applyCommentOp(applyCommentOp(start, { op: 'reply', thread: 't1', message: message('ra', 'i:ana', ANA, 2100) }), { op: 'status', thread: 't1', status: 'resolved', by: ANA, at: 2200 });
    const merged = mergeComments(bia, ana).threads[0]!;
    expect(merged.messages.map((entry) => entry.id)).toEqual(['t1m', 'rb', 'ra']);
    expect(merged.messages[0]!.text).toBe('versão da Bia');
    expect(merged).toMatchObject({ status: 'resolved', statusBy: ANA });
    const removed = applyCommentOp(start, { op: 'remove', thread: 't1', message: 't1m', at: 1900 });
    expect(mergeComments(bia, removed).threads[0]!.deleted).toBe(1900);
  });

  it('never brings a deleted message back from an old copy', () => {
    const start = applyCommentOp(file(node('t1', 'i:ana', ANA, 1000)), { op: 'reply', thread: 't1', message: message('r', 'i:bia', BIA, 1100, { text: 'oi' }) });
    const removed = applyCommentOp(start, { op: 'remove', thread: 't1', message: 'r', at: 1200 });
    const stale = mergeComments(removed, start);
    expect(stale.threads[0]!.messages.find((entry) => entry.id === 'r')).toMatchObject({ deleted: 1200, text: '' });
    expect(printComments(stale)).not.toContain('"oi"');
  });
});

describe('the host rule for the comment role', () => {
  const me = 'i:cris';
  const CRIS: CommentAuthor = { name: 'Cris', color: '#319b77' };
  const NOW = 1_000_000;
  const before = file(node('t1', 'i:ana', ANA, 1000), { ...node('t2', me, CRIS, 1100, 'DB'), status: 'open' });
  const beforeText = printComments(before);
  const check = (after: CommentsFile, text: string | null = beforeText) => checkCommentWrite(text, printComments(after), 'diagram', me, NOW);
  const apply = (...ops: CommentOp[]) => ops.reduce(applyCommentOp, before);

  it('lets it start a conversation and reply as itself', () => {
    expect(check(apply({ op: 'thread', thread: node('t3', me, CRIS, 2000, 'Web') }))).toBeNull();
    expect(check(apply({ op: 'reply', thread: 't1', message: message('r1', me, CRIS, 2000, { text: 'oi' }) }))).toBeNull();
    expect(checkCommentWrite(null, printComments(file(node('t3', me, CRIS, 2000))), 'diagram', me, NOW)).toBeNull();
  });

  it('lets it edit and delete its own messages and conversations', () => {
    const withReply = apply({ op: 'reply', thread: 't1', message: message('r1', me, CRIS, 2000, { text: 'oi' }) });
    const text = printComments(withReply);
    expect(check(applyCommentOp(withReply, { op: 'edit', thread: 't1', message: 'r1', text: 'corrigido', mentions: ['Ana'], at: 3000 }), text)).toBeNull();
    expect(check(applyCommentOp(withReply, { op: 'remove', thread: 't1', message: 'r1', at: 3000 }), text)).toBeNull();
    expect(check(applyCommentOp(before, { op: 'delete', thread: 't2', at: 3000 }))).toBeNull();
  });

  it('lets it resolve and reopen any conversation', () => {
    expect(check(apply({ op: 'status', thread: 't1', status: 'resolved', by: CRIS, at: 3000 }))).toBeNull();
  });

  it('refuses to touch what others wrote: edit, delete, drop, or replace', () => {
    expect(check(apply({ op: 'edit', thread: 't1', message: 't1m', text: 'forjado', mentions: [], at: 3000 }))).toMatch(/próprios/);
    expect(check(apply({ op: 'remove', thread: 't1', message: 't1m', at: 3000 }))).toMatch(/próprios/);
    expect(check(apply({ op: 'delete', thread: 't1', at: 3000 }))).toMatch(/próprios/);
    expect(check(file(before.threads[1]!))).toMatch(/próprios/);
    expect(check(emptyComments())).toMatch(/próprios/);
  });

  it('refuses to speak as someone else, or to change authorship, anchors, owners and dates', () => {
    expect(check(apply({ op: 'reply', thread: 't1', message: message('r1', 'i:ana', ANA, 2000, { text: 'finjo ser a Ana' }) }))).toMatch(/próprios/);
    expect(check(apply({ op: 'thread', thread: node('t3', 'i:ana', ANA, 2000) }))).toMatch(/próprios/);
    const forged = JSON.parse(beforeText) as { threads: Array<Record<string, any>> };
    forged.threads[1]!.anchor = { type: 'node', id: 'Outro' };
    expect(checkCommentWrite(beforeText, JSON.stringify(forged), 'diagram', me, NOW)).toMatch(/próprios/);
    const retitled = JSON.parse(beforeText) as { threads: Array<Record<string, any>> };
    retitled.threads[1]!.messages[0].author = { name: 'Ana', color: '#3972dc' };
    expect(checkCommentWrite(beforeText, JSON.stringify(retitled), 'diagram', me, NOW)).toMatch(/próprios/);
    const redated = JSON.parse(beforeText) as { threads: Array<Record<string, any>> };
    redated.threads[1]!.messages[0].at = 5;
    expect(checkCommentWrite(beforeText, JSON.stringify(redated), 'diagram', me, NOW)).toMatch(/próprios/);
    const reowned = JSON.parse(beforeText) as { threads: Array<Record<string, any>> };
    reowned.threads[1]!.messages[0].owner = 'i:ana';
    expect(checkCommentWrite(beforeText, JSON.stringify(reowned), 'diagram', me, NOW)).toMatch(/próprios/);
  });

  it('refuses to bring a deleted message back or to delete someone else\'s conversation by tombstoning it', () => {
    const withReply = apply({ op: 'reply', thread: 't1', message: message('r1', me, CRIS, 2000, { text: 'oi' }) });
    const removed = applyCommentOp(withReply, { op: 'remove', thread: 't1', message: 'r1', at: 3000 });
    expect(check(withReply, printComments(removed))).toMatch(/próprios/);
  });

  it('refuses an invalid file, a file over the limits and any file over a broken one', () => {
    expect(checkCommentWrite(beforeText, '{ não é json', 'diagram', me, NOW)).toMatch(/JSON/);
    expect(checkCommentWrite(beforeText, `{"version":1,"threads":[],"x":"${'a'.repeat(COMMENT_LIMITS.bytes)}"}`, 'diagram', me, NOW)).toMatch(/tamanho/);
    expect(checkCommentWrite('<<<<<<< conflito', printComments(file(node('t3', me, CRIS, 2000))), 'diagram', me, NOW)).toMatch(/erros/);
  });

  it('refuses dates far in the future (they would win every later change)', () => {
    expect(check(apply({ op: 'thread', thread: node('t3', me, CRIS, NOW + 3_600_000) }))).toMatch(/próprios/);
    expect(check(apply({ op: 'status', thread: 't1', status: 'resolved', by: CRIS, at: NOW + 3_600_000 }))).toMatch(/próprios/);
    expect(check(apply({ op: 'reply', thread: 't1', message: message('r1', me, CRIS, NOW + 3_600_000, { text: 'oi' }) }))).toMatch(/próprios/);
    // The small difference between two clocks is fine.
    expect(check(apply({ op: 'thread', thread: node('t3', me, CRIS, NOW + 60_000) }))).toBeNull();
  });

  it('allows dropping a long-deleted conversation (the cleanup), and nothing else that vanishes', () => {
    const deleted = applyCommentOp(before, { op: 'delete', thread: 't2', at: 1500 });
    const text = printComments(deleted);
    expect(checkCommentWrite(text, printComments(file(deleted.threads[0]!)), 'diagram', 'i:outro', NOW)).toBeNull();
    expect(checkCommentWrite(text, printComments(file(deleted.threads[1]!)), 'diagram', 'i:outro', NOW)).toMatch(/próprios/);
  });

  it('judges a doc file by doc anchors', () => {
    const passage = newThread({ id: 'd1', anchor: { type: 'text', quote: 'x', prefix: '', suffix: '', from: 0 }, message: message('d1m', me, CRIS, 2000, { text: 'oi' }) });
    expect(checkCommentWrite(null, printComments(file(passage)), 'doc', me, NOW)).toBeNull();
    expect(checkCommentWrite(null, printComments(file(passage)), 'diagram', me, NOW)).not.toBeNull();
  });
});
