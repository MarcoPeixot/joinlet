import { applyOps, emptyModel } from '@strukt/core';
import { printDiagramJson } from '@strukt/json';
import { CONTEXT_DIR, VERSIONS_DIR, newWorkspace, printManifest, workspaceFiles, zipFiles } from '@strukt/workspace';
import type { DiagramSnapshot, StorageAdapter } from '@strukt/workspace';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPARE_LOCK } from '../versions/versionStore';

// `boot.ts` talks to the browser only through `./idb`, `./folder` and `../export/png`; mocking
// those three lets every other module (the real `workspace` singleton, the real diagram/ui stores,
// the real DSL/zip code) run exactly as in the app, in Node.
vi.mock('./idb', () => ({ createIdbAdapter: vi.fn(), loadBackendChoice: vi.fn(), saveBackendChoice: vi.fn() }));
vi.mock('./folder', () => ({
  canPickFolder: vi.fn(),
  createFolderAdapter: vi.fn(),
  hasPermission: vi.fn(),
  pickFolder: vi.fn(),
  requestPermission: vi.fn(),
}));
vi.mock('../export/png', () => ({ downloadBlob: vi.fn() }));

/** Same shape as `createMemoryAdapter`, but with a configurable `kind` (idb/folder fallbacks care which one it is). */
function fakeAdapter(kind: StorageAdapter['kind'], label: string, files = new Map<string, string>()): StorageAdapter {
  return {
    kind,
    label,
    read: async (path) => files.get(path) ?? null,
    write: async (path, text) => void files.set(path, text),
    remove: async (path) => void files.delete(path),
    list: async () => [...files.keys()].sort(),
  };
}

/** Every test gets a fresh module graph: boot.ts keeps `adapter`/`folder` in module-level `let`s, and
 * `./appWorkspace` owns a singleton `workspace`, so reusing either across tests would leak state. */
async function freshBoot() {
  vi.resetModules();
  const idb = await import('./idb');
  const folder = await import('./folder');
  const png = await import('../export/png');
  const ui = await import('../ui/uiStore');
  const appStore = await import('../state/appStore');
  const appWorkspace = await import('./appWorkspace');
  const versions = await import('../versions/session');
  const context = await import('../context/session');
  const boot = await import('./boot');
  return { idb, folder, png, ui, appStore, appWorkspace, versions, context, boot };
}

type Fresh = Awaited<ReturnType<typeof freshBoot>>;

/** A folder that already holds a workspace (`.arch/strukt.json` and friends). */
const folderWithWorkspace = (label: string) => fakeAdapter('folder', label, new Map(Object.entries(workspaceFiles(newWorkspace('Projeto')))));

/** Boots straight into a browser (IndexedDB) workspace backed by an in-memory map. */
async function bootIntoBrowser(f: Fresh, files = new Map<string, string>()) {
  vi.mocked(f.idb.loadBackendChoice).mockResolvedValue({ kind: 'indexeddb' });
  vi.mocked(f.idb.createIdbAdapter).mockReturnValue(fakeAdapter('indexeddb', 'Navegador', files));
  await f.boot.bootWorkspace();
}

/** A browser adapter whose `write` of `path` rejects once, but only after `arm()` (boot itself writes every file). */
function failingOnceAfterArm(path: string, files = new Map<string, string>()) {
  const base = fakeAdapter('indexeddb', 'Navegador', files);
  let armed = false;
  const adapter: StorageAdapter = {
    ...base,
    write: async (p, text) => {
      if (armed && p === path) {
        armed = false;
        throw new Error('disco cheio');
      }
      return base.write(p, text);
    },
  };
  return { adapter, files, arm: () => void (armed = true) };
}

/** A one-node diagram, different from the example the boot creates. */
function oneNode(id: string): DiagramSnapshot {
  const result = applyOps(emptyModel(), [{ op: 'add_node', id }]);
  if (!result.ok) throw new Error(result.error.message);
  return { model: result.model, layout: { nodes: { [id]: { x: 0, y: 0 } }, edges: {} } };
}

