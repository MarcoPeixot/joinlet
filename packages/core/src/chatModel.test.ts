import { expect, it } from 'vitest';
import { readChatModel } from './chatModel';
it('accepts request-scoped model selection and strips unrelated fields', () => {
  expect(readChatModel({ provider: 'opencodego', model: 'qwen3.8-flash', apiKey: 'never-forward' })).toEqual({ provider: 'opencodego', model: 'qwen3.8-flash' });
  for (const raw of [null, {}, { provider: 'unknown', model: 'model' }, { provider: 'openrouter', model: '' }, { provider: 'openrouter', model: 'has space' }, { provider: 'anthropic', model: 'x'.repeat(201) }]) expect(readChatModel(raw)).toBeNull();
});
