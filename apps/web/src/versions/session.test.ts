import { addItem, createMemoryAdapter, emptyDiagram, newWorkspace } from '@strukt/workspace';
import type { WorkspaceData } from '@strukt/workspace';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDraft } from '../ai/draft';
import { aiStore, onDraftApplied } from '../ai/session';
import { registerCodeSync } from '../code/registry';
import { diagramStore } from '../state/appStore';
import { closeRightPanel, toggleRightPanel, uiStore } from '../ui/uiStore';
import { workspace } from '../workspace/appWorkspace';
import { toggleVersions, versionStore } from './session';
import { COMPARE_LOCK } from './versionStore';

/** No @types/node in apps/web: the shape of the Node test runtime's `process` we rely on for one test. */
interface UnhandledRejectionEmitter {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
}

/** Opens a fresh in-memory workspace with one diagram ("Exemplo" → slug "exemplo"). */
async function openWorkspace(label: string, extra?: (data: WorkspaceData) => WorkspaceData) {
  const adapter = createMemoryAdapter({}, label);
  await workspace.open(adapter, () => {
    const base = newWorkspace(label, { title: 'Exemplo', snapshot: emptyDiagram() });
    return extra ? extra(base) : base;
  });
  return adapter;
}

/** A no-op draft (same model/layout, empty ops): enough to drive `aiStore.apply()` without a network request. */
async function noopDraft() {
  const { model, layout } = diagramStore.getState();
  const made = await createDraft(model, layout, { ops: [], summary: 'Resumo da IA', source: 'ai' });
  if (!made.ok) throw new Error(`setup: ${made.error}`);
  return made.draft;
}

beforeEach(async () => {
  aiStore.setState({ draft: null, status: 'idle', notice: null, open: false, prompt: '' });
  diagramStore.getState().setReadOnly(null);
  versionStore.getState().setOpen(false);
  versionStore.getState().setDialogOpen(false);
  uiStore.setState({ toast: null });
  await openWorkspace('Padrão');
});

