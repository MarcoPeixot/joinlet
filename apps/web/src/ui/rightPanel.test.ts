import { beforeEach, describe, expect, it } from 'vitest';
import { closeRightPanel, toggleRightPanel, uiStore } from './uiStore';

describe('right panel slot', () => {
  beforeEach(() => closeRightPanel());
  it('opening one closes the other', () => {
    toggleRightPanel('flows');
    toggleRightPanel('model');
    expect(uiStore.getState().rightPanel).toBe('model');
  });
  it('toggling the open one closes it', () => {
    toggleRightPanel('model');
    toggleRightPanel('model');
    expect(uiStore.getState().rightPanel).toBeNull();
  });
  it('closeRightPanel(panel) only closes that panel', () => {
    toggleRightPanel('accuracy');
    closeRightPanel('flows');
    expect(uiStore.getState().rightPanel).toBe('accuracy');
    closeRightPanel('accuracy');
    expect(uiStore.getState().rightPanel).toBeNull();
  });
});