const zipFile = (files: Record<string, string>) => {
  const bytes = zipFiles(files);
  return { arrayBuffer: () => Promise.resolve(bytes.buffer) } as unknown as File;
};

/** A `File`-like object wrapping raw zip bytes, for a zip built outside `zipFile` (e.g. from a downloaded blob). */
const fileFromBytes = (bytes: Uint8Array) => ({ arrayBuffer: () => Promise.resolve(bytes.buffer) }) as unknown as File;

/** Raw JSON text of a `Version` (`@strukt/workspace`), just enough shape for `boot.ts` to treat it as opaque text. */
const versionText = (id: string, dsl: string) =>
  JSON.stringify({ id, createdAt: '2026-01-01T00:00:00.000Z', message: 'v1', author: 'human', dsl, layout: {} });

beforeEach(() => {
  vi.stubGlobal('window', { confirm: vi.fn(() => true) });
});
afterEach(() => vi.useRealTimers());

describe('openBrowser (item 1): probe IndexedDB availability separately from a load failure', () => {
  it('falls back to memory storage with a toast only when the probe itself fails', async () => {
    const f = await freshBoot();
    vi.mocked(f.idb.loadBackendChoice).mockResolvedValue({ kind: 'indexeddb' });
    vi.mocked(f.idb.createIdbAdapter).mockReturnValue({ ...fakeAdapter('indexeddb', 'Navegador'), list: vi.fn().mockRejectedValue(new Error('bloqueado')) });
    await f.boot.bootWorkspace();
    expect(f.appWorkspace.workspace.store.getState().source).toEqual({ kind: 'memory', label: 'Memória (não salva)' });
    expect(f.ui.uiStore.getState().toast).toBe('O navegador bloqueou o armazenamento local: as mudanças desta sessão não serão salvas.');
  });

  it('a load failure past the probe (corrupt strukt.json) never falls back to memory, and a later retry can still succeed', async () => {
    const f = await freshBoot();
    const files = new Map([['strukt.json', '{"nope":true}']]);
    await bootIntoBrowser(f, files);
    // Old bug: this used to be silently swallowed into a memory fallback. Now it must not open anything.
    expect(f.appWorkspace.workspace.store.getState().source).toBeNull();

    // "Tentar de novo" (item 3) just calls bootWorkspace() again: once the cause is gone, it recovers.
    files.delete('strukt.json');
    await f.boot.bootWorkspace();
    expect(f.appWorkspace.workspace.store.getState().source).toEqual({ kind: 'indexeddb', label: 'Navegador' });
  });
});

describe('switchToBrowserStorage (item 2): must not reject unhandled', () => {
  it('catches a saveBackendChoice/open failure and toasts the reason instead of throwing', async () => {
    const f = await freshBoot();
    vi.mocked(f.idb.saveBackendChoice).mockRejectedValue(new Error('Falha ao gravar'));
    await expect(f.boot.switchToBrowserStorage()).resolves.toBeUndefined();
    expect(f.ui.uiStore.getState().toast).toBe('Não foi possível abrir o workspace: Falha ao gravar');
  });
});

describe('openFolder (item 7): remembering the backend is best-effort', () => {
  it('a saveBackendChoice failure after a successful folder open toasts but does not undo the open', async () => {
    const f = await freshBoot();
    vi.mocked(f.idb.loadBackendChoice).mockResolvedValue({ kind: 'folder', handle: { kind: 'directory', name: 'Projeto' } as never });
    vi.mocked(f.idb.saveBackendChoice).mockRejectedValue(new Error('quota'));
    vi.mocked(f.folder.hasPermission).mockResolvedValue(true);
    vi.mocked(f.folder.createFolderAdapter).mockReturnValue(folderWithWorkspace('Projeto/.arch'));

    await f.boot.bootWorkspace();
    expect(f.appWorkspace.workspace.store.getState().source).toEqual({ kind: 'folder', label: 'Projeto/.arch' });
    expect(f.ui.uiStore.getState().toast).toBe('Não foi possível lembrar a escolha de armazenamento.');
  });
});

