import { SELF_HOSTED_PLAN } from '@strukt/workspace';
import { trackAnalytics } from '../analytics/client';
import { identifyNavigation, navigationPersistence } from './navigation';
import { acceptAccessPlan, loadAccessPlan } from '../settings/accessPlan';
import { isBrowserPreview } from '../settings/publicAccess';
import { assertBetaGrowth } from '@strukt/workspace';
import { systemMessage, uiText } from '../i18n';
import {
  CONTEXT_DIR, DEFAULT_WORKSPACE_NAME, VERSIONS_DIR, parseCommentsPath, createMemoryAdapter, loadWorkspace, newWorkspace, readFiles, replaceFiles, slugify,
  workspaceFiles, writeFiles,
} from '@strukt/workspace';
import type { StorageAdapter, WorkspaceData } from '@strukt/workspace';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { downloadBlob } from '../export/png';
import { flushCodeEdits } from '../code/registry';
import { exampleSnapshot } from '../samples/example';
import { diagramStore } from '../state/appStore';
import { clearSnapshot, loadSnapshot } from '../state/persist';
import { enforceViewOnly } from '../state/viewOnly';
import { requestFit, showToast } from '../ui/uiStore';
import { versionStore } from '../versions/session';
import { setAccessEndedHandler } from './accessEnded';
import { workspace } from './appWorkspace';
import { canPickFolder, createFolderAdapter, hasPermission, pickFolder, requestPermission } from './folder';
import type { DirHandleLike } from './folder';
import { createIdbAdapter, loadBackendChoice, saveBackendChoice } from './idb';
import { createRepositoryAdapter } from './repository';
import { createManifestSync, setManifestSync } from './manifestSync';
import { createRemoteAdapter, initializeRemote, remoteSession } from './remote';
import type { RemoteSession } from './remote';
import { catalogStore, LEGACY_WORKSPACE, loadCatalog, rememberWorkspace, updateCatalog } from './catalog';
import type { WorkspaceLocation } from './catalog';

export type BootPhase =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'needs-permission'; folder: string }
  | { kind: 'needs-remote-auth'; mcpUrl: string }
  | { kind: 'failed'; message: string; remote?: boolean };

const bootStore = createStore<{ phase: BootPhase }>()(() => ({ phase: { kind: 'loading' } }));

export function useBootPhase(): BootPhase {
  return useStore(bootStore, (s) => s.phase);
}

export function getBootPhase(): BootPhase {
  return bootStore.getState().phase;
}

let adapter: StorageAdapter | null = null;
let sharedSession: RemoteSession | null = null;
export const collaborationSession = () => sharedSession;
/** The session came from a read-only link: nothing here can be edited (the host would refuse it anyway). */
export const isViewOnly = () => sharedSession?.readOnly === true;
/** Folder of the open workspace (or the one waiting for "Reabrir pasta"). */
let folder: DirHandleLike | null = null;

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Versions and the generated context sit next to the workspace files: zips and folder copies carry them too. */
function extraFiles(from: StorageAdapter): Promise<Record<string, string>> {
  return readFiles(from, (path) => path.startsWith(`${VERSIONS_DIR}/`) || path.startsWith(`${CONTEXT_DIR}/`) || parseCommentsPath(path) !== null);
}

/** Opens `next` and returns its load warnings; the caller shows them with `announce`. */
export async function openWith(next: StorageAdapter, init: () => WorkspaceData, nextFolder: DirHandleLike | null = null): Promise<string[]> {
  const warnings = await workspace.open(next, init, { requireSaved: true });
  if (adapter && adapter !== next && sharedSession) (await import('./collaboration')).closeCollaborationClients();
  if (adapter !== next) setManifestSync(null);
  if (!next.label.startsWith('GitHub:') && !next.label.startsWith(uiText("Rede local:")) && next.label !== 'Joinlet Cloud') sharedSession = null;
  adapter = next;
  folder = nextFolder;
  bootStore.setState({ phase: { kind: 'ready' } });
  return warnings;
}

