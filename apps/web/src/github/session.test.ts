import { createMemoryAdapter, newWorkspace } from '@strukt/workspace';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeRightPanel, toggleRightPanel, uiStore } from '../ui/uiStore';
import { githubStore } from './session';

describe('github session mirrors the right panel slot', () => {
  beforeEach(() => {
    closeRightPanel();
    githubStore.setState({ repoPath: '' });
  });
  it('opening the slot marks the github panel open', () => {
    toggleRightPanel('github');
    expect(githubStore.getState().open).toBe(true);
  });
  it('switching the slot to another panel closes github', () => {
    toggleRightPanel('github');
    toggleRightPanel('flows');
    expect(githubStore.getState().open).toBe(false);
    expect(uiStore.getState().rightPanel).toBe('flows');
  });
  it('setOpen(true) claims the slot and setOpen(false) releases it', () => {
    githubStore.getState().setOpen(true);
    expect(uiStore.getState().rightPanel).toBe('github');
    githubStore.getState().setOpen(false);
    expect(uiStore.getState().rightPanel).toBeNull();
  });
  it('closing github does not close a different panel', () => {
    toggleRightPanel('model');
    githubStore.getState().setOpen(false);
    expect(uiStore.getState().rightPanel).toBe('model');
  });
});

describe('openGithub from a non-diagram view', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('window', { confirm: vi.fn(() => true), setInterval: vi.fn() });
  });
  async function fresh() {
    const ui = await import('../ui/uiStore');
    const appStore = await import('../state/appStore');
    const appWorkspace = await import('../workspace/appWorkspace');
    const session = await import('./session');
    await appWorkspace.workspace.open(createMemoryAdapter({}), () =>
      newWorkspace('W', { title: 'Exemplo', snapshot: appStore.diagramStore.getState() }),
    );
    return { ui, ws: appWorkspace.workspace, session };
  }

  it('switches to the diagram view first, then opens the slot', async () => {
    const { ui, ws, session } = await fresh();
    await ws.show({ kind: 'board' });
    expect(ws.store.getState().view.kind).toBe('board');
    session.openGithub();
    await vi.waitFor(() => expect(ui.uiStore.getState().rightPanel).toBe('github'));
    expect(ws.store.getState().view.kind).toBe('diagram');
  });

  it('never leaves the slot on github while no diagram view can show it', async () => {
    const { ui, ws, session } = await fresh();
    await ws.show({ kind: 'board' });
    session.openGithub();
    expect(ui.uiStore.getState().rightPanel).toBeNull();
    await vi.waitFor(() => expect(ws.store.getState().view.kind).toBe('diagram'));
  });

  it('with no diagrams opens repository configuration from the project list', async () => {
    const { ui, ws, session } = await fresh();
    ws.store.setState({ diagram: null, view: { kind: 'board' } });
    session.openGithub();
    expect(ui.uiStore.getState().rightPanel).toBeNull();
    const { catalogStore } = await import('../workspace/catalog');
    expect(catalogStore.getState()).toMatchObject({ open: true, repositoryOpen: true });
  });

  it('opens the Cloud connection panel even before a diagram exists',async()=>{
    const {ui,ws,session}=await fresh();
    const {catalogStore}=await import('../workspace/catalog');catalogStore.setState({cloud:true});
    ws.store.setState({diagram:null,view:{kind:'board'}});session.openGithub();
    expect(ui.uiStore.getState().rightPanel).toBe('github');
    expect(catalogStore.getState()).toMatchObject({open:false,repositoryOpen:false});
    expect(ws.store.getState().view.kind).toBe('board');
  });
});