describe('retrySave / exportZip (item 9): never reject unhandled', () => {
  it('retrySave toasts the reason when the folder permission check fails', async () => {
    const f = await freshBoot();
    vi.mocked(f.idb.loadBackendChoice).mockResolvedValue({ kind: 'folder', handle: { kind: 'directory', name: 'Projeto' } as never });
    vi.mocked(f.idb.saveBackendChoice).mockResolvedValue(undefined);
    vi.mocked(f.folder.hasPermission).mockResolvedValueOnce(true); // during boot
    vi.mocked(f.folder.createFolderAdapter).mockReturnValue(folderWithWorkspace('Projeto/.arch'));
    await f.boot.bootWorkspace();

    vi.mocked(f.folder.hasPermission).mockRejectedValueOnce(new Error('permissão negada'));
    await expect(f.boot.retrySave()).resolves.toBeUndefined();
    expect(f.ui.uiStore.getState().toast).toBe('permissão negada');
  });

  it('exportZip toasts the reason when the download itself fails', async () => {
    const f = await freshBoot();
    await bootIntoBrowser(f);
    vi.mocked(f.png.downloadBlob).mockImplementation(() => {
      throw new Error('Falha ao baixar.');
    });
    await expect(f.boot.exportZip()).resolves.toBeUndefined();
    expect(f.ui.uiStore.getState().toast).toBe('Falha ao baixar.');
  });
});

