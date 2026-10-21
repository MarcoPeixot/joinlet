import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { RightPanel } from '../ui/uiStore';
import { uiStore } from '../ui/uiStore';

/** The panels that arrived after the first release: the Painéis trigger points at them until they have been seen. */
export const NEW_PANELS: readonly RightPanel[] = ['comments', 'perspectives', 'timeline'];

export const SEEN_KEY = 'strukt:seen-panels';

export interface Seen {
  /** New panels the visitor has opened. */
  panels: RightPanel[];
  /** The Painéis menu has been opened once: the dot on its trigger has done its job. */
  menu: boolean;
}

const EMPTY: Seen = { panels: [], menu: false };

export function readSeen(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Seen {
  try {
    const raw = JSON.parse(storage?.getItem(SEEN_KEY) ?? 'null') as Partial<Seen> | null;
    if (!raw || typeof raw !== 'object') return EMPTY;
    const panels = Array.isArray(raw.panels) ? NEW_PANELS.filter((panel) => (raw.panels as unknown[]).includes(panel)) : [];
    return { panels, menu: raw.menu === true };
  } catch {
    return EMPTY;
  }
}

/** The new panels not opened yet, in menu order. */
export const unseenPanels = (seen: Seen): RightPanel[] => NEW_PANELS.filter((panel) => !seen.panels.includes(panel));

/** The trigger's dot: something new in the menu, and the menu not opened yet. */
export const showNewDot = (seen: Seen): boolean => !seen.menu && unseenPanels(seen).length > 0;

export const seenStore = createStore<Seen>(() => readSeen());

function save(seen: Seen): void {
  try {
    globalThis.localStorage?.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // the dot comes back next visit
  }
}

export function markPanelSeen(panel: RightPanel): void {
  const seen = seenStore.getState();
  if (!NEW_PANELS.includes(panel) || seen.panels.includes(panel)) return;
  const next = { ...seen, panels: [...seen.panels, panel] };
  seenStore.setState(next);
  save(next);
}

export function markMenuSeen(): void {
  const seen = seenStore.getState();
  if (seen.menu) return;
  const next = { ...seen, menu: true };
  seenStore.setState(next);
  save(next);
}

// However a panel is opened (menu, ⌘K, a toolbar tool), it counts as seen.
uiStore.subscribe((state, prev) => {
  if (state.rightPanel && state.rightPanel !== prev.rightPanel) markPanelSeen(state.rightPanel);
});

export function useSeen(): Seen {
  return useStore(seenStore, (s) => s);
}
