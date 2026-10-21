import { ASSISTANTS_PATH, createMemoryAdapter, newWorkspace, parseAssistants, printAssistants } from '@strukt/workspace';
import type { Assistant } from '@strukt/workspace';
import { describe, expect, it } from 'vitest';
import { createDiagramStore } from '../state/diagramStore';
import { createWorkspace } from './workspace';

const custo: Assistant = { id: 'custo', name: 'Revisar custos', instruction: 'Aponte custos desnecessários.', scope: 'workspace' };

describe('saved assistants (assistants.json autosave)', () => {
  it('writes the list after a change and removes the file when the list is emptied', async () => {
    const workspace = createWorkspace(createDiagramStore());
    const adapter = createMemoryAdapter();
    await workspace.open(adapter, () => newWorkspace('A'));
    expect(adapter.files.has(ASSISTANTS_PATH)).toBe(false);
    await workspace.setAssistants([custo]);
    expect(workspace.store.getState().data?.assistants).toEqual([custo]);
    await workspace.flush();
    expect(adapter.files.get(ASSISTANTS_PATH)).toBe(printAssistants([custo]));
    await workspace.setAssistants([]);
    await workspace.flush();
    expect(adapter.files.has(ASSISTANTS_PATH)).toBe(false);
    await workspace.close();
  });

  it('flushes a pending list to its owner when switching workspaces', async () => {
    const workspace = createWorkspace(createDiagramStore(), { saveDelay: 60_000 });
    const a = createMemoryAdapter(), b = createMemoryAdapter();
    await workspace.open(a, () => newWorkspace('A'));
    await workspace.setAssistants([custo]);
    await workspace.open(b, () => newWorkspace('B'));
    expect(parseAssistants(a.files.get(ASSISTANTS_PATH)!)).toEqual([custo]);
    expect(b.files.has(ASSISTANTS_PATH)).toBe(false);
    expect(workspace.store.getState().data?.assistants).toBeUndefined();
    await workspace.open(a, () => newWorkspace('A'));
    expect(workspace.store.getState().data?.assistants).toEqual([custo]);
    await workspace.close();
  });

  it('refuses an invalid list with the reason, changing and writing nothing', async () => {
    const workspace = createWorkspace(createDiagramStore());
    const adapter = createMemoryAdapter();
    await workspace.open(adapter, () => newWorkspace('A'));
    await expect(workspace.setAssistants([{ ...custo, name: ' ' }])).rejects.toThrow('Dê um nome ao assistente.');
    await expect(workspace.setAssistants([{ ...custo, id: 'builtin-x' }])).rejects.toThrow('reservado');
    expect(workspace.store.getState().data?.assistants).toBeUndefined();
    await workspace.flush();
    expect(adapter.files.has(ASSISTANTS_PATH)).toBe(false);
    await workspace.close();
  });

  it('does not change the list in a read-only session', async () => {
    const diagram = createDiagramStore(), workspace = createWorkspace(diagram);
    await workspace.open(createMemoryAdapter(), () => newWorkspace('A'));
    diagram.getState().setReadOnly('Somente leitura.');
    await expect(workspace.setAssistants([custo])).rejects.toThrow('Somente leitura.');
    expect(workspace.store.getState().data?.assistants).toBeUndefined();
    diagram.getState().setReadOnly(null);
    await workspace.close();
  });

  it('is written again by rewriteAll (a copy to another place)', async () => {
    const workspace = createWorkspace(createDiagramStore());
    const adapter = createMemoryAdapter();
    await workspace.open(adapter, () => ({ ...newWorkspace('A'), assistants: [custo] }));
    await workspace.rewriteAll();
    expect(parseAssistants(adapter.files.get(ASSISTANTS_PATH)!)).toEqual([custo]);
    await workspace.close();
  });
});