describe('versions/session (app wiring)', () => {
  it('(item 1) refreshes the version list and ends a comparison when the workspace source changes, even if the new diagram keeps the same slug', async () => {
    await versionStore.getState().refresh();
    await versionStore.getState().save('Versão de A');
    expect(versionStore.getState().entries).toHaveLength(1);
    await versionStore.getState().startCompare(versionStore.getState().entries[0]!);
    expect(diagramStore.getState().readOnly).toBe(COMPARE_LOCK);

    // A different memory adapter, but the first diagram is still "Exemplo" → same slug "exemplo".
    await openWorkspace('Padrão');

    await vi.waitFor(() => expect(versionStore.getState().entries).toEqual([]));
    expect(versionStore.getState().compare).toBeNull();
    expect(diagramStore.getState().readOnly).toBeNull();
  });

  it('(item 3 & 6) an AI request in flight without a draft yet is refused with its own message', async () => {
    await versionStore.getState().refresh();
    await versionStore.getState().save('x');
    const entry = versionStore.getState().entries[0]!;
    aiStore.setState({ status: 'loading' });

    await versionStore.getState().startCompare(entry);

    expect(versionStore.getState().compare).toBeNull();
    expect(uiStore.getState().toast).toBe('Aguarde ou cancele o pedido à IA antes de comparar versões.');
  });

  it('(item 3, non-regression) a pending AI draft still uses "Aplique ou descarte…"', async () => {
    await versionStore.getState().refresh();
    await versionStore.getState().save('x');
    const entry = versionStore.getState().entries[0]!;
    aiStore.setState({ draft: await noopDraft() });

    await versionStore.getState().startCompare(entry);

    expect(versionStore.getState().compare).toBeNull();
    expect(uiStore.getState().toast).toBe('Aplique ou descarte a proposta da IA antes de comparar versões.');
  });

  it('(item 6) opening the AI panel ends an active comparison', async () => {
    await versionStore.getState().refresh();
    await versionStore.getState().save('x');
    await versionStore.getState().startCompare(versionStore.getState().entries[0]!);
    expect(versionStore.getState().compare).not.toBeNull();

    aiStore.getState().setOpen(true);

    expect(versionStore.getState().compare).toBeNull();
    expect(diagramStore.getState().readOnly).toBeNull();
  });

  it('(item 6) starting a comparison closes the AI panel', async () => {
    aiStore.getState().setOpen(true);
    await versionStore.getState().refresh();
    await versionStore.getState().save('x');

    await versionStore.getState().startCompare(versionStore.getState().entries[0]!);

    expect(aiStore.getState().open).toBe(false);
    expect(versionStore.getState().compare).not.toBeNull();
  });

  it('(item 6) workspace.openDiagram succeeds and unlocks the diagram store during a comparison', async () => {
    await openWorkspace('Dois diagramas', (data) => addItem(data, 'diagram', 'Outro', emptyDiagram()).data);
    await versionStore.getState().refresh();
    await versionStore.getState().save('x');
    await versionStore.getState().startCompare(versionStore.getState().entries[0]!);
    expect(diagramStore.getState().readOnly).toBe(COMPARE_LOCK);

    await expect(workspace.openDiagram('outro')).resolves.toBeUndefined();

    expect(diagramStore.getState().readOnly).toBeNull();
    expect(versionStore.getState().compare).toBeNull();
    expect(workspace.store.getState().diagram).toBe('outro');
  });

  it('(item 5a) isolates onDraftApplied listeners: one throwing does not stop the others or fail apply()', async () => {
    aiStore.setState({ draft: await noopDraft() });
    const seen: string[] = [];
    const stopThrow = onDraftApplied(() => {
      throw new Error('boom');
    });
    const stopRecord = onDraftApplied(() => void seen.push('recorded'));
    try {
      await expect(aiStore.getState().apply()).resolves.toBe(true);
    } finally {
      stopThrow();
      stopRecord();
    }
    expect(seen).toEqual(['recorded']);
  });

  it('(item 5b) a failed fire-and-forget version save after an AI apply never becomes an unhandled rejection', async () => {
    let calls = 0;
    const unregister = registerCodeSync({
      edited: () => {},
      dispose: () => {},
      // 1st call: aiStore.apply()'s own flush (must succeed for apply() to proceed).
      // 2nd call: versions/session.ts's fire-and-forget save() → commitVersion's flush (rejects).
      flush: () => (calls++ === 0 ? Promise.resolve() : Promise.reject(new Error('flush indisponível'))),
    });
    // No @types/node in apps/web: reach the Node test runtime's `process` through `globalThis` instead.
    const nodeProcess = (globalThis as unknown as { process: UnhandledRejectionEmitter }).process;
    const rejections: unknown[] = [];
    const onRejection = (err: unknown) => rejections.push(err);
    nodeProcess.on('unhandledRejection', onRejection);
    try {
      aiStore.setState({ draft: await noopDraft() });
      await expect(aiStore.getState().apply()).resolves.toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 0)); // let the fire-and-forget save() settle
    } finally {
      nodeProcess.off('unhandledRejection', onRejection);
      unregister();
    }
    expect(rejections).toEqual([]);
  });
});

describe('versions/session and the right panel slot', () => {
  beforeEach(() => closeRightPanel());

  it('toggleVersions opens and closes through rightPanel, and versionStore.open follows', () => {
    toggleVersions();
    expect(uiStore.getState().rightPanel).toBe('versions');
    expect(versionStore.getState().open).toBe(true);
    toggleVersions();
    expect(uiStore.getState().rightPanel).toBeNull();
    expect(versionStore.getState().open).toBe(false);
  });

  it('versionStore.setOpen (the panel close button) clears and sets rightPanel', () => {
    versionStore.getState().setOpen(true);
    expect(uiStore.getState().rightPanel).toBe('versions');
    versionStore.getState().setOpen(false);
    expect(uiStore.getState().rightPanel).toBeNull();
  });

  it('another panel replacing versions closes it and ends the comparison', async () => {
    await versionStore.getState().refresh();
    await versionStore.getState().save('Versão');
    toggleVersions();
    await versionStore.getState().startCompare(versionStore.getState().entries[0]!);
    expect(versionStore.getState().compare).not.toBeNull();
    toggleRightPanel('flows');
    expect(versionStore.getState().open).toBe(false);
    expect(versionStore.getState().compare).toBeNull();
    expect(diagramStore.getState().readOnly).toBeNull();
  });

  it('closing versions does not close an unrelated panel', () => {
    toggleRightPanel('model');
    versionStore.getState().setOpen(false);
    expect(uiStore.getState().rightPanel).toBe('model');
  });
});