export async function rememberOpened(location: WorkspaceLocation, id?: string): Promise<void> {
  const name = workspace.store.getState().data?.manifest.name;
  if (!name) return;
  try {
    await rememberWorkspace(location, name, id);
    const logo = workspace.store.getState().data?.manifest.logo;
    const activeId = catalogStore.getState().activeId;
    if (location.kind === 'folder' && activeId && workspace.storage()) { identifyNavigation(workspace.storage()!, `folder:${activeId}`); navigationPersistence.write(workspace.storage()!, workspace.store.getState()); }
    if (activeId) await updateCatalog(catalog => catalog ? { ...catalog, entries: catalog.entries.map(entry => entry.id === activeId ? { ...entry, logo } : entry) } : { version: 1, activeId: null, entries: [] });
  }
  catch { catalogStore.setState({ activeId: id ?? null, available: false, error: uiText("Não foi possível atualizar a lista de projetos. O workspace aberto foi preservado.") }); }
}

async function resetProjectContext(root = ''): Promise<void> {
  return (await import('./projects')).resetProjectContext(root);
}

async function changeProject<T>(change: () => Promise<T>): Promise<T> {
  return (await import('./projects')).changeProject(change);
}

async function leaveRepository(root: string | undefined): Promise<void> {
  return (await import('./projects')).leaveRepository(root);
}

export async function createBrowserWorkspace(name: string): Promise<void> {
  return (await import('./projects')).createBrowserWorkspace(name);
}

export async function openRegisteredWorkspace(id: string): Promise<void> {
  await (await import('./projects')).openRegisteredWorkspace(id);
  trackAnalytics('workspace_reopened');
}

/** One toast for everything said after opening a workspace, so a later message never hides a load warning. */
function announce(messages: string[], warnings: string[]): void {
  const text = [...messages, ...warnings.slice(0, 1)].join(' ');
  if (text) showToast(warnings.length > 1 ? uiText("{0} (+{1} avisos)", [text, warnings.length - 1]) : text);
}

/** First run: the M1–M3 scratch diagram (if any) becomes the first diagram; otherwise the example. */
export function firstWorkspace(): { data: WorkspaceData; migrated: boolean } {
  const scratch = loadSnapshot();
  return scratch
    ? { data: newWorkspace(uiText(DEFAULT_WORKSPACE_NAME), { title: uiText("Sem título"), snapshot: scratch }), migrated: true }
    : { data: newWorkspace(uiText(DEFAULT_WORKSPACE_NAME), { title: uiText("Exemplo"), snapshot: exampleSnapshot() }), migrated: false };
}

async function openBrowser(): Promise<void> {
  let migrated = false;
  const init = () => {
    const first = firstWorkspace();
    migrated = first.migrated;
    return first.data;
  };
  folder = null;
  const idb = createIdbAdapter();
  // Only "IndexedDB itself is unavailable" (private browsing, quota) falls back to memory: a real
  // load/parse failure (corrupt strukt.json) must surface as 'failed' with its real cause, not this.
  try {
    await idb.list();
  } catch {
    const warnings = await openWith(createMemoryAdapter({}, uiText("Memória (não salva)")), init);
    announce([uiText("O navegador bloqueou o armazenamento local: as mudanças desta sessão não serão salvas.")], warnings);
    return;
  }
  announce(isBrowserPreview() ? [uiText("Este workspace fica salvo apenas neste navegador. Exporte um ZIP para manter uma cópia.")] : [], await openWith(idb, init));
  await rememberOpened({ kind: 'browser', namespace: null }, LEGACY_WORKSPACE);
  if (migrated) clearSnapshot();
}

/**
 * `init` for a remembered folder: one that lost `.arch/strukt.json` (e.g. a git branch without it) is
 * reported, never silently given the example or the scratch diagram (that would plant files in the repo).
 */
