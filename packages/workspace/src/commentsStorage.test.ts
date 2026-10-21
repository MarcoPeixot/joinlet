import { describe, expect, it } from 'vitest';
import { CommentError, newThread, parseComments, printComments } from './comments';
import { commentsPath, removeComments } from './commentsPath';
import type { CommentAuthor, CommentOp } from './comments';
import { commitComments, listCommentFiles, readComments } from './commentsStorage';
import { StorageConflict, createMemoryAdapter } from './storage';
import type { StorageAdapter } from './storage';

const ANA: CommentAuthor = { name: 'Ana', color: '#3972dc' };
const PATH = commentsPath('diagram', 'mapa');
const thread = (id: string, at: number): CommentOp => ({ op: 'thread', thread: newThread({ id, anchor: { type: 'node', id: 'API' }, message: { id: `${id}m`, owner: 'i:ana', author: ANA, text: `texto ${id}`, at } }) });

/** What the host's REST surface does for a guest: a write names the text it read, and loses if the file changed since. */
function checking(shared: StorageAdapter, beforeWrite?: () => Promise<void>): StorageAdapter {
  const baseline = new Map<string, string | null>();
  return {
    ...shared,
    read: async (path) => { const text = await shared.read(path); baseline.set(path, text); return text; },
    write: async (path, text) => {
      await beforeWrite?.();
      if ((await shared.read(path)) !== (baseline.get(path) ?? null)) throw new StorageConflict('Arquivo alterado fora da sessão.');
      await shared.write(path, text);
    },
  };
}

describe('commitComments', () => {
  it('creates the file on the first comment and appends later ones', async () => {
    const adapter = createMemoryAdapter();
    expect(await adapter.read(PATH)).toBeNull();
    await commitComments(adapter, 'diagram', 'mapa', [thread('t1', 1000)]);
    await commitComments(adapter, 'diagram', 'mapa', [thread('t2', 2000)]);
    const { file, warnings } = await readComments(adapter, 'diagram', 'mapa');
    expect(file.threads.map((entry) => entry.id)).toEqual(['t1', 't2']);
    expect(warnings).toEqual([]);
    expect(await adapter.read(PATH)).toBe(printComments(file));
  });

  it('writes nothing when the changes are already in the file (a replay), nor an empty file for nothing', async () => {
    const adapter = createMemoryAdapter();
    await commitComments(adapter, 'diagram', 'mapa', []);
    expect(await adapter.read(PATH)).toBeNull();
    await commitComments(adapter, 'diagram', 'mapa', [thread('t1', 1000)]);
    let writes = 0;
    const counting = { ...adapter, write: async (path: string, text: string) => { writes++; await adapter.write(path, text); } };
    await commitComments(counting, 'diagram', 'mapa', [thread('t1', 1000)]);
    expect(writes).toBe(0);
  });

  it('keeps everyone\'s comment when two write at once: the loser reads again and redoes its change', async () => {
    const shared = createMemoryAdapter();
    let raced = false;
    // Between the first guest's read and its write, a second guest gets its comment in.
    const first = checking(shared, async () => {
      if (raced) return;
      raced = true;
      await commitComments(checking(shared), 'diagram', 'mapa', [thread('bia', 1500)]);
    });
    const result = await commitComments(first, 'diagram', 'mapa', [thread('ana', 1000)]);
    expect(result.file.threads.map((entry) => entry.id)).toEqual(['ana', 'bia']);
    expect(parseComments(await shared.read(PATH), 'diagram').file.threads.map((entry) => entry.id)).toEqual(['ana', 'bia']);
  });

  it('gives up with the conflict after the attempts it was given, and fails on any other write error at once', async () => {
    const shared = createMemoryAdapter();
    const stubborn: StorageAdapter = { ...shared, write: async () => { throw new StorageConflict('Arquivo alterado fora da sessão.'); } };
    let waits = 0;
    await expect(commitComments(stubborn, 'diagram', 'mapa', [thread('t1', 1)], { attempts: 3, wait: async () => { waits++; } })).rejects.toBeInstanceOf(StorageConflict);
    expect(waits).toBe(2);
    const refused: StorageAdapter = { ...shared, write: async () => { throw new Error('Este convite só pode comentar.'); } };
    await expect(commitComments(refused, 'diagram', 'mapa', [thread('t1', 1)])).rejects.toThrow('só pode comentar');
  });

  it('never overwrites a file it cannot read', async () => {
    const adapter = createMemoryAdapter({ [PATH]: '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> outro\n' });
    await expect(commitComments(adapter, 'diagram', 'mapa', [thread('t1', 1)])).rejects.toThrow(/JSON.*comments\/diagram-mapa\.json/s);
    expect(await adapter.read(PATH)).toContain('<<<<<<<');
  });

  it('reports the changes a limit refused and applies the others', async () => {
    const adapter = createMemoryAdapter();
    const tooLong: CommentOp = { op: 'thread', thread: newThread({ id: 'big', anchor: { type: 'node', id: 'A' }, message: { id: 'bigm', owner: 'i:ana', author: ANA, text: 'x'.repeat(5000), at: 5 } }) };
    const result = await commitComments(adapter, 'diagram', 'mapa', [tooLong, thread('ok', 6)]);
    expect(result.refused[0]).toBeInstanceOf(CommentError);
    expect(result.file.threads.map((entry) => entry.id)).toEqual(['ok']);
  });
});

describe('files', () => {
  it('lists the comment files among a workspace\'s paths', () => {
    expect(listCommentFiles(['strukt.json', 'comments/diagram-a.json', 'comments/doc-b.json', 'comments/x.json', 'diagrams/a.strukt.json'])).toEqual([
      { kind: 'diagram', slug: 'a', path: 'comments/diagram-a.json' }, { kind: 'doc', slug: 'b', path: 'comments/doc-b.json' },
    ]);
  });

  it('removes the comments of a deleted item, and a missing file is not an error', async () => {
    const adapter = createMemoryAdapter({ [PATH]: printComments({ version: 1, threads: [] }) });
    await removeComments(adapter, 'diagram', 'mapa');
    expect(await adapter.read(PATH)).toBeNull();
    await expect(removeComments(adapter, 'diagram', 'mapa')).resolves.toBeUndefined();
  });
});
