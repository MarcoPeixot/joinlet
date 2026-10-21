import { emptyLayout, emptyModel } from '@strukt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { docSession } from '../ai/session';
import { contextStore } from '../context/session';
import { diagramStore } from '../state/appStore';
import { uiStore } from '../ui/uiStore';
import { versionStore } from '../versions/session';
import { handleShortcut } from './useShortcuts';

const center = () => ({ x: 0, y: 0 });

function key(k: string, mods: { meta?: boolean; shift?: boolean } = {}): KeyboardEvent {
  return { key: k, metaKey: !!mods.meta, ctrlKey: false, shiftKey: !!mods.shift, target: null } as unknown as KeyboardEvent;
}

beforeEach(() => {
  diagramStore.getState().load({ model: emptyModel(), layout: emptyLayout() });
  uiStore.setState({ paletteOpen: false, editingId: null });
  docSession.store.setState({ open: false });
  contextStore.setState({ open: false, status: 'loading', files: {} });
  versionStore.getState().setDialogOpen(false);
  diagramStore.getState().apply([{ op: 'add_node', id: 'A' }], { A: { x: 0, y: 0 } });
  diagramStore.getState().select({ nodes: ['A'], edges: [] });
});

describe('handleShortcut', () => {
  it('nudges the selection 1px with an arrow and 10px with Shift, one undo step each', () => {
    const past = diagramStore.getState().past.length;

    expect(handleShortcut(key('ArrowRight'), center)).toBe(true);
    expect(handleShortcut(key('ArrowDown', { shift: true }), center)).toBe(true);

    expect(diagramStore.getState().layout.nodes.A).toEqual({ x: 1, y: 10 });
    expect(diagramStore.getState().past).toHaveLength(past + 2);
  });

  it('leaves arrows alone when no node is selected', () => {
    diagramStore.getState().select({ nodes: [], edges: [] });
    expect(handleShortcut(key('ArrowRight'), center)).toBe(false);
    expect(diagramStore.getState().layout.nodes.A).toEqual({ x: 0, y: 0 });
  });

  it('runs the flowchart step on ⌘+arrow without nudging the source node', () => {
    expect(handleShortcut(key('ArrowRight', { meta: true }), center)).toBe(true);

    const state = diagramStore.getState();
    expect(state.model.order).toEqual(['A', 'Nó']);
    expect(state.layout.nodes.A).toEqual({ x: 0, y: 0 });
  });

  it('opens "Salvar versão" on ⌘S, even while typing', () => {
    versionStore.getState().setDialogOpen(false);
    const typing = { ...key('s', { meta: true }), target: { tagName: 'TEXTAREA', isContentEditable: false } } as unknown as KeyboardEvent;
    expect(handleShortcut(typing, center)).toBe(true);
    expect(versionStore.getState().dialogOpen).toBe(true);
  });

  it('leaves plain keys aimed at a button, link or dialog to that control; modifier shortcuts stay global', () => {
    const on = (k: string, target: object, mods: { meta?: boolean } = {}) => ({ ...key(k, mods), target }) as unknown as KeyboardEvent;
    const button = { tagName: 'BUTTON', isContentEditable: false };
    const inDialog = { tagName: 'DIV', isContentEditable: false, closest: () => ({}) };
    const before = diagramStore.getState();
    for (const target of [button, inDialog]) {
      for (const k of ['Enter', 'Backspace', 'ArrowRight', 'n', 'Escape']) {
        expect(handleShortcut(on(k, target), center), `${k} on ${target.tagName}`).toBe(false);
      }
    }
    const after = diagramStore.getState();
    expect(after.model).toBe(before.model);
    expect(after.layout).toBe(before.layout);
    expect(after.selection).toEqual({ nodes: ['A'], edges: [] });
    expect(uiStore.getState().editingId).toBeNull();

    expect(handleShortcut(on('z', button, { meta: true }), center)).toBe(true);
    expect(diagramStore.getState().model.elements.A).toBeUndefined();
  });

  it('reports unhandled keys so they keep their default behavior', () => {
    expect(handleShortcut(key('x'), center)).toBe(false);
    expect(handleShortcut(key('r', { meta: true }), center)).toBe(false);
  });

  it('blocks global shortcuts while the doc modal is open', () => {
    docSession.store.setState({ open: true });
    expect(handleShortcut(key('Delete'), center)).toBe(false);
    expect(diagramStore.getState().model.elements.A).toBeDefined();
  });

  it('blocks global shortcuts while the context modal is open', () => {
    contextStore.setState({ open: true, status: 'ready', files: {} });
    expect(handleShortcut(key('Delete'), center)).toBe(false);
    expect(diagramStore.getState().model.elements.A).toBeDefined();
  });

  it('(fix round 1, item 4) blocks global shortcuts while "Salvar versão" is open', () => {
    versionStore.getState().setDialogOpen(true);
    expect(handleShortcut(key('Delete'), center)).toBe(false);
    expect(diagramStore.getState().model.elements.A).toBeDefined();
  });

  it('(fix round 1, item 4) ⌘S still prevents the browser save dialog even while the doc modal blocks other shortcuts', () => {
    docSession.store.setState({ open: true });
    expect(handleShortcut(key('s', { meta: true }), center)).toBe(true);
    expect(versionStore.getState().dialogOpen).toBe(false);
  });

  it('(fix round 1, item 4) ⌘S still prevents the browser save dialog even while the context modal blocks other shortcuts', () => {
    contextStore.setState({ open: true, status: 'ready', files: {} });
    expect(handleShortcut(key('s', { meta: true }), center)).toBe(true);
    expect(versionStore.getState().dialogOpen).toBe(false);
  });

  it('⌘S never opens "Salvar versão" behind the doc modal, the context modal or the command palette', () => {
    const blockers = [
      () => docSession.store.setState({ open: true }),
      () => contextStore.setState({ open: true, status: 'ready', files: {} }),
      () => uiStore.setState({ paletteOpen: true }),
    ];
    for (const block of blockers) {
      docSession.store.setState({ open: false });
      contextStore.setState({ open: false });
      uiStore.setState({ paletteOpen: false });
      block();
      expect(handleShortcut(key('s', { meta: true }), center)).toBe(true);
      expect(versionStore.getState().dialogOpen).toBe(false);
    }
  });
});
