import { createMemoryAdapter, newWorkspace } from '@strukt/workspace';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BRANCH_COMPARE_LOCK, COMPARE_LOCK, DRAFT_LOCK, PRESENT_LOCK, switchLockedMessage } from '../state/locks';

/** Fresh module graph per test: the workspace/diagram singletons must not leak between cases. */
async function fresh() {
  vi.resetModules();
  const ui = await import('../ui/uiStore');
  const appStore = await import('../state/appStore');
  const { workspace } = await import('../workspace/appWorkspace');
  const present = await import('./presentStore');
  const actions = await import('../workspace/actions');
  await workspace.open(createMemoryAdapter({}), () => newWorkspace('W', { title: 'Um', snapshot: appStore.diagramStore.getState() }));
  const other = await workspace.create('diagram', 'Dois');
  const first = workspace.store.getState().data!.manifest.diagrams[0]!.slug;
  await workspace.openDiagram(first);
  return { ui, appStore, workspace, present, actions, first, other };
}

beforeEach(() => { vi.stubGlobal('window', { confirm: vi.fn(() => true) }); });

describe('switching diagrams while presenting', () => {
  it('exits the mode, releases only the presentation lock and completes the switch', async () => {
    const f = await fresh();
    expect(await f.present.enterPresentation()).toBe(true);
    await f.actions.openItem('diagram', f.other);
    expect(f.workspace.store.getState().diagram).toBe(f.other);
    expect(f.present.presentStore.getState().active).toBe(false);
    expect(f.ui.uiStore.getState().presenting).toBe(false);
    expect(f.appStore.diagramStore.getState().readOnly).toBeNull();
  });

  it('a foreign lock still blocks the switch and is left alone', async () => {
    const f = await fresh();
    f.appStore.diagramStore.getState().setReadOnly(COMPARE_LOCK);
    await expect(f.workspace.openDiagram(f.other)).rejects.toThrow('Saia da comparação de versões antes de trocar de diagrama.');
    expect(f.appStore.diagramStore.getState().readOnly).toBe(COMPARE_LOCK);
    expect(f.workspace.store.getState().diagram).toBe(f.first);
  });
});

describe('switchLockedMessage', () => {
  it('names the lock that actually holds the diagram', () => {
    expect(switchLockedMessage(DRAFT_LOCK)).toBe('Aplique ou descarte a proposta da IA antes de trocar de diagrama.');
    expect(switchLockedMessage(PRESENT_LOCK)).toBe('Saia do modo apresentação antes de trocar de diagrama.');
    expect(switchLockedMessage(COMPARE_LOCK)).toBe('Saia da comparação de versões antes de trocar de diagrama.');
    expect(switchLockedMessage(BRANCH_COMPARE_LOCK)).toBe('Encerre a comparação com o Git antes de trocar de diagrama.');
  });
});
