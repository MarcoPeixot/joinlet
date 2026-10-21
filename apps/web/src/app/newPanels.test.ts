import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEEN_KEY, markMenuSeen, markPanelSeen, readSeen, seenStore, showNewDot, unseenPanels } from './newPanels';
import { closeRightPanel, toggleRightPanel } from '../ui/uiStore';

function stubStorage(): Map<string, string> {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
  return data;
}

beforeEach(() => {
  seenStore.setState({ panels: [], menu: false });
  closeRightPanel();
});
afterEach(() => vi.unstubAllGlobals());

describe('what is new in Painéis', () => {
  it('starts with Comentários, Perspectivas and Linha do tempo unseen, and the dot on', () => {
    const seen = seenStore.getState();
    expect(unseenPanels(seen)).toEqual(['comments', 'perspectives', 'timeline']);
    expect(showNewDot(seen)).toBe(true);
  });

  it('opening the menu clears the dot but not the per-panel marks', () => {
    stubStorage();
    markMenuSeen();
    expect(showNewDot(seenStore.getState())).toBe(false);
    expect(unseenPanels(seenStore.getState())).toHaveLength(3);
  });

  it('opening a panel, from anywhere, marks it seen and remembers it', () => {
    const data = stubStorage();
    toggleRightPanel('perspectives');
    expect(unseenPanels(seenStore.getState())).toEqual(['comments', 'timeline']);
    expect(JSON.parse(data.get(SEEN_KEY)!)).toEqual({ panels: ['perspectives'], menu: false });
    toggleRightPanel('versions');
    expect(unseenPanels(seenStore.getState())).toEqual(['comments', 'timeline']);
  });

  it('has no dot once every new panel was opened, whatever the menu did', () => {
    stubStorage();
    for (const panel of ['comments', 'perspectives', 'timeline'] as const) markPanelSeen(panel);
    expect(showNewDot(seenStore.getState())).toBe(false);
  });

  it('reads what was saved and ignores junk', () => {
    const data = stubStorage();
    data.set(SEEN_KEY, '{"panels":["timeline","__proto__","flows",3],"menu":true}');
    expect(readSeen()).toEqual({ panels: ['timeline'], menu: true });
    data.set(SEEN_KEY, 'nope');
    expect(readSeen()).toEqual({ panels: [], menu: false });
  });

  it('survives blocked storage', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom });
    expect(readSeen()).toEqual({ panels: [], menu: false });
    expect(() => markPanelSeen('comments')).not.toThrow();
  });
});
