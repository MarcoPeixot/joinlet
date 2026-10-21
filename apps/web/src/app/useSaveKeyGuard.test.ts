import { describe, expect, it } from 'vitest';
import { isStraySaveKey } from './useSaveKeyGuard';

const press = (key: string, mods: { meta?: boolean; ctrl?: boolean } = {}) => ({ key, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl });

describe('isStraySaveKey', () => {
  it('catches ⌘S/Ctrl+S in the doc, sketch and Overview views, where nothing else handles it', () => {
    for (const view of ['doc', 'sketch', 'board'] as const) {
      expect(isStraySaveKey(press('s', { meta: true }), view)).toBe(true);
      expect(isStraySaveKey(press('S', { ctrl: true }), view)).toBe(true);
    }
  });

  it('leaves the diagram view (its shortcuts open "Salvar versão") and every other key alone', () => {
    expect(isStraySaveKey(press('s', { meta: true }), 'diagram')).toBe(false);
    expect(isStraySaveKey(press('s'), 'doc')).toBe(false);
    expect(isStraySaveKey(press('d', { meta: true }), 'doc')).toBe(false);
  });
});
