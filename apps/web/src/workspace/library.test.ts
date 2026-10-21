import { createMemoryAdapter, emptyLibrary, newWorkspace, parseLibrary } from '@strukt/workspace';
import { describe, expect, it } from 'vitest';
import { createDiagramStore } from '../state/diagramStore';
import { createWorkspace } from './workspace';

const preset = { id: 'custom-api', label: 'API própria', description: '', category: 'Meu workspace', color: 'gray', presentation: 'card' as const, icon: 'server' };

describe('library autosave', () => {
  it('flushes a pending library to its owner when switching workspaces', async () => {
    const workspace = createWorkspace(createDiagramStore(), {saveDelay: 60_000});
    const a = createMemoryAdapter(), b = createMemoryAdapter();
    await workspace.open(a, () => newWorkspace('A'));
    workspace.setLibrary({ components: [preset], templates: [] });
    await workspace.open(b, () => newWorkspace('B'));
    expect(parseLibrary(a.files.get('library.json')!).components).toEqual([preset]);
    expect(b.files.has('library.json')).toBe(false);
    expect(workspace.store.getState().data?.library).toBeUndefined();
    await workspace.open(a, () => newWorkspace('A'));
    expect(workspace.store.getState().data?.library?.components).toEqual([preset]);
    workspace.setLibrary(emptyLibrary());
    await workspace.flush();
    expect(a.files.has('library.json')).toBe(false);
    await workspace.close();
  });

  it('rejects invalid edits before changing the library or scheduling a write', async () => {
    const workspace = createWorkspace(createDiagramStore());
    const adapter = createMemoryAdapter();
    await workspace.open(adapter, () => newWorkspace('A'));
    expect(() => workspace.setLibrary({ components: [{ ...preset, width: -10 }], templates: [] })).toThrow('library.json');
    expect(workspace.store.getState().data?.library).toBeUndefined();
    await workspace.flush();
    expect(adapter.files.has('library.json')).toBe(false);
    await workspace.close();
  });

  it('does not change the library during a read-only session', async () => {
    const diagram = createDiagramStore(), workspace = createWorkspace(diagram);
    await workspace.open(createMemoryAdapter(), () => newWorkspace('A'));
    diagram.getState().setReadOnly('Somente leitura.');
    expect(() => workspace.setLibrary({ components: [preset], templates: [] })).toThrow('Somente leitura.');
    expect(workspace.store.getState().data?.library).toBeUndefined();
    diagram.getState().setReadOnly(null);
    await workspace.close();
  });
});
