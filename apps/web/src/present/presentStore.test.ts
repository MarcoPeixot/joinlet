import { emptyLayout, emptyModel } from '@strukt/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiStore } from '../ai/session';
import { handleShortcut } from '../app/useShortcuts';
import { diagramStore } from '../state/appStore';
import { clearToastQueue, dismissToast, uiStore } from '../ui/uiStore';
import { registerCodeSync } from '../code/registry';
import type { CodeSync } from '../code/sync';
import { branchCompareStore } from '../github/compare';
import { COMPARE_LOCK } from '../versions/versionStore';
import { workspace } from '../workspace/appWorkspace';
import { PRESENT_BUSY, PRESENT_COMPARING, PRESENT_LOCK, PRESENT_REFUSED, enterPresentation, exitPresentation, goToStep, handlePresentKey, presentStore, togglePresentation } from './presentStore';

const key = (k: string, extra: Partial<KeyboardEvent> = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: null, ...extra }) as unknown as KeyboardEvent;

beforeEach(() => {
  exitPresentation();
  diagramStore.getState().setReadOnly(null);
  diagramStore.getState().load({ model: emptyModel(), layout: emptyLayout() });
  diagramStore.getState().apply(
    [{ op: 'add_group', id: 'G1', label: 'G1' }, { op: 'add_node', id: 'A', parentId: 'G1' }, { op: 'add_group', id: 'G2', label: 'G2' }, { op: 'add_node', id: 'B', parentId: 'G2' }],
    { A: { x: 0, y: 0 }, B: { x: 200, y: 0 } },
  );
  dismissToast();
  clearToastQueue();
  uiStore.setState({ paletteOpen: false, presenting: false });
  aiStore.setState({ status: 'idle', draft: null, open: false });
});

afterEach(() => workspace.store.setState({ diagram: null }));

describe('presentation lock', () => {
  it('enter locks the diagram and hides the chrome flag; exit releases both', async () => {
    expect(await enterPresentation()).toBe(true);
    expect(diagramStore.getState().readOnly).toBe(PRESENT_LOCK);
    expect(uiStore.getState().presenting).toBe(true);
    expect(presentStore.getState().steps.map((s) => s.title)).toEqual(['Visão geral', 'G1', 'G2']);

    exitPresentation();
    expect(diagramStore.getState().readOnly).toBeNull();
    expect(uiStore.getState().presenting).toBe(false);
    expect(diagramStore.getState().apply([{ op: 'add_node', id: 'C' }])).toBe(true);
  });

  it('refuses with a toast while a draft or comparison holds the diagram, and keeps their lock', async () => {
    diagramStore.getState().setReadOnly(COMPARE_LOCK);
    expect(await enterPresentation()).toBe(false);
    expect(uiStore.getState().toast).toBe(PRESENT_REFUSED);
    expect(presentStore.getState().active).toBe(false);
    exitPresentation();
    expect(diagramStore.getState().readOnly).toBe(COMPARE_LOCK);
  });

  it('exit never releases somebody else\'s lock', async () => {
    await enterPresentation();
    diagramStore.getState().setReadOnly('outro');
    exitPresentation();
    expect(diagramStore.getState().readOnly).toBe('outro');
  });

  it('refuses to start while an AI request is in flight (its draft would take over the lock)', async () => {
    aiStore.setState({ status: 'loading' });
    expect(await enterPresentation()).toBe(false);
    expect(uiStore.getState().toast).toBe(PRESENT_BUSY);
    expect(presentStore.getState().active).toBe(false);
    expect(diagramStore.getState().readOnly).toBeNull();
  });

  it('switching to another diagram ends the mode and releases the lock', async () => {
    workspace.store.setState({ diagram: 'a' });
    await enterPresentation();
    workspace.store.setState({ diagram: 'b' });
    expect(presentStore.getState().active).toBe(false);
    expect(diagramStore.getState().readOnly).toBeNull();
    expect(uiStore.getState().presenting).toBe(false);
  });

  it('⌘J and ⌘K are swallowed and do nothing while presenting', async () => {
    await enterPresentation();
    expect(handleShortcut(key('j', { metaKey: true }), () => ({ x: 0, y: 0 }))).toBe(true);
    expect(aiStore.getState().open).toBe(false);
    expect(handleShortcut(key('k', { metaKey: true }), () => ({ x: 0, y: 0 }))).toBe(true);
    expect(uiStore.getState().paletteOpen).toBe(false);
  });

  it('toggles', async () => {
    togglePresentation();
    await vi.waitFor(() => expect(presentStore.getState().active).toBe(true));
    togglePresentation();
    expect(presentStore.getState().active).toBe(false);
  });
});

