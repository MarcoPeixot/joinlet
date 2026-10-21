/** NDJSON transport shared by read-only and editable chat, with backpressure and upstream cancellation. */
export function chatEventStream<T>(
  events: AsyncGenerator<T, void, unknown>,
  first: IteratorResult<T, void>,
  abort: AbortController,
  failure: (error: unknown) => { error: string },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const line = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`);
  let buffered: IteratorResult<T, void> | undefined = first;
  let cancelled = false;
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = buffered ?? await events.next();
        buffered = undefined;
        if (cancelled) return;
        if (next.done) {
          controller.enqueue(line({ done: true }));
          controller.close();
        } else controller.enqueue(line(next.value));
      } catch (error) {
        if (!cancelled) {
          controller.enqueue(line({ error: failure(error).error }));
          controller.close();
        }
        await events.return(undefined).catch(() => {});
      }
    },
    async cancel() {
      cancelled = true;
      // return() alone queues behind an in-flight next(); abort unblocks the provider fetch.
      abort.abort();
      await events.return(undefined).catch(() => {});
    },
  });
}
