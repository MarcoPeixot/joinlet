import { uiText } from '../i18n';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { DirHandleLike } from './folder';
import { requestAuthHeaders } from './requestAuth';

export type WorkspaceLocation =
  | { kind: 'browser'; namespace: string | null }
  | { kind: 'folder'; handle: DirHandleLike }
  | { kind: 'cloud'; workspace: string }
  | { kind: 'repository'; root: string };

export interface WorkspaceEntry {
  id: string;
  name: string;
  logo?: string;
  location: WorkspaceLocation;
  createdAt: number;
  lastOpenedAt: number;
}

export interface WorkspaceCatalog {
  version: 1;
  activeId: string | null;
  entries: WorkspaceEntry[];
}

export const LEGACY_WORKSPACE = 'browser-legacy';
export const catalogStore = createStore<{
  catalog: WorkspaceCatalog | null;
  activeId: string | null;
  open: boolean;
  creating: boolean;
  repositoryOpen: boolean;
  busy: boolean;
  error: string | null;
  available: boolean;
  cloud: boolean;
}>()(() => ({ catalog: null, activeId: null, open: false, creating: false, repositoryOpen: false, busy: false, error: null, available: true, cloud:false }));

export function useCatalog<T>(selector: (state: ReturnType<typeof catalogStore.getState>) => T): T {
  return useStore(catalogStore, selector);
}

export async function loadCatalog(): Promise<WorkspaceCatalog | null> {
  if(catalogStore.getState().cloud) {
    const response=await fetch('/api/remote/workspaces',{headers:requestAuthHeaders()});
    const data=await response.json();if(!response.ok)throw Error(data.error??uiText('Não foi possível carregar os workspaces.'));
    const catalog:WorkspaceCatalog={version:1,activeId:data.activeId,entries:data.workspaces.map((entry:Omit<WorkspaceEntry,'location'>)=>({...entry,location:{kind:'cloud',workspace:entry.id}}))};
    catalogStore.setState({catalog,activeId:catalog.activeId,available:true});return catalog;
  }
  return (await import('./catalogStorage')).loadCatalog();
}

export async function updateCatalog(change: (current: WorkspaceCatalog | null) => WorkspaceCatalog): Promise<WorkspaceCatalog> {
  return (await import('./catalogStorage')).updateCatalog(change);
}

export async function rememberWorkspace(location: WorkspaceLocation, name: string, id?: string): Promise<void> {
  return (await import('./catalogStorage')).rememberWorkspace(location, name, id);
}

export function locationLabel(location: WorkspaceLocation): string {
  return location.kind === 'cloud' ? 'Joinlet Cloud' : location.kind === 'browser' ? uiText("Neste navegador") : location.kind === 'folder' ? `${location.handle.name}/.arch` : `${location.root}/.arch`;
}

export function showProjects(): void {
  catalogStore.setState({ open: true, error: null });
  void loadCatalog().catch((error) => catalogStore.setState({ error: String(error instanceof Error ? error.message : error), available: false }));
}

export function showCreateWorkspace(): void {
  catalogStore.setState({ creating: true, error: null });
}