const workspaceGone = (handle: DirHandleLike) => (): WorkspaceData => {
  throw new Error(uiText("A pasta “{0}” não tem mais um workspace do Joinlet (.arch/strukt.json).", [handle.name]));
};

/** `done`: what to say once the folder is open (merged with any load warning). */
async function openFolder(handle: DirHandleLike, init: () => WorkspaceData, done?: string, projectId?: string): Promise<void> {
  const warnings = await openWith(createFolderAdapter(handle, projectId), init);
  folder = handle;
  const messages = done ? [done] : [];
  // The workspace is already open and 'ready': remembering it for next time is best-effort, never
  // a reason to flip a working app back to 'failed'.
  try {
    await saveBackendChoice({ kind: 'folder', handle });
  } catch {
    messages.push(uiText("Não foi possível lembrar a escolha de armazenamento."));
  }
  announce(messages, warnings);
  await rememberOpened({ kind: 'folder', handle }, projectId);
}

/** Picks the storage remembered from the last session (spec §9: folder via File System Access, else IndexedDB). */
export async function bootWorkspace(): Promise<void> {
  const preview = isBrowserPreview();
  const hosted = globalThis.document?.querySelector('meta[name="strukt-mode"]')?.getAttribute('content') === 'remote';
  try {
    const remote = preview ? null : await remoteSession();
    if (remote?.kind === 'login') {
      bootStore.setState({ phase: { kind: 'needs-remote-auth', mcpUrl: remote.mcpUrl } });
      return;
    }
    if (remote?.kind === 'ended') {
      bootStore.setState({ phase: { kind: 'failed', message: remote.message, remote: true } });
      return;
    }
    if (remote?.kind === 'ready') {
      await loadAccessPlan('/api/remote/plan');
      // The shared diagram stays locked until the bridge mounts: fetch its chunk while the workspace loads.
      void import('../app/CollaborationBridge').catch(() => {});
      const conflicts = await initializeRemote(remote.session);
      folder = null;
      sharedSession = remote.session;
      // The invite may be revoked or expire while this tab is open: the workspace turns read-only and says why.
      setAccessEndedHandler((message) => {
        enforceViewOnly(diagramStore);
        showToast(message);
      });
      if (remote.session.readOnly) enforceViewOnly(diagramStore);
      const remoteAdapter = createRemoteAdapter(remote.session);
      const warnings = await openWith(remoteAdapter, () => {
        throw new Error(uiText("O workspace remoto não existe no GitHub."));
      });
      // The list of items is one file every guest writes: keep this sidebar in step with the others'.
      setManifestSync(createManifestSync(remoteAdapter, { apply: (update) => workspace.applyRemoteManifest(update), say: showToast }));
      announce([remote.session.mode === 'cloud' ? uiText('Workspace salvo no Joinlet Cloud.') : remote.session.mode === 'lan' ? uiText("Workspace compartilhado na rede local.") : uiText("Workspace conectado ao GitHub: {0}.", [remote.session.repo]), ...(conflicts.length ? [uiText("Confira a configuração MCP existente: {0}.", [conflicts.join(', ')])] : [])], warnings);
      return;
    }
    if (hosted) {
      throw new Error(uiText("O servidor remoto do Joinlet está indisponível. Tente novamente em instantes."));
    }
    if (preview) acceptAccessPlan({ plan: { id: 'free-beta' }, accountPlan: { id: 'free-beta' } });
    else await loadAccessPlan('/api/plan', false, SELF_HOSTED_PLAN);
    let catalog = null;
    try { catalog = await loadCatalog(); }
    catch (error) {
      catalogStore.setState({ available: false });
      if (reason(error).includes(uiText("lista de projetos está inválida"))) throw error;
    }
    if (catalog?.activeId) {
      const active = catalog.entries.find((entry) => entry.id === catalog.activeId);
      if (active?.location.kind === 'folder' && !(await hasPermission(active.location.handle))) {
        folder = active.location.handle;
        bootStore.setState({ phase: { kind: 'needs-permission', folder: folder.name } });
        return;
      }
      await openRegisteredWorkspace(catalog.activeId);
      await resumeOwnedCollaboration();
      return;
    }
    const choice = await loadBackendChoice();
    if (choice.kind === 'folder') {
      if (await hasPermission(choice.handle)) return await openFolder(choice.handle, workspaceGone(choice.handle));
      folder = choice.handle;
      bootStore.setState({ phase: { kind: 'needs-permission', folder: choice.handle.name } });
      return;
    }
    await openBrowser();
    const remembered = globalThis.localStorage?.getItem('strukt:repo');
    if (remembered) {
      try { await connectRepository(remembered, { allowInitialize: false }); }
      catch {
        // Keep the unavailable legacy destination discoverable without targeting it from GitHub.
        try {
          await updateCatalog((current) => {
            if (current?.entries.some((entry) => entry.location.kind === 'repository' && entry.location.root === remembered)) return current;
            return { version: 1, activeId: current?.activeId ?? null, entries: [...(current?.entries ?? []), {
              id: crypto.randomUUID(), name: remembered.split(/[\\/]/).filter(Boolean).at(-1) ?? uiText("Repositório"),
              location: { kind: 'repository', root: remembered }, createdAt: Date.now(), lastOpenedAt: 0,
            }] };
          });
        } catch { /* The original storage choice stays recoverable in localStorage. */ }
        await resetProjectContext();
        try { globalThis.localStorage?.setItem('strukt:repo', remembered); } catch { /* Catalog registration already attempted. */ }
      }
    }
  } catch (err) {
    bootStore.setState({ phase: { kind: 'failed', message: uiText("Não foi possível abrir o workspace: {0}", [reason(err)]), remote: hosted } });
  }
}

