export const CHECKLIST_KEY = 'strukt:checklist';

export const CHECKLIST_ITEMS = ['node', 'ai', 'version', 'publish'] as const;
export type ChecklistItem = (typeof CHECKLIST_ITEMS)[number];

export interface ChecklistState {
  done: Partial<Record<ChecklistItem, true>>;
  collapsed: boolean;
  hidden: boolean;
}

export const EMPTY_CHECKLIST: ChecklistState = { done: {}, collapsed: false, hidden: false };

export function readChecklist(): ChecklistState {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(CHECKLIST_KEY) ?? 'null') as Partial<ChecklistState> | null;
    if (!raw || typeof raw !== 'object') return EMPTY_CHECKLIST;
    const done: ChecklistState['done'] = {};
    for (const item of CHECKLIST_ITEMS) if (raw.done && Object.hasOwn(raw.done, item) && raw.done[item] === true) done[item] = true;
    return { done, collapsed: raw.collapsed === true, hidden: raw.hidden === true };
  } catch {
    return EMPTY_CHECKLIST;
  }
}

export function writeChecklist(state: ChecklistState): void {
  try {
    globalThis.localStorage?.setItem(CHECKLIST_KEY, JSON.stringify(state));
  } catch {
    // progress lasts for the session only
  }
}

/** Items done either by hand or because the workspace already proves it. */
export function checklistProgress(state: ChecklistState, derived: Partial<Record<ChecklistItem, boolean>>): { done: ChecklistItem[]; total: number } {
  return { done: CHECKLIST_ITEMS.filter((item) => state.done[item] === true || derived[item] === true), total: CHECKLIST_ITEMS.length };
}
