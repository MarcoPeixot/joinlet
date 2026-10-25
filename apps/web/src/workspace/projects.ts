import { assertBetaGrowth } from '@strukt/workspace';
import { systemMessage, uiText } from '../i18n';
import { newWorkspace, workspaceFiles, writeFiles } from '@strukt/workspace';
import { workspace } from './appWorkspace';
import { catalogStore, LEGACY_WORKSPACE, loadCatalog, updateCatalog } from './catalog';
import { createIdbAdapter } from './idb';
import { createFolderAdapter, requestPermission } from './folder';
import { collaborationSession, connectRepositoryNow, firstWorkspace, openWith, rememberOpened } from './boot';
import { requestFit, showToast, uiStore } from '../ui/uiStore';
import { aiStore, docSession } from '../ai/session';
import { closeAgentContext } from '../context/session';
import { stopTour } from '../onboarding/tour';
import { versionStore } from '../versions/session';
import { clearSnapshot } from '../state/persist';
import { requestAuthHeaders } from './requestAuth';

function navigateToCloud(id: string) {
  const url=new URL(window.location.href);url.searchParams.set('workspace',id);url.searchParams.delete('connection');
  window.location.assign(url.href);
}
async function changeCloudProject(change:()=>Promise<void>) {
  if(catalogStore.getState().busy)throw Error(uiText('Aguarde a abertura do workspace.'));
  catalogStore.setState({busy:true,error:null});
  try { await workspace.prepareSwitch();await change(); }
  catch(error){catalogStore.setState({error:reason(error)});throw error;}
  finally{catalogStore.setState({busy:false});}
}

const reason = (error: unknown) => systemMessage(error instanceof Error ? error.message : String(error));

export async function resetProjectContext(root = ''): Promise<void> {
  const { githubStore } = await import('../github/session');
  const keepGithubOpen = Boolean(root) && uiStore.getState().rightPanel === 'github';
  githubStore.getState().setRepoPath(root);
  uiStore.setState({ editingId: null, guides: [], frozen: null, paletteOpen: false, rightPanel: null,
    activeTag: null, activePerspective: null, perspectiveRead: null, activeFlowEdges: [], activeFlowNodes: [], reach: null, focusPreview: null, diagramTrail: [] });
  requestFit();
  aiStore.getState().setOpen(false);
  docSession.close();
  closeAgentContext();
  stopTour();
  versionStore.getState().setDialogOpen(false);
  if (keepGithubOpen) githubStore.getState().setOpen(true);
}

export async function changeProject<T>(change: () => Promise<T>): Promise<T> {
  if (collaborationSession()) throw new Error(uiText("Este convite está vinculado ao workspace compartilhado. Abra outro projeto em uma sessão local."));
  if (catalogStore.getState().busy) throw new Error(uiText("Aguarde a abertura do workspace."));
  catalogStore.setState({ busy: true, error: null });
  try {
    const { githubStore } = await import('../github/session');
    if (githubStore.getState().publishing) throw new Error(uiText("Aguarde a publicação no GitHub antes de trocar de projeto."));
    await workspace.prepareSwitch();
    return await change();
  } catch (error) {
    catalogStore.setState({ error: reason(error) });
    throw error;
  } finally { catalogStore.setState({ busy: false }); }
}

export async function leaveRepository(root: string | undefined): Promise<void> {
  if (!root) return;
  await fetch('/api/git/disconnect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: root }) })
    .catch(() => showToast(uiText("O servidor local está indisponível. A seleção MCP será atualizada quando você conectar outro repositório.")));
}

export async function createBrowserWorkspace(submittedName: string): Promise<void> {
  const name = submittedName.trim();
  if (!name) throw new Error(uiText("Informe o nome do workspace."));
  if(catalogStore.getState().cloud)return changeCloudProject(async()=>{
    const response=await fetch('/api/remote/workspaces',{method:'POST',headers:{'content-type':'application/json',...requestAuthHeaders()},body:JSON.stringify({name})});
    const data=await response.json();if(!response.ok)throw Error(data.error??uiText('Não foi possível criar o workspace.'));
    navigateToCloud(data.id);
  });
  if (!catalogStore.getState().available) throw new Error(uiText("O armazenamento local está indisponível. Tente reabrir a lista de projetos."));
  await changeProject(async () => {
    const current = await loadCatalog();
    assertBetaGrowth('workspaces', current?.entries.length ?? 0, (current?.entries.length ?? 0) + 1);
    const previous = current?.entries.find((entry) => entry.id === catalogStore.getState().activeId)?.location;
    const id = crypto.randomUUID();
    const target = createIdbAdapter(id);
    // Reserve atomically in IndexedDB before writing files: competing tabs cannot create a second workspace.
    await updateCatalog((catalog) => ({ version: 1, activeId: catalog?.activeId ?? null, entries: [...(catalog?.entries ?? []),
      { id, name, location: { kind: 'browser', namespace: id }, createdAt: Date.now(), lastOpenedAt: 0 }] }));
    try {
      await writeFiles(target, workspaceFiles(newWorkspace(name)));
      await openWith(target, () => { throw new Error(uiText("O novo workspace não foi salvo.")); });
    } catch (error) {
      await updateCatalog(catalog => ({ ...catalog!, entries: catalog!.entries.filter(entry => entry.id !== id) }));
      for (const path of await target.list()) await target.remove(path);
      throw error;
    }
    await rememberOpened({ kind: 'browser', namespace: id }, id);
    await leaveRepository(previous?.kind === 'repository' ? previous.root : undefined);
    await resetProjectContext();
    catalogStore.setState({ open: false, creating: false });
  });
}

export async function openRegisteredWorkspace(id: string): Promise<void> {
  if(catalogStore.getState().cloud)return changeCloudProject(async()=>{
    const catalog=await loadCatalog();if(!catalog?.entries.some(entry=>entry.id===id))throw Error(uiText('Workspace não encontrado. Atualize a lista de projetos.'));
    navigateToCloud(id);
  });
  await changeProject(async () => {
    const catalog = await loadCatalog();
    const entry = catalog?.entries.find((entry) => entry.id === id);
    if (!entry) throw new Error(uiText("Workspace não encontrado. Atualize a lista de projetos."));
    const previous = catalog?.entries.find((item) => item.id === catalogStore.getState().activeId)?.location;
    const location = entry.location;
    if(location.kind==='cloud')throw Error(uiText('Entre na sua conta Joinlet para abrir este workspace.'));
    if (location.kind === 'repository') await connectRepositoryNow(location.root, { allowInitialize: false, projectId: id });
    else {
      if (location.kind === 'folder' && !(await requestPermission(location.handle))) throw new Error(uiText("Sem permissão para abrir a pasta deste projeto."));
      const next = location.kind === 'browser' ? createIdbAdapter(location.namespace) : createFolderAdapter(location.handle, id);
      let migrated = false;
      const warnings = await openWith(next, () => {
        if (id === LEGACY_WORKSPACE) {
          const first = firstWorkspace();
          migrated = first.migrated;
          return first.data;
        }
        throw new Error(uiText("O workspace não está mais disponível neste destino. Seus outros projetos foram preservados."));
      }, location.kind === 'folder' ? location.handle : null);
      if (migrated) clearSnapshot();
      await rememberOpened(location, id);
      await leaveRepository(previous?.kind === 'repository' ? previous.root : undefined);
      await resetProjectContext();
      if (warnings.length) showToast(warnings[0]!);
    }
    catalogStore.setState({ open: false });
  });
}