/** Makes the connected repository's .arch/ the editor's live workspace. */
export function connectRepository(dir: string, options: { allowInitialize?: boolean } = {}): Promise<{ changed: string[]; conflicts: string[]; initialized: boolean }> {
  return changeProject(() => connectRepositoryNow(dir, options));
}

export async function connectRepositoryNow(dir: string, options: { allowInitialize?: boolean; projectId?: string; quiet?: boolean } = {}): Promise<{ changed: string[]; conflicts: string[]; initialized: boolean }> {
  const catalog = catalogStore.getState().catalog;
  const previous = catalog?.entries.find((entry) => entry.id === catalogStore.getState().activeId)?.location;
  const connect = async (files?: Record<string, string>) => {
    const response = await fetch('/api/git/connect', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir, ...(files ? { files } : {}) }),
    }).catch(() => { throw new Error(uiText("Servidor local indisponível. Inicie o app com bun run dev.")); });
    const result = await response.json() as { repo?: { root: string }; changed?: string[]; conflicts?: string[]; initialized?: boolean; needsInit?: boolean; root?: string; error?: string };
    return { response, result };
  };
  let { response, result } = await connect();
  if (response.status === 409 && result.needsInit) {
    if (options.allowInitialize === false) throw new Error(uiText("O repositório ainda não tem .arch/strukt.json."));
    if (!window.confirm(uiText("O repositório “{0}” ainda não tem um workspace do Joinlet. Copiar o workspace atual para .arch/?", [result.root ?? dir]))) {
      throw new Error(uiText("Conexão cancelada. Nenhum arquivo foi criado."));
    }
    await flushCodeEdits();
    await workspace.flush();
    if (!workspace.store.getState().data) throw new Error(uiText("Nenhum workspace aberto para copiar."));
    const storage = workspace.storage();
    const files = { ...(storage ? await extraFiles(storage) : {}), ...workspace.files() };
    ({ response, result } = await connect(files));
  }
  if (!response.ok || !result.repo) throw new Error(result.error ?? uiText("Não foi possível conectar o repositório."));
  const root = result.repo.root;
  const existing = catalog?.entries.find(entry => entry.location.kind === 'repository' && entry.location.root === root);
  const projectId = options.projectId ?? existing?.id ?? (result.initialized ? catalogStore.getState().activeId ?? undefined : undefined);
  try {
    if (!projectId) assertBetaGrowth('workspaces', catalog?.entries.length ?? 0, (catalog?.entries.length ?? 0) + 1);
  } catch (error) {
    if (previous?.kind === 'repository') await fetch('/api/git/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: previous.root }) });
    else await leaveRepository(root);
    throw error;
  }
  if (workspace.storage()?.label !== `${root}/.arch`) {
    let warnings: string[];
    try { warnings = await openWith(createRepositoryAdapter(root), () => { throw new Error(uiText("O repositório não tem um workspace do Joinlet.")); }); }
    catch (error) {
      if (previous?.kind === 'repository') await fetch('/api/git/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: previous.root }) }).catch(() => {});
      else await leaveRepository(root);
      throw error;
    }
    requestFit();
    announce(options.quiet ? [] : [uiText("Workspace conectado a {0}/.arch.", [root])], warnings);
  }
  folder = null;
  await rememberOpened({ kind: 'repository', root }, projectId);
  await resetProjectContext(root);
  return { changed: result.changed ?? [], conflicts: result.conflicts ?? [], initialized: result.initialized === true };
}

/** Join the owner's room through the same-origin local relay, retaining all local app services. */
export async function joinOwnedCollaboration(root: string): Promise<void> {
  if (sharedSession?.owner) return;
  await workspace.prepareSwitch();
  const response = await fetch('/api/share/live/remote/session');
  if (!response.ok) throw new Error(uiText("Não foi possível entrar na colaboração."));
  const session = await response.json() as RemoteSession;
  if (!session.repo || !session.csrf) throw new Error(uiText("Resposta inválida do servidor."));
  session.owner = true;
  session.apiBase = '/api/share/live';
  const next = createRemoteAdapter(session);
  try {
    await openWith(next, () => { throw new Error(uiText("Workspace compartilhado indisponível.")); });
    sharedSession = session;
    bootStore.setState({ phase: { kind: 'ready' } });
    setManifestSync(createManifestSync(next, { apply: update => workspace.applyRemoteManifest(update), say: showToast }));
    sessionStorage.setItem('joinlet:owned-share', root);
  } catch (error) { sharedSession = null; throw error; }
}

export async function leaveOwnedCollaboration(root: string): Promise<void> {
  if (!sharedSession?.owner) return;
  (await import('./collaboration')).closeCollaborationClients();
  sharedSession = null;
  setManifestSync(null);
  sessionStorage.removeItem('joinlet:owned-share');
  await openWith(createRepositoryAdapter(root), () => { throw new Error(uiText("Workspace compartilhado indisponível.")); });
}

async function resumeOwnedCollaboration(): Promise<void> {
  const catalog = catalogStore.getState();
  const entry = catalog.catalog?.entries.find(entry => entry.id === catalog.activeId);
  const root = entry?.location.kind === 'repository' ? entry.location.root : null;
  if (!root || workspace.storage()?.label !== `${root}/.arch`) return;
  catalogStore.setState({ busy: true });
  try {
    const response = await fetch('/api/share').catch(() => null);
    const status = response?.ok ? await response.json().catch(() => null) : null;
    if (status?.active && status.root === root) await joinOwnedCollaboration(root);
    else sessionStorage.removeItem('joinlet:owned-share');
  } finally { catalogStore.setState({ busy: false }); }
}

/** "Reabrir pasta": the permission prompt needs this click. */
export async function reopenFolder(): Promise<void> {
  if (!folder) return;
  try {
    if (!(await requestPermission(folder))) {
      showToast(uiText("Sem permissão para a pasta."));
      return;
    }
    await openFolder(folder, workspaceGone(folder));
  } catch (err) {
    showToast(uiText("Não foi possível abrir a pasta: {0}", [reason(err)]));
  }
}

export async function switchToBrowserStorage(): Promise<void> {
  try {
    if (catalogStore.getState().catalog?.entries.some((entry) => entry.id === LEGACY_WORKSPACE)) {
      await openRegisteredWorkspace(LEGACY_WORKSPACE);
      return;
    }
    await saveBackendChoice({ kind: 'indexeddb' });
    await openBrowser();
  } catch (err) {
    showToast(uiText("Não foi possível abrir o workspace: {0}", [reason(err)]));
  }
}

workspace.store.subscribe((state, previous) => {
  if (!state.data || state.source !== previous.source || (state.data.manifest.name === previous.data?.manifest.name && state.data.manifest.logo === previous.data?.manifest.logo)) return;
  const activeId = catalogStore.getState().activeId;
  if (!activeId) return;
  void updateCatalog((catalog) => catalog ? { ...catalog, entries: catalog.entries.map((entry) => entry.id === activeId ? { ...entry, name: state.data!.manifest.name, logo: state.data!.manifest.logo } : entry) } : { version: 1, activeId: null, entries: [] })
    .catch(() => catalogStore.setState({ error: uiText("O nome foi salvo no workspace, mas não foi atualizado na lista de projetos.") }));
});

/** "Abrir pasta…": opens `<pasta>/.arch`, or copies the current workspace there when it has none. */
export async function openFolderPicker(): Promise<void> {
  if (!canPickFolder()) {
    showToast(uiText("Este navegador não escreve direto na pasta. Conecte o repositório pelo painel GitHub informando o caminho."));
    return;
  }
  try {
    const handle = await pickFolder();
    if (!handle) return;
    await changeProject(async () => {
      const catalog = catalogStore.getState().catalog;
      const previous = catalog?.entries.find((entry) => entry.id === catalogStore.getState().activeId)?.location;
      const target = createFolderAdapter(handle);
      const current = workspace.store.getState().data;
      const copying = (await target.read('strukt.json')) === null;
      let projectId = copying ? catalogStore.getState().activeId ?? undefined : undefined;
      for (const entry of catalog?.entries ?? []) if (entry.location.kind === 'folder' && (entry.location.handle === handle || await handle.isSameEntry?.(entry.location.handle))) projectId = entry.id;
      if (!projectId) assertBetaGrowth('workspaces', catalog?.entries.length ?? 0, (catalog?.entries.length ?? 0) + 1);
      if (copying) {
        if (!current || !window.confirm(uiText("A pasta “{0}” não tem um workspace do Joinlet. Copiar o workspace atual para {1}?", [handle.name, target.label]))) return;
        if (adapter) await writeFiles(target, await extraFiles(adapter));
      }
      await openFolder(handle, () => workspace.store.getState().data!, uiText("Workspace aberto em {0}.", [target.label]), projectId);
      await leaveRepository(previous?.kind === 'repository' ? previous.root : undefined);
      await resetProjectContext();
      catalogStore.setState({ open: false });
    });
  } catch (err) {
    showToast(uiText("Não foi possível abrir a pasta: {0}", [reason(err)]));
  }
}

/** Folder writes that fail for lack of permission need a click to ask again before retrying. */
export async function retrySave(): Promise<void> {
  try {
    if (adapter?.kind === 'folder' && folder && !(await hasPermission(folder))) await requestPermission(folder);
    await workspace.retrySave();
  } catch (err) {
    showToast(reason(err));
  }
}

export async function exportZip(): Promise<void> {
  try {
    const data = workspace.store.getState().data;
    if (!data) return;
    await workspace.flush();
    const extra = adapter ? await extraFiles(adapter) : {};
    const { zipFiles } = await import('@strukt/workspace/zip'); // fflate loads on the first zip
    downloadBlob(new Blob([zipFiles({ ...extra, ...workspace.files() })], { type: 'application/zip' }), `${slugify(data.manifest.name)}.zip`);
    trackAnalytics('export_generated', false, { format: 'zip' });
  } catch (err) {
    trackAnalytics('export_failed', false, { format: 'zip' });
    showToast(reason(err));
  }
}

/** Replaces the current workspace with the one in a .zip (validated before anything is touched). */
export async function importZip(file: File): Promise<void> {
  try {
    const { unzipFiles } = await import('@strukt/workspace/zip');
    const files = unzipFiles(new Uint8Array(await file.arrayBuffer()));
    const incoming = await loadWorkspace(createMemoryAdapter(files));
    if (!incoming) {
      showToast(uiText("O .zip não tem um workspace do Joinlet."));
      return;
    }
    const current = workspace.store.getState().data;
    if (!current || !adapter) return;
    assertBetaGrowth('diagrams', current.manifest.diagrams.length, incoming.data.manifest.diagrams.length);
    if (!window.confirm(uiText("Substituir o workspace “{0}” por “{1}”?", [current.manifest.name, incoming.data.manifest.name]))) return;
    // A version comparison locks the diagram store the same way, but it is not the AI lock below: end
    // it first, so only a real pending AI draft still refuses the import.
    versionStore.getState().stopCompare();
    if (diagramStore.getState().readOnly) {
      showToast(uiText("Aplique ou descarte a proposta da IA antes de importar."));
      return;
    }
    const target = adapter;
    // Only the files the imported workspace owns (plus `.strukt.json` backups), its versions/context and the
    // legacy `.strukt` files of an old zip (migrated when the workspace opens) — losing versions or context on
    // import would silently drop history and leave stale agent context behind — reach the storage; everything
    // else (`notes.txt`, `__MACOSX/…`, an unsafe path `unzipFiles` already dropped) is junk. Raw text is kept,
    // so version/context files survive the import byte-for-byte.
    const owned = Object.keys(workspaceFiles(incoming.data));
    const keep = new Set([
      ...owned,
      ...owned.filter((p) => p.endsWith(".strukt.json")).map((p) => `${p}.bak`),
      ...Object.keys(files).filter((p) => p.endsWith('.strukt') || p.endsWith('.strukt.bak')),
      ...Object.keys(files).filter((p) => p.startsWith(`${VERSIONS_DIR}/`) || p.startsWith(`${CONTEXT_DIR}/`) || parseCommentsPath(p) !== null),
    ]);
    const imported = Object.fromEntries(Object.entries(files).filter(([p]) => keep.has(p)));
    // Everything that can fail (unzip, parse, confirm, the lock check) already happened above; only
    // now do we touch the live workspace. `open()` (Task 6) swaps in the new data only once it has
    // loaded back from `target`, so a failure past this point leaves the current workspace live.
    await workspace.flush();
    let swapped = false;
    try {
      await replaceFiles(target, imported);
      announce([], await openWith(target, () => incoming.data));
      swapped = true;
    } catch (err) {
      // Still on the previous workspace, but `target` may hold imported files: write the live workspace back.
      if (!swapped) await workspace.rewriteAll();
      throw err;
    }
    requestFit();
  } catch (err) {
    showToast(reason(err));
  }
}

/** Closing the tab loses something: writes still pending, or a memory workspace (nothing of it is ever saved). */
export function shouldWarnOnUnload(): boolean {
  return workspace.hasUnsaved() || workspace.store.getState().source?.kind === 'memory';
}

export function guardUnsavedChanges(): void {
  window.addEventListener('beforeunload', (event) => {
    if (!shouldWarnOnUnload()) return;
    void workspace.flush();
    event.preventDefault();
    event.returnValue = ''; // Safari still needs it for the prompt
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void workspace.flush();
  });
}
