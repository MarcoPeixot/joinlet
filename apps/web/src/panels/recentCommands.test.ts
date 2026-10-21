import { afterEach, describe, expect, it, vi } from 'vitest';
import { pushRecent, readRecents } from './recentCommands';

function fakeStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

afterEach(() => vi.unstubAllGlobals());

describe('recent commands', () => {
  it('starts empty and keeps the last 5 ids, most recent first, without duplicates', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(readRecents()).toEqual([]);
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) pushRecent(id);
    expect(readRecents()).toEqual(['f', 'e', 'd', 'c', 'b']);
    pushRecent('d');
    expect(readRecents()).toEqual(['d', 'f', 'e', 'c', 'b']);
  });
  it('ignores garbage in storage', () => {
    const storage = fakeStorage();
    storage.setItem('strukt:recent-commands', '{"x":1}');
    vi.stubGlobal('localStorage', storage);
    expect(readRecents()).toEqual([]);
    storage.setItem('strukt:recent-commands', '[1,"ok",null]');
    expect(readRecents()).toEqual(['ok']);
    storage.setItem('strukt:recent-commands', 'not json');
    expect(readRecents()).toEqual([]);
  });
  it('is safe when storage throws', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom });
    expect(readRecents()).toEqual([]);
    expect(() => pushRecent('a')).not.toThrow();
  });
});
