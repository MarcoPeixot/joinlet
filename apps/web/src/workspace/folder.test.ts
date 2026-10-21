import { describe, expect, it } from 'vitest';
import { createFolderAdapter, hasPermission, requestPermission } from './folder';
import type { DirHandleLike, FileHandleLike } from './folder';

/** In-memory stand-in for FileSystemDirectoryHandle (the real API only exists in Chrome/Edge). */
function fakeDir(name: string, permission: PermissionState = 'granted'): DirHandleLike & { tree: Map<string, unknown> } {
  const tree = new Map<string, unknown>();
  const notFound = () => new DOMException(`${name}: não encontrado`, 'NotFoundError');
  const dir: DirHandleLike & { tree: Map<string, unknown> } = {
    kind: 'directory',
    name,
    tree,
    async getDirectoryHandle(child, options) {
      const found = tree.get(child) as DirHandleLike | undefined;
      if (found?.kind === 'directory') return found;
      if (!options?.create) throw notFound();
      const created = fakeDir(child);
      tree.set(child, created);
      return created;
    },
    async getFileHandle(child, options) {
      const found = tree.get(child) as FileHandleLike | undefined;
      if (found?.kind === 'file') return found;
      if (!options?.create) throw notFound();
      let text = '';
      const file: FileHandleLike = {
        kind: 'file',
        name: child,
        getFile: async () => ({ text: async () => text, lastModified: 1 }),
        createWritable: async () => {
          let draft = '';
          return { write: async (data: string) => void (draft += data), close: async () => void (text = draft) };
        },
      };
      tree.set(child, file);
      return file;
    },
    async removeEntry(child) {
      if (!tree.delete(child)) throw notFound();
    },
    async *values() {
      yield* tree.values() as IterableIterator<DirHandleLike | FileHandleLike>;
    },
    queryPermission: async () => permission,
    requestPermission: async () => permission,
  };
  return dir;
}

describe('createFolderAdapter', () => {
  it('keeps the workspace inside .arch/ of the chosen folder', async () => {
    const root = fakeDir('loja');
    const adapter = createFolderAdapter(root);
    expect(adapter.label).toBe('loja/.arch');
    await adapter.write('diagrams/a.strukt', 'A > B\n');
    await adapter.write('strukt.json', '{}');
    expect(root.tree.has('.arch')).toBe(true);
    expect(await adapter.read('diagrams/a.strukt')).toBe('A > B\n');
    expect(await adapter.list()).toEqual(['diagrams/a.strukt', 'strukt.json']);
  });

  it('reads missing files as null and removes them idempotently', async () => {
    const adapter = createFolderAdapter(fakeDir('vazio'));
    expect(await adapter.read('strukt.json')).toBeNull();
    expect(await adapter.read('docs/nada.md')).toBeNull();
    expect(await adapter.list()).toEqual([]);
    await adapter.remove('docs/nada.md');
    await adapter.write('docs/a.md', 'a');
    await adapter.remove('docs/a.md');
    expect(await adapter.read('docs/a.md')).toBeNull();
  });

  it('only writes the new text when the writable closes', async () => {
    const adapter = createFolderAdapter(fakeDir('loja'));
    await adapter.write('docs/a.md', 'primeira');
    await adapter.write('docs/a.md', 'segunda');
    expect(await adapter.read('docs/a.md')).toBe('segunda');
  });

  it('stamps every file under .arch/ and notices an external change', async () => {
    const root = fakeDir('loja');
    const adapter = createFolderAdapter(root);
    await adapter.write('strukt.json', '{}');
    await adapter.write('docs/a.md', 'x');
    const first = await adapter.stamps!();
    expect(Object.keys(first).sort()).toEqual(['docs/a.md', 'strukt.json']);
    expect(first['docs/a.md']).toBeGreaterThan(0);

    // Someone else (an agent) rewrote the file: only its stamp changes.
    const docsDir = (root.tree.get('.arch') as DirHandleLike & { tree: Map<string, unknown> }).tree.get('docs') as DirHandleLike & { tree: Map<string, unknown> };
    const file = docsDir.tree.get('a.md') as FileHandleLike;
    file.getFile = async () => ({ text: async () => 'outro', lastModified: 99 });
    expect((await adapter.stamps!())['docs/a.md']).toBe(99);
  });

  it('does not stamp versions/ or context/ (the app writes them itself; an agent\'s versions show up on next open)', async () => {
    const root = fakeDir('loja');
    const adapter = createFolderAdapter(root);
    await adapter.write('strukt.json', '{}');
    await adapter.write('versions/a/20260101T000000000Z-x1.json', '{}');
    await adapter.write('versions/a/index.json', '[]');
    await adapter.write('context/ARCHITECTURE.md', 'x');
    expect(Object.keys(await adapter.stamps!())).toEqual(['strukt.json']);
    expect((await adapter.list()).sort()).toEqual(['context/ARCHITECTURE.md', 'strukt.json', 'versions/a/20260101T000000000Z-x1.json', 'versions/a/index.json']);
  });

  it('aborts the writable and rethrows when the write itself fails, releasing the swap file for a retry', async () => {
    const root = fakeDir('loja');
    const adapter = createFolderAdapter(root);
    await adapter.write('docs/a.md', 'inicial');

    const archDir = root.tree.get('.arch') as DirHandleLike & { tree: Map<string, unknown> };
    const docsDir = archDir.tree.get('docs') as DirHandleLike & { tree: Map<string, unknown> };
    const file = docsDir.tree.get('a.md') as FileHandleLike;

    let text = 'inicial';
    let aborted = false;
    let shouldFail = true;
    file.getFile = async () => ({ text: async () => text, lastModified: 1 });
    file.createWritable = async () => {
      if (shouldFail) {
        return {
          write: async () => {
            throw new Error('disco cheio');
          },
          close: async () => {
            throw new Error('não deveria fechar depois de falhar');
          },
          abort: async () => void (aborted = true),
        };
      }
      let draft = '';
      return { write: async (data: string) => void (draft += data), close: async () => void (text = draft) };
    };

    await expect(adapter.write('docs/a.md', 'nunca grava')).rejects.toThrow('disco cheio');
    expect(aborted).toBe(true);
    expect(await adapter.read('docs/a.md')).toBe('inicial');

    shouldFail = false;
    await adapter.write('docs/a.md', 'segunda tentativa');
    expect(await adapter.read('docs/a.md')).toBe('segunda tentativa');
  });
});

describe('hasPermission', () => {
  it('is true only when read-write access is granted', async () => {
    expect(await hasPermission(fakeDir('a', 'granted'))).toBe(true);
    expect(await hasPermission(fakeDir('a', 'prompt'))).toBe(false);
  });
});

describe('requestPermission', () => {
  it('is true only when the request grants read-write access', async () => {
    expect(await requestPermission(fakeDir('a', 'granted'))).toBe(true);
    expect(await requestPermission(fakeDir('a', 'denied'))).toBe(false);
  });
});