describe('importZip (items 4 & 5): validate before touching the live workspace', () => {
  it('a zip without strukt.json toasts and leaves the workspace untouched', async () => {
    const f = await freshBoot();
    await bootIntoBrowser(f);
    const before = f.appWorkspace.workspace.store.getState().data;

    await f.boot.importZip(zipFile({ 'nota.txt': 'oi' }));

    expect(f.appWorkspace.workspace.store.getState().data).toBe(before);
    expect(f.ui.uiStore.getState().toast).toBe('O .zip não contém um workspace do Joinlet (strukt.json).');
  });

  it('refuses while the AI draft locks the diagram store, without touching the workspace', async () => {
    const f = await freshBoot();
    await bootIntoBrowser(f);
    const before = f.appWorkspace.workspace.store.getState().data;
    f.appStore.diagramStore.getState().setReadOnly('Revise a proposta da IA.');

    const incoming = newWorkspace('Outro workspace');
    await f.boot.importZip(zipFile(workspaceFiles(incoming)));

    expect(f.appWorkspace.workspace.store.getState().data).toBe(before);
    expect(f.ui.uiStore.getState().toast).toBe('Aplique ou descarte a proposta da IA antes de importar.');
  });

  it('does nothing when the user cancels the confirmation', async () => {
    const f = await freshBoot();
    await bootIntoBrowser(f);
    const before = f.appWorkspace.workspace.store.getState().data;
    vi.stubGlobal('window', { confirm: vi.fn(() => false) });

    const incoming = newWorkspace('Outro workspace');
    await f.boot.importZip(zipFile(workspaceFiles(incoming)));

    expect(f.appWorkspace.workspace.store.getState().data).toBe(before);
  });

  it('a failed import writes the live workspace back over the files it left in the storage', async () => {
    const f = await freshBoot();
    const storage = failingOnceAfterArm('strukt.json');
    vi.mocked(f.idb.loadBackendChoice).mockResolvedValue({ kind: 'indexeddb' });
    vi.mocked(f.idb.createIdbAdapter).mockReturnValue(storage.adapter);
    await f.boot.bootWorkspace();
    const before = f.appWorkspace.workspace.store.getState().data!;
    storage.arm();

    const incoming = newWorkspace('Outro workspace', { title: 'Exemplo', snapshot: oneNode('Zipado') });
    await f.boot.importZip(zipFile(workspaceFiles(incoming)));

    expect(f.ui.uiStore.getState().toast).toContain('disco cheio');
    expect(f.appWorkspace.workspace.store.getState().data).toBe(before);
    await f.appWorkspace.workspace.flush();
    expect(storage.files.get('diagrams/exemplo.strukt.json')).toBe(printDiagramJson(before.diagrams.exemplo!.model));
    expect(storage.files.get('strukt.json')).toBe(printManifest(before.manifest));
  });

  it('writes only the files the imported workspace owns (and .strukt.json backups), keeping their raw text', async () => {
    const f = await freshBoot();
    const files = new Map<string, string>();
    await bootIntoBrowser(f, files);
    const raw = '{\n  "version": 1,\n  "nodes": [{"id": "Zipado"}]\n}\n';
    const incoming = workspaceFiles(newWorkspace('Outro workspace', { title: 'Exemplo', snapshot: oneNode('Zipado') }));

    await f.boot.importZip(
      zipFile({ ...incoming, 'diagrams/exemplo.strukt.json': raw, 'diagrams/exemplo.strukt.json.bak': 'velho', 'notes.txt': 'lixo', '__MACOSX/._strukt.json': 'lixo' }),
    );

    expect(f.appWorkspace.workspace.store.getState().data?.manifest.name).toBe('Outro workspace');
    expect(files.has('notes.txt')).toBe(false);
    expect(files.has('__MACOSX/._strukt.json')).toBe(false);
    expect(files.get('diagrams/exemplo.strukt.json')).toBe(raw);
    expect(files.get('diagrams/exemplo.strukt.json.bak')).toBe('velho');
  });

  it('replaces the workspace on confirm, relying on open() to swap only once the new data has loaded', async () => {
    const f = await freshBoot();
    await bootIntoBrowser(f);

    const incoming = newWorkspace('Outro workspace');
    await f.boot.importZip(zipFile(workspaceFiles(incoming)));

    expect(f.appWorkspace.workspace.store.getState().data?.manifest.name).toBe('Outro workspace');
  });

  it('(fix round 1, item 2) a version comparison lock is not the AI lock: importZip stops it instead of refusing', async () => {
    const f = await freshBoot();
    await bootIntoBrowser(f);
    await f.versions.versionStore.getState().refresh();
    await f.versions.versionStore.getState().save('x');
    await f.versions.versionStore.getState().startCompare(f.versions.versionStore.getState().entries[0]!);
    expect(f.appStore.diagramStore.getState().readOnly).toBe(COMPARE_LOCK);

    const incoming = newWorkspace('Outro workspace');
    await f.boot.importZip(zipFile(workspaceFiles(incoming)));

    expect(f.appWorkspace.workspace.store.getState().data?.manifest.name).toBe('Outro workspace');
    expect(f.appStore.diagramStore.getState().readOnly).toBeNull();
  });

  it('(fix round 1, item 1) exportZip → importZip into a freshly booted workspace round-trips versions/ and context/ byte-for-byte', async () => {
    const source = await freshBoot();
    const versionPath = `${VERSIONS_DIR}/visao-geral/20260101T000000000Z-v1.json`;
    const architecturePath = `${CONTEXT_DIR}/ARCHITECTURE.md`;
    const llmsPath = `${CONTEXT_DIR}/llms.txt`;
    const diagramPath = `${CONTEXT_DIR}/diagrams/visao-geral.md`;
    const seeded = new Map(Object.entries(workspaceFiles(newWorkspace('Loja', { title: 'Visão geral', snapshot: oneNode('Fila') }))));
    seeded.set(versionPath, versionText('v1', 'Fila\n'));
    // Just enough to turn contextSync on (Task 5): it regenerates the real, deterministic content for
    // ARCHITECTURE.md/llms.txt/diagrams/*.md from the live data on the very next flush, which exportZip
    // below triggers itself — so this placeholder is gone before the zip is even built.
    seeded.set(architecturePath, 'placeholder');
    await bootIntoBrowser(source, seeded);

    await source.boot.exportZip();
    // exportZip's own `workspace.flush()` let contextSync overwrite the placeholder above with the real,
    // deterministic generated content: capture it here as the round-trip's expectation.
    const architecture = seeded.get(architecturePath);
    const llms = seeded.get(llmsPath);
    const diagram = seeded.get(diagramPath);
    expect(architecture).toContain('Fila');
    expect(llms).toBeDefined();
    expect(diagram).toBeDefined();

    const blob = vi.mocked(source.png.downloadBlob).mock.calls[0]![0] as Blob;
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const target = await freshBoot();
    const targetFiles = new Map<string, string>();
    await bootIntoBrowser(target, targetFiles);

    await target.boot.importZip(fileFromBytes(bytes));

    expect(target.appWorkspace.workspace.store.getState().data?.manifest.name).toBe('Loja');
    expect(targetFiles.get(versionPath)).toBe(seeded.get(versionPath));
    expect(targetFiles.get(architecturePath)).toBe(architecture);
    expect(targetFiles.get(llmsPath)).toBe(llms);
    expect(targetFiles.get(diagramPath)).toBe(diagram);

    // Task 5's re-sync must pick up the imported context/ARCHITECTURE.md through its existing
    // workspace.store subscription (a fresh `source` object on every open()), no extra wiring here.
    await target.context.contextSync.ready();
    expect(target.context.contextSync.enabled()).toBe(true);
  });

  it('(fix round 1, item 2b) still imports only owned files plus versions/ and context/, dropping a stray top-level file and an unsafe path', async () => {
    const f = await freshBoot();
    const files = new Map<string, string>();
    await bootIntoBrowser(f, files);
    const versionPath = `${VERSIONS_DIR}/exemplo/20260101T000000000Z-v1.json`;
    const architecturePath = `${CONTEXT_DIR}/ARCHITECTURE.md`;
    const incoming = workspaceFiles(newWorkspace('Outro workspace', { title: 'Exemplo', snapshot: oneNode('Zipado') }));

    await f.boot.importZip(
      zipFile({
        ...incoming,
        [versionPath]: versionText('v1', 'Zipado\n'),
        [architecturePath]: '# Arquitetura\n',
        'notes.txt': 'lixo',
        '../evil': 'boom',
      }),
    );

    expect(f.appWorkspace.workspace.store.getState().data?.manifest.name).toBe('Outro workspace');
    expect(files.has('notes.txt')).toBe(false);
    expect(files.has('../evil')).toBe(false);
    expect(files.has('evil')).toBe(false);
    expect(files.get(versionPath)).toBe(versionText('v1', 'Zipado\n'));
    expect(files.get(architecturePath)).toBe('# Arquitetura\n');
  });
});

