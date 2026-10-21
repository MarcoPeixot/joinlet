import { emptyLayout, emptyModel } from '@strukt/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const shared = vi.hoisted(() => ({ session: null as null | object }));
vi.mock('../workspace/boot', () => ({ collaborationSession: () => shared.session }));
import { diagramStore } from '../state/appStore';
import { renameElement } from './elements';
import { commitLabel } from './labels';

beforeEach(() => {
  diagramStore.getState().load({ model: emptyModel(), layout: emptyLayout() });
});

describe('commitLabel', () => {
  it('renames an element still named by its label, trimming the input', () => {
    diagramStore.getState().apply([{ op: 'add_node', id: 'Nó' }]);

    commitLabel('Nó', '  API  ');

    const { elements } = diagramStore.getState().model;
    expect(elements['Nó']).toBeUndefined();
    expect(elements.API).toEqual({ kind: 'node', id: 'API' });
  });

  it('sets a label when the typed name is taken by another element', () => {
    diagramStore.getState().apply([{ op: 'add_node', id: 'Nó' }, { op: 'add_node', id: 'API' }]);

    commitLabel('Nó', 'API');

    expect(diagramStore.getState().model.elements['Nó']).toEqual({ kind: 'node', id: 'Nó', label: 'API' });
  });

  it('renames to names like "constructor" that exist only on Object.prototype', () => {
    diagramStore.getState().apply([{ op: 'add_node', id: 'Nó' }]);

    commitLabel('Nó', 'constructor');

    expect(diagramStore.getState().model.order).toEqual(['constructor']);
  });

  it('updates an existing custom label instead of renaming', () => {
    diagramStore.getState().apply([{ op: 'add_node', id: 'svc', label: 'Serviço' }]);

    commitLabel('svc', 'Pagamentos');

    expect(diagramStore.getState().model.elements.svc).toEqual({ kind: 'node', id: 'svc', label: 'Pagamentos' });
  });

  it('clears the label when it is set back to the element name', () => {
    diagramStore.getState().apply([{ op: 'add_node', id: 'svc', label: 'Serviço' }]);

    commitLabel('svc', 'svc');

    expect(diagramStore.getState().model.elements.svc).toEqual({ kind: 'node', id: 'svc' });
  });

  it('is a no-op for a blank or unchanged text', () => {
    diagramStore.getState().apply([{ op: 'add_node', id: 'Nó' }, { op: 'add_node', id: 'svc', label: 'Serviço' }]);
    const { past, errorSeq } = diagramStore.getState();

    commitLabel('Nó', '   ');
    commitLabel('Nó', 'Nó');
    commitLabel('svc', 'Serviço');

    expect(diagramStore.getState().past).toHaveLength(past.length);
    expect(diagramStore.getState().errorSeq).toBe(errorSeq);
  });
});

describe('commitLabel in a shared room', () => {
  it('writes the label and keeps the id', () => {
    shared.session = { repo: 'x', csrf: '', mcpUrl: '', mode: 'lan' };
    diagramStore.getState().apply([{ op: 'add_node', id: 'Nó' }]);

    commitLabel('Nó', 'API');

    expect(diagramStore.getState().model.elements['Nó']).toEqual({ kind: 'node', id: 'Nó', label: 'API' });
    expect(diagramStore.getState().model.elements.API).toBeUndefined();
    shared.session = null;
  });
});

describe('renameElement (Inspector "Nome")', () => {
  it('in a shared room writes the label and keeps the id (the merge key)', () => {
    diagramStore.getState().apply([{ op: 'add_node', id: 'Web' }]);
    shared.session = { repo: 'r' };
    try {
      expect(renameElement('Web', ' Portal ')).toBe(true);
      expect(diagramStore.getState().model.elements.Web).toEqual({ kind: 'node', id: 'Web', label: 'Portal' });
      expect(renameElement('Web', 'Web')).toBe(false);
    } finally { shared.session = null; }
    expect(renameElement('Web', 'Site')).toBe(true);
    expect(diagramStore.getState().model.order).toEqual(['Site']);
  });
});
