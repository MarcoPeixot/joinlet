import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
vi.mock('../ai/session', () => ({
  aiStore: {
    getState: () => ({
      setMode: (m: string) => calls.push(`mode:${m}`),
      setPrompt: (p: string) => calls.push(`prompt:${p}`),
      setOpen: (o: boolean) => calls.push(`open:${o}`),
      submit: async () => { calls.push('submit'); },
    }),
  },
}));

import { startFromPrompt } from './startTemplates';

describe('startFromPrompt', () => {
  beforeEach(() => { calls.length = 0; });
  it('ignores empty and whitespace-only text', () => {
    expect(startFromPrompt('')).toBe(false);
    expect(startFromPrompt('   \n ')).toBe(false);
    expect(calls).toEqual([]);
  });
  it('opens the composer in generate mode and submits the trimmed text', () => {
    expect(startFromPrompt('  api com fila  ')).toBe(true);
    expect(calls).toEqual(['mode:generate', 'prompt:api com fila', 'open:true', 'submit']);
  });
});