describe('openFolderPicker (fix wave 4): never drops the current workspace\'s unsaved writes silently', () => {
  const UNSAVED = 'Não foi possível salvar o workspace atual. Tente salvar novamente antes de trocar de projeto.';

  /** Browser workspace whose doc edit can't be saved (the saver ends in 'error'), and a picked folder that already has another workspace. */
  async function unsavedThenPick(f: Fresh) {
    const files = new Map<string, string>();
    const base = fakeAdapter('indexeddb', 'Navegador', files);
    let broken = false;
    vi.mocked(f.idb.loadBackendChoice).mockResolvedValue({ kind: 'indexeddb' });
    vi.mocked(f.idb.createIdbAdapter).mockReturnValue({
      ...base,
      write: (path, text) => (broken ? Promise.reject(new Error('disco cheio')) : base.write(path, text)),
    });
    await f.boot.bootWorkspace();
    const ws = f.appWorkspace.workspace;
    const doc = await ws.create('doc', 'Notas');
    await ws.flush();
    broken = true;
    vi.useFakeTimers();
    ws.setDoc(doc, '# Notas\n\nNão salvo.\n');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ws.store.getState().save).toBe('error');
    vi.useRealTimers();

    const repo = workspaceFiles(newWorkspace('Repo', { title: 'Serviços', snapshot: oneNode('Gateway') }));
    vi.mocked(f.folder.canPickFolder).mockReturnValue(true);
    vi.mocked(f.folder.pickFolder).mockResolvedValue({ name: 'repo' } as never);
    vi.mocked(f.folder.createFolderAdapter).mockReturnValue(fakeAdapter('folder', 'repo/.arch', new Map(Object.entries(repo))));
    return ws;
  }

  it('keeps the current workspace when its changes cannot be saved', async () => {
    const f = await freshBoot();
    const ws = await unsavedThenPick(f);
    const before = ws.store.getState().data;
    vi.stubGlobal('window', { confirm: vi.fn(() => false) });

    await f.boot.openFolderPicker();

    expect(window.confirm).not.toHaveBeenCalled();
    expect(f.ui.uiStore.getState().toast).toContain(UNSAVED);
    expect(ws.store.getState().data).toBe(before);
    expect(ws.store.getState().source).toEqual({ kind: 'indexeddb', label: 'Navegador' });
  });

  it('never offers to discard unsaved changes when opening another project', async () => {
    const f = await freshBoot();
    const ws = await unsavedThenPick(f);

    await f.boot.openFolderPicker();

    expect(window.confirm).not.toHaveBeenCalled();
    expect(f.ui.uiStore.getState().toast).toContain(UNSAVED);
    expect(ws.store.getState().source).toEqual({ kind: 'indexeddb', label: 'Navegador' });
    expect(ws.hasUnsaved()).toBe(true);
  });
});

