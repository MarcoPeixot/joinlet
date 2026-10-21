import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHECKLIST_KEY, EMPTY_CHECKLIST, checklistProgress, readChecklist, writeChecklist } from './checklistState';

afterEach(() => vi.unstubAllGlobals());

describe('checklist', () => {
  it('round-trips through localStorage and ignores junk', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
    writeChecklist({ done: { ai: true }, collapsed: true, hidden: false });
    expect(readChecklist()).toEqual({ done: { ai: true }, collapsed: true, hidden: false });
    data.set(CHECKLIST_KEY, '{"done":{"ai":1,"__proto__":true,"node":true}}');
    expect(readChecklist().done).toEqual({ node: true });
    data.set(CHECKLIST_KEY, 'nope');
    expect(readChecklist()).toEqual(EMPTY_CHECKLIST);
  });

  it('survives blocked storage', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom });
    expect(readChecklist()).toEqual(EMPTY_CHECKLIST);
    expect(() => writeChecklist(EMPTY_CHECKLIST)).not.toThrow();
  });

  it('merges manual and derived completion', () => {
    const p = checklistProgress({ ...EMPTY_CHECKLIST, done: { publish: true } }, { node: true, version: false });
    expect(p).toEqual({ done: ['node', 'publish'], total: 4 });
  });
});
