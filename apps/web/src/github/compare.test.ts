import { emptyLayout, emptyModel } from '@strukt/core';
import { printDiagramJson } from '@strukt/json';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { diagramStore } from '../state/appStore';
import { PRESENT_LOCK } from '../state/locks';
import { dismissToast, uiStore } from '../ui/uiStore';
import { workspace } from '../workspace/appWorkspace';

const request = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('./client', () => ({ requestGitDiagram: request.fn }));

const { BRANCH_COMPARE_LOCK, branchCompareStore } = await import('./compare');

beforeEach(() => {
  branchCompareStore.getState().stop();
  diagramStore.getState().setReadOnly(null);
  diagramStore.getState().load({ model: emptyModel(), layout: emptyLayout() });
  dismissToast();
  workspace.store.setState({ diagram: 'a' });
});

const ok = async () => ({ kind: 'ok', ref: 'main', json: printDiagramJson(emptyModel()), layout: null, shared: null, flows: null });

describe('branch compare lock', () => {
  it('takes the lock when nobody else holds the diagram', async () => {
    request.fn.mockImplementation(ok);
    expect(await branchCompareStore.getState().start('/r', 'a', 'main')).toBe(true);
    expect(diagramStore.getState().readOnly).toBe(BRANCH_COMPARE_LOCK);
  });

  it('drops the result with a toast when another owner locked the diagram during the request', async () => {
    request.fn.mockImplementation(async () => { diagramStore.getState().setReadOnly(PRESENT_LOCK); return ok(); });
    expect(await branchCompareStore.getState().start('/r', 'a', 'main')).toBe(false);
    expect(diagramStore.getState().readOnly).toBe(PRESENT_LOCK);
    expect(branchCompareStore.getState().status).toBe('idle');
    expect(uiStore.getState().toast).toContain('comparação com o Git foi descartada');
  });
});
