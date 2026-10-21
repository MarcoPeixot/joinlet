import { expect, it } from 'vitest';
import { chatEventStream } from './chatStream';

it('aborts a blocked provider read when the browser cancels and closes the generator', async () => {
  const abort = new AbortController();
  let closed = false;
  let reading!: () => void;
  const started = new Promise<void>(resolve => { reading = resolve; });
  async function* source() {
    try {
      yield { t: 'first' };
      await new Promise<void>((_resolve, reject) => {
        abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true });
        reading();
      });
    } finally { closed = true; }
  }
  const events = source();
  const reader = chatEventStream(events, await events.next(), abort, () => ({ error: 'failed' })).getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('first');
  await started;
  await reader.cancel();
  expect(abort.signal.aborted).toBe(true);
  expect(closed).toBe(true);
});

it('does not consume the full provider response before the browser reads it', async () => {
  let consumed = 0;
  async function* source() {
    for (let i = 0; i < 100; i++) { consumed++; yield { t: String(i) }; }
  }
  const events = source();
  const body = chatEventStream(events, await events.next(), new AbortController(), () => ({ error: 'failed' }));
  await Promise.resolve();
  expect(consumed).toBe(1);
  await body.cancel();
});