describe('presentation entry ordering', () => {
  it('commits pending Código edits before taking the lock', async () => {
    const seen: (string | null)[] = [];
    const sync = { flush: vi.fn(async () => { seen.push(diagramStore.getState().readOnly); }), hasPending: () => true } as unknown as CodeSync;
    const off = registerCodeSync(sync);
    try {
      expect(await enterPresentation()).toBe(true);
    } finally { off(); }
    expect(sync.flush).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([null]);
    expect(diagramStore.getState().readOnly).toBe(PRESENT_LOCK);
  });

  it('re-checks after the flush: a lock taken meanwhile refuses the entry', async () => {
    const sync = { flush: vi.fn(async () => { diagramStore.getState().setReadOnly(COMPARE_LOCK); }), hasPending: () => true } as unknown as CodeSync;
    const off = registerCodeSync(sync);
    try {
      expect(await enterPresentation()).toBe(false);
    } finally { off(); }
    expect(diagramStore.getState().readOnly).toBe(COMPARE_LOCK);
    expect(presentStore.getState().active).toBe(false);
  });

  it('refuses while a branch comparison is still loading', async () => {
    branchCompareStore.setState({ status: 'loading' });
    try {
      expect(await enterPresentation()).toBe(false);
      expect(uiStore.getState().toast).toBe(PRESENT_COMPARING);
    } finally { branchCompareStore.setState({ status: 'idle' }); }
    expect(presentStore.getState().active).toBe(false);
  });
});

describe('presentation keys', () => {
  it('walks the steps, clamped at both ends', async () => {
    await enterPresentation();
    expect(handlePresentKey(key('ArrowRight'))).toBe(true);
    expect(presentStore.getState().index).toBe(1);
    handlePresentKey(key(' '));
    handlePresentKey(key('PageDown'));
    expect(presentStore.getState().index).toBe(2);
    handlePresentKey(key('ArrowLeft'));
    handlePresentKey(key('PageUp'));
    handlePresentKey(key('ArrowLeft'));
    expect(presentStore.getState().index).toBe(0);
    handlePresentKey(key('End'));
    expect(presentStore.getState().index).toBe(2);
    handlePresentKey(key('Home'));
    expect(presentStore.getState().index).toBe(0);
    goToStep(99);
    expect(presentStore.getState().index).toBe(2);
  });

  it('Space stays with a focused button; modifiers and other keys are not handled; Esc exits', async () => {
    await enterPresentation();
    expect(handlePresentKey(key(' '), true)).toBe(false);
    expect(handlePresentKey(key('ArrowRight', { metaKey: true }))).toBe(false);
    expect(handlePresentKey(key('x'))).toBe(false);
    expect(presentStore.getState().index).toBe(0);
    expect(handlePresentKey(key('Escape'))).toBe(true);
    expect(presentStore.getState().active).toBe(false);
    expect(diagramStore.getState().readOnly).toBeNull();
  });

  it('ignores keys when not presenting', async () => {
    expect(handlePresentKey(key('ArrowRight'))).toBe(false);
  });

  it('P toggles from the canvas, is ignored while typing, and other keys do not edit while presenting', async () => {
    expect(handleShortcut(key('p'), () => ({ x: 0, y: 0 }))).toBe(true);
    await vi.waitFor(() => expect(presentStore.getState().active).toBe(true));
    const nodes = diagramStore.getState().model.order.length;
    expect(handleShortcut(key('n'), () => ({ x: 0, y: 0 }))).toBe(false);
    expect(diagramStore.getState().model.order).toHaveLength(nodes);
    expect(handleShortcut(key('p'), () => ({ x: 0, y: 0 }))).toBe(true);
    expect(presentStore.getState().active).toBe(false);

    const input = { tagName: 'INPUT', isContentEditable: false } as unknown as EventTarget;
    expect(handleShortcut(key('p', { target: input }), () => ({ x: 0, y: 0 }))).toBe(false);
    const button = { tagName: 'BUTTON', isContentEditable: false, closest: () => null } as unknown as EventTarget;
    expect(handleShortcut(key('p', { target: button }), () => ({ x: 0, y: 0 }))).toBe(false);
    expect(presentStore.getState().active).toBe(false);
  });
});