describe('a remembered folder without strukt.json (fix wave 7): never plants a workspace in it', () => {
  it('boot lands on the failed screen and writes nothing', async () => {
    const f = await freshBoot();
    const files = new Map<string, string>();
    vi.mocked(f.idb.loadBackendChoice).mockResolvedValue({ kind: 'folder', handle: { kind: 'directory', name: 'repo' } as never });
    vi.mocked(f.folder.hasPermission).mockResolvedValue(true);
    vi.mocked(f.folder.createFolderAdapter).mockReturnValue(fakeAdapter('folder', 'repo/.arch', files));

    await f.boot.bootWorkspace();

    const phase = f.boot.getBootPhase();
    expect(phase.kind).toBe('failed');
    expect(phase.kind === 'failed' && phase.message).toContain('não tem mais um workspace');
    expect([...files.keys()]).toEqual([]);
  });

  it('"Reabrir pasta" toasts the reason and writes nothing', async () => {
    const f = await freshBoot();
    const files = new Map<string, string>();
    vi.mocked(f.idb.loadBackendChoice).mockResolvedValue({ kind: 'folder', handle: { kind: 'directory', name: 'repo' } as never });
    vi.mocked(f.folder.hasPermission).mockResolvedValue(false);
    vi.mocked(f.folder.requestPermission).mockResolvedValue(true);
    vi.mocked(f.folder.createFolderAdapter).mockReturnValue(fakeAdapter('folder', 'repo/.arch', files));
    await f.boot.bootWorkspace();
    expect(f.boot.getBootPhase()).toEqual({ kind: 'needs-permission', folder: 'repo' });

    await f.boot.reopenFolder();

    expect(f.ui.uiStore.getState().toast).toBe('Não foi possível abrir a pasta: A pasta “repo” não tem mais um workspace do Joinlet (.arch/strukt.json).');
    expect([...files.keys()]).toEqual([]);
  });
});

describe('guardUnsavedChanges: changes save themselves, leaving never asks', () => {
  it('registers no "leave site?" prompt and writes what is queued when the page is hidden or closed', async () => {
    const f = await freshBoot();
    const listeners: Record<string, (() => void)[]> = {};
    const target = { addEventListener: (type: string, fn: () => void) => { (listeners[type] ??= []).push(fn); } };
    const before = { window: globalThis.window, document: globalThis.document };
    vi.stubGlobal('window', target);
    vi.stubGlobal('document', { ...target, visibilityState: 'hidden' });
    const flush = vi.spyOn(f.appWorkspace.workspace, 'flush').mockResolvedValue();
    f.boot.guardUnsavedChanges();
    expect(listeners.beforeunload).toBeUndefined();
    listeners.pagehide!.forEach((fn) => fn());
    listeners.visibilitychange!.forEach((fn) => fn());
    expect(flush).toHaveBeenCalledTimes(2);
    vi.stubGlobal('window', before.window);
    vi.stubGlobal('document', before.document);
  });
});

