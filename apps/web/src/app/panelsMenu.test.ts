import { describe, expect, it } from 'vitest';
import { PANEL_GROUPS, panelHint, panelsSummary, panelsTriggerLabel } from './panelsMenu';

const quiet = { concerns: 0, changes: 0, lens: null };

describe('Painéis menu', () => {
  it('lists every right-hand panel once, Explorar before Publicar', () => {
    expect(PANEL_GROUPS.map((group) => group.label)).toEqual(['Explorar', 'Publicar']);
    const ids = PANEL_GROUPS.flatMap((group) => group.panels.map((panel) => panel.id));
    expect(ids).toEqual(['flows', 'model', 'perspectives', 'accuracy', 'comments', 'versions', 'timeline', 'github']);
  });

  it('shows a count only when it is above zero', () => {
    expect(panelHint('accuracy', quiet)).toBeUndefined();
    expect(panelHint('github', quiet)).toBeUndefined();
    expect(panelHint('accuracy', { ...quiet, concerns: 3 })).toBe('3');
    expect(panelHint('github', { ...quiet, changes: 2 })).toBe('2');
    expect(panelHint('versions', { concerns: 3, changes: 2, lens: null })).toBeUndefined();
  });

  it('names the active lens on Modelo', () => {
    expect(panelHint('model', quiet)).toBeUndefined();
    expect(panelHint('model', { ...quiet, lens: 'risco:alto' })).toBe('risco:alto');
  });

  it('has nothing to say (no dot) at zero, and says what is pending otherwise', () => {
    expect(panelsSummary(quiet)).toEqual([]);
    expect(panelsSummary({ concerns: 1, changes: 2, lens: 'pii' })).toEqual(['2 mudanças pendentes no .arch/', '1 pendência de precisão', 'lente ativa: pii']);
    expect(panelsSummary({ ...quiet, changes: 1 })).toEqual(['1 mudança pendente no .arch/']);
  });

  it('names the open panel on the trigger', () => {
    expect(panelsTriggerLabel(null)).toBe('Painéis');
    expect(panelsTriggerLabel('versions')).toBe('Versões');
    expect(panelsTriggerLabel('accuracy')).toBe('Precisão');
  });
});
