import { describe, expect, it } from 'vitest';
import { buildFolderTree, createFolder, deleteFolder, folderName, folderParent, knownFolders, moveItem, normalizeFolder, renameFolder } from './folders';
import { emptyManifest, parseManifest, printManifest } from './manifest';
import type { Manifest } from './manifest';

const base = (): Manifest => ({
  ...emptyManifest('Loja'),
  diagrams: [
    { slug: 'api', title: 'API', folder: 'Backend' },
    { slug: 'db', title: 'Banco', folder: 'Backend/Dados' },
    { slug: 'web', title: 'Web' },
  ],
  docs: [{ slug: 'notas', title: 'Notas' }],
});

describe('normalizeFolder', () => {
  it('trims segments, collapses blanks and joins with "/"', () => {
    expect(normalizeFolder('  Backend / APIs  ')).toBe('Backend/APIs');
    expect(normalizeFolder('A//B/')).toBe('A/B');
  });
  it('refuses empty, dot and prototype names, too-deep paths and long names', () => {
    for (const bad of ['', '   ', '/', '.', 'A/..', '__proto__', 'A/__proto__/B', 'a/b/c/d/e', 'x'.repeat(61)]) expect(normalizeFolder(bad)).toBeNull();
  });
});

describe('folder paths', () => {
  it('names and parents', () => {
    expect(folderName('Backend/Dados')).toBe('Dados');
    expect(folderParent('Backend/Dados')).toBe('Backend');
    expect(folderParent('Backend')).toBeNull();
  });
});

describe('buildFolderTree', () => {
  it('nests items under their folders, keeps manifest order, sorts folders and shows declared empty ones', () => {
    const tree = buildFolderTree(base().diagrams, ['Zeta', 'Backend/Filas']);
    expect(tree.items.map((item) => item.slug)).toEqual(['web']);
    expect(tree.folders.map((folder) => folder.name)).toEqual(['Backend', 'Zeta']);
    const backend = tree.folders[0]!;
    expect(backend.items.map((item) => item.slug)).toEqual(['api']);
    expect(backend.folders.map((folder) => folder.path)).toEqual(['Backend/Dados', 'Backend/Filas']);
    expect(backend.folders[0]!.items.map((item) => item.slug)).toEqual(['db']);
  });
});

describe('knownFolders', () => {
  it('includes ancestors of item folders and declared folders, sorted and unique', () => {
    expect(knownFolders(base().diagrams, ['Backend/Filas'])).toEqual(['Backend', 'Backend/Dados', 'Backend/Filas']);
  });
});

describe('moveItem', () => {
  it('moves into a folder, back to the root, and ignores unknown slugs', () => {
    const moved = moveItem(base(), 'diagram', 'web', 'Frontend');
    expect(moved.diagrams.find((item) => item.slug === 'web')?.folder).toBe('Frontend');
    const root = moveItem(moved, 'diagram', 'web', null);
    expect(root.diagrams.find((item) => item.slug === 'web')).toEqual({ slug: 'web', title: 'Web' });
    expect(moveItem(base(), 'diagram', 'nope', 'X')).toEqual(base());
  });
  it('rejects an invalid folder name without changing anything', () => {
    expect(moveItem(base(), 'diagram', 'web', '../x')).toEqual(base());
  });
  it('moves docs too', () => {
    expect(moveItem(base(), 'doc', 'notas', 'Guias').docs[0]?.folder).toBe('Guias');
  });
});

describe('createFolder', () => {
  it('declares an empty folder per kind, once', () => {
    const once = createFolder(base(), 'doc', 'Guias');
    expect(once.folders).toEqual({ docs: ['Guias'] });
    expect(createFolder(once, 'doc', 'Guias')).toEqual(once);
    expect(createFolder(base(), 'doc', '..')).toEqual(base());
  });
});

describe('renameFolder', () => {
  it('rewrites the folder of items and nested folders under it', () => {
    const next = renameFolder(createFolder(base(), 'diagram', 'Backend/Filas'), 'diagram', 'Backend', 'Servidor');
    expect(next.diagrams.map((item) => item.folder)).toEqual(['Servidor', 'Servidor/Dados', undefined]);
    expect(next.folders).toEqual({ diagrams: ['Servidor/Filas'] });
  });
  it('refuses to move a folder into its own descendant', () => {
    expect(renameFolder(base(), 'diagram', 'Backend', 'Backend/Dentro')).toEqual(base());
  });
});

describe('deleteFolder', () => {
  it('moves its items and subfolders up to the parent instead of deleting content', () => {
    const next = deleteFolder(createFolder(base(), 'diagram', 'Backend/Filas'), 'diagram', 'Backend');
    expect(next.diagrams.map((item) => item.folder)).toEqual([undefined, 'Dados', undefined]);
    expect(next.folders).toEqual({ diagrams: ['Filas'] });
  });
  it('drops the folders key when nothing is left to declare', () => {
    expect(deleteFolder(createFolder(base(), 'doc', 'Guias'), 'doc', 'Guias').folders).toBeUndefined();
  });
});

describe('manifest round trip with folders', () => {
  it('prints and parses folder and folders', () => {
    const manifest = createFolder(base(), 'doc', 'Guias');
    expect(parseManifest(printManifest(manifest))).toEqual({ manifest, warnings: [] });
  });
  it('omits folder fields when unused, so old workspaces print the same bytes', () => {
    expect(printManifest(emptyManifest('x'))).not.toContain('folder');
  });
  it('drops invalid folder names with a pt-BR warning', () => {
    const text = JSON.stringify({ version: 1, name: 'L', diagrams: [{ slug: 'a', title: 'A', folder: '../x' }], folders: { diagrams: ['ok', '..'] } });
    const { manifest, warnings } = parseManifest(text);
    expect(manifest.diagrams).toEqual([{ slug: 'a', title: 'A' }]);
    expect(manifest.folders).toEqual({ diagrams: ['ok'] });
    expect(warnings).toEqual(['strukt.json: uma pasta inválida de diagrams foi ignorada.', 'strukt.json: uma pasta inválida de diagrams foi ignorada.']);
  });
});

describe('undoing a delete keeps the folder', () => {
  it('snapshotItem remembers it and restoreItem puts it back', async () => {
    const { snapshotItem, restoreItem } = await import('./itemSnapshot');
    const { newWorkspace, removeItem } = await import('./workspace');
    const data = newWorkspace('Loja');
    data.manifest = { ...data.manifest, docs: [{ slug: 'notas', title: 'Notas', folder: 'Guias' }] };
    data.docs = { notas: '# Notas' };
    const snap = snapshotItem(data, 'doc', 'notas')!;
    expect(snap.folder).toBe('Guias');
    const restored = restoreItem(removeItem(data, 'doc', 'notas'), snap)!;
    expect(restored.manifest.docs).toEqual([{ slug: 'notas', title: 'Notas', folder: 'Guias' }]);
  });
});