describe('openFolderPicker copy branch (fix wave 10): copies the workspace as it is at copy time', () => {
  it('includes an edit made while the folder was being checked', async () => {
    const f = await freshBoot();
    await bootIntoBrowser(f);
    const ws = f.appWorkspace.workspace;
    const doc = await ws.create('doc', 'Notas');
    await ws.flush();
    const files = new Map<string, string>();
    const folder = fakeAdapter('folder', 'repo/.arch', files);
    vi.mocked(f.folder.canPickFolder).mockReturnValue(true);
    vi.mocked(f.folder.pickFolder).mockResolvedValue({ name: 'repo' } as never);
    vi.mocked(f.folder.createFolderAdapter).mockReturnValue({
      ...folder,
      read: async (path) => {
        if (path !== 'strukt.json') return folder.read(path);
        ws.setDoc(doc, '# Editado\n');
        return null;
      },
    });

    await f.boot.openFolderPicker();

    expect(ws.store.getState().source).toEqual({ kind: 'folder', label: 'repo/.arch' });
    expect(files.get(`docs/${doc}.md`)).toBe('# Editado\n');
  });

  it('(fix round 1, item 3) also copies versions/ and context/ from the current storage into the empty folder', async () => {
    const f = await freshBoot();
    const files = new Map<string, string>();
    await bootIntoBrowser(f, files);
    const versionPath = `${VERSIONS_DIR}/exemplo/20260101T000000000Z-v1.json`;
    const architecturePath = `${CONTEXT_DIR}/ARCHITECTURE.md`;
    files.set(versionPath, versionText('v1', 'Nó\n'));
    files.set(architecturePath, '# Arquitetura\n');

    const folderFiles = new Map<string, string>();
    vi.mocked(f.folder.canPickFolder).mockReturnValue(true);
    vi.mocked(f.folder.pickFolder).mockResolvedValue({ name: 'repo' } as never);
    vi.mocked(f.folder.createFolderAdapter).mockReturnValue(fakeAdapter('folder', 'repo/.arch', folderFiles));

    await f.boot.openFolderPicker();

    expect(folderFiles.get(versionPath)).toBe(versionText('v1', 'Nó\n'));
    expect(folderFiles.get(architecturePath)).toContain('# Arquitetura — Meu workspace');
    expect(folderFiles.get(architecturePath)).toContain('Kafka');
  });
});

describe('openFolderPicker success toast (follow-up): never hides the load warnings', () => {
  async function pickRepo(f: Fresh, files: Record<string, string>) {
    await bootIntoBrowser(f);
    vi.mocked(f.folder.canPickFolder).mockReturnValue(true);
    vi.mocked(f.folder.pickFolder).mockResolvedValue({ name: 'repo' } as never);
    vi.mocked(f.folder.createFolderAdapter).mockReturnValue(fakeAdapter('folder', 'repo/.arch', new Map(Object.entries(files))));
    await f.boot.openFolderPicker();
  }

  it('merges the success message with the first warning and the count of the others', async () => {
    const f = await freshBoot();
    const manifest = { version: 1, name: 'Repo', diagrams: [{ slug: 'a', title: 'A' }, { slug: 'b', title: 'B' }], docs: [], sketches: [] };
    const warning = '{"version": 1, "nodes": [{"id": "A"}], "connections": [{"from": "A", "to": "B"}]}';
    await pickRepo(f, { 'strukt.json': printManifest(manifest), 'diagrams/a.strukt.json': warning, 'diagrams/b.strukt.json': '{"version": 1, "nodes": [{"id": "B"}], "connections": [{"from": "B", "to": "C"}]}' });

    expect(f.appWorkspace.workspace.store.getState().source).toEqual({ kind: 'folder', label: 'repo/.arch' });
    const toast = f.ui.uiStore.getState().toast ?? '';
    expect(toast.startsWith('Workspace aberto em repo/.arch. diagrams/a.strukt.json: o Joinlet ignorou 1 trecho(s)')).toBe(true);
    expect(toast.endsWith('eles saem do arquivo na próxima mudança do diagrama. (+1 avisos)')).toBe(true);
  });

  it('shows just the success message when there is nothing to warn about', async () => {
    const f = await freshBoot();
    await pickRepo(f, workspaceFiles(newWorkspace('Repo', { title: 'Serviços', snapshot: oneNode('Gateway') })));
    expect(f.ui.uiStore.getState().toast).toBe('Workspace aberto em repo/.arch.');
  });
});
