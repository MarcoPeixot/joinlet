import { emptyLayout, emptyModel } from '@strukt/core';
import { emptyShared } from '@strukt/workspace';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diagramStore } from '../state/appStore';
import { uiStore } from '../ui/uiStore';
import { workspace } from '../workspace/appWorkspace';
import { recompute } from './engine';
import { setActivePerspective } from './read';

const data = (extra: object = {}) => ({
  manifest: { version: 1, name: 'x', diagrams: [], docs: [], sketches: [] }, diagrams: {}, docs: {}, sketches: {}, board: { cards: [], connections: [] },
  shared: { ...emptyShared(), entities: { u: { id: 'u', tags: ['nivel:contexto'] }, s: { id: 's', tags: ['nivel:container'] } }, views: { d: { Usuário: 'u', Segredo: 's' } } },
  ...extra,
});

beforeEach(() => {
  diagramStore.getState().load({ model: emptyModel(), layout: emptyLayout() });
  diagramStore.getState().apply([{ op: 'add_node', id: 'Usuário' }, { op: 'add_node', id: 'Segredo' }] as never, { Usuário: { x: 0, y: 0 }, Segredo: { x: 300, y: 0 } });
  workspace.store.setState({ diagram: 'd', data: data() as never });
});
afterEach(() => uiStore.setState({ activePerspective: null }));

describe('perspective engine', () => {
  it('keeps the read in step with the choice, and clears it when the choice goes', async () => {
    await import('./engine');
    expect(uiStore.getState().perspectiveRead).toBeNull();
    setActivePerspective('d', { id: 'c4-contexto', name: 'C4: Contexto' });
    expect(uiStore.getState().perspectiveRead?.model.order).toEqual(['Usuário']);
    setActivePerspective('d', null);
    expect(uiStore.getState().perspectiveRead).toBeNull();
  });

  it('follows the diagram, the tags and the saved perspectives as they change', async () => {
    await import('./engine');
    workspace.store.setState({ data: data({ perspectives: { d: [{ id: 'meu', name: 'Meu', levels: ['container'] }] } }) as never });
    uiStore.setState({ activePerspective: { diagram: 'd', id: 'meu', name: 'Meu' } });
    expect(uiStore.getState().perspectiveRead?.model.order).toEqual(['Segredo']);
    workspace.store.setState({ data: data({ perspectives: { d: [{ id: 'meu', name: 'Meu', levels: ['contexto'] }] } }) as never });
    expect(uiStore.getState().perspectiveRead?.model.order).toEqual(['Usuário']);
    diagramStore.getState().apply([{ op: 'add_node', id: 'Novo' }] as never);
    expect(uiStore.getState().perspectiveRead?.model.elements.Novo).toBeUndefined();
  });

  it('reads nothing for a diagram other than the open one, or one the diagram does not offer', async () => {
    await import('./engine');
    uiStore.setState({ activePerspective: { diagram: 'outro', id: 'c4-contexto', name: 'C4' } });
    expect(uiStore.getState().perspectiveRead).toBeNull();
    uiStore.setState({ activePerspective: { diagram: 'd', id: 'constructor', name: 'x' } });
    expect(uiStore.getState().perspectiveRead).toBeNull();
  });

  it('asks the canvas to fit when the reading changes, not on every edit', async () => {
    await import('./engine');
    const fits = () => uiStore.getState().fitRequest;
    const before = fits();
    uiStore.setState({ activePerspective: { diagram: 'd', id: 'c4-contexto', name: 'C4: Contexto' } });
    expect(fits()).toBe(before + 1);
    diagramStore.getState().apply([{ op: 'add_node', id: 'Mais' }] as never);
    recompute();
    expect(fits()).toBe(before + 1);
    uiStore.setState({ activePerspective: { diagram: 'd', id: 'c4-containers', name: 'C4: Containers' } });
    expect(fits()).toBe(before + 2);
  });
});
