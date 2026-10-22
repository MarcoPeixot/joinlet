import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSaver } from './saver';
import { createMemoryAdapter } from './storage';
import type { StorageAdapter } from './storage';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createSaver', () => {
  it('debounces writes and evaluates lazy content only when writing', async () => {
    const adapter = createMemoryAdapter();
    const saver = createSaver(adapter, { delay: 400 });
    let calls = 0;
    const content = () => (calls++, `v${calls}`);
    saver.schedule('docs/a.md', content);
    await vi.advanceTimersByTimeAsync(300);
    saver.schedule('docs/a.md', content);
    expect(saver.status).toBe('pending');
    await vi.advanceTimersByTimeAsync(300);
    expect(adapter.files.size).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(1);
    expect(adapter.files.get('docs/a.md')).toBe('v1');
    expect(saver.status).toBe('saved');
  });

  it('cancel drops everything queued and never writes it', async () => {
    const adapter = createMemoryAdapter();
    const saver = createSaver(adapter, { delay: 400 });
    saver.schedule('docs/a.md', '# A');
    expect(saver.hasPending()).toBe(true);
    saver.cancel();
    expect(saver.hasPending()).toBe(false);
    expect(saver.status).toBe('saved');
    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.files.size).toBe(0);
    // The saver keeps working after a cancel: the next edit is written as usual.
    saver.schedule('docs/a.md', '# B');
    await vi.advanceTimersByTimeAsync(400);
    expect(adapter.files.get('docs/a.md')).toBe('# B');
  });

  it('writes item files, then the manifest, then removals', async () => {
    const adapter = createMemoryAdapter({ 'docs/velho.md': 'x' });
    const order: string[] = [];
    const saver = createSaver({
      ...adapter,
      write: async (path, text) => void (order.push(`w:${path}`), adapter.files.set(path, text)),
      remove: async (path) => void (order.push(`r:${path}`), adapter.files.delete(path)),
    });
    saver.schedule('docs/velho.md', null);
    saver.schedule('strukt.json', '{}');
    saver.schedule('docs/novo.md', '# Novo');
    await saver.flush();
    expect(order).toEqual(['w:docs/novo.md', 'w:strukt.json', 'r:docs/velho.md']);
  });

  it('skips text that is already on disk', async () => {
    const adapter = createMemoryAdapter();
    const write = vi.spyOn(adapter, 'write');
    const saver = createSaver(adapter);
    saver.seed({ 'diagrams/a.strukt': 'A > B\n' });
    saver.schedule('diagrams/a.strukt', 'A > B\n');
    await saver.flush();
    expect(write).not.toHaveBeenCalled();
    saver.schedule('diagrams/a.strukt', 'A > C\n');
    await saver.flush();
    expect(write).toHaveBeenCalledOnce();
  });

  it('forget() drops what it knew was on disk: unchanged text is written again', async () => {
    const adapter = createMemoryAdapter();
    const write = vi.spyOn(adapter, 'write');
    const saver = createSaver(adapter);
    saver.seed({ a: 'x' });
    saver.forget();
    saver.schedule('a', 'x');
    await saver.flush();
    expect(write).toHaveBeenCalledWith('a', 'x');
  });

  it('retries failed writes, then reports "error" until retry() succeeds', async () => {
    const adapter = createMemoryAdapter();
    let broken = true;
    const write = adapter.write;
    const saver = createSaver({ ...adapter, write: (path, text) => (broken ? Promise.reject(new Error('disco cheio')) : write(path, text)) }, {
      delay: 10,
      retries: 2,
      retryDelay: 100,
    });
    const seen: string[] = [];
    saver.subscribe(() => seen.push(saver.status));
    saver.schedule('docs/a.md', 'a');
    await vi.advanceTimersByTimeAsync(10);
    expect(saver.status).toBe('pending');
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    expect(saver.status).toBe('error');
    expect(saver.error).toBe('Não foi possível salvar docs/a.md: disco cheio');
    expect(saver.hasPending()).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(saver.status).toBe('error');
    broken = false;
    await saver.retry();
    expect(saver.status).toBe('saved');
    expect(adapter.files.get('docs/a.md')).toBe('a');
    expect(seen).toEqual(['pending', 'saving', 'pending', 'saving', 'pending', 'saving', 'error', 'saving', 'saved']);
  });

  describe('order inside a flush with lazy content (items → manifest → removals)', () => {
    /** Logs every write/remove that reached the disk; `failOnce` makes the first write of that path throw. */
    function recording(failOnce?: string) {
      const memory = createMemoryAdapter({ 'diagrams/x.strukt': 'x' });
      const log: string[] = [];
      let fail = failOnce;
      const adapter: StorageAdapter = {
        ...memory,
        write: async (path, text) => {
          if (path === fail) {
            fail = undefined;
            throw new Error('falhou');
          }
          log.push(`write ${path}`);
          memory.files.set(path, text);
        },
        remove: async (path) => {
          log.push(`remove ${path}`);
          memory.files.delete(path);
        },
      };
      return { adapter, log, files: memory.files };
    }

    it('(a) ranks a lazy removal after the manifest write', async () => {
      const { adapter, log } = recording();
      const saver = createSaver(adapter);
      saver.schedule('diagrams/x.strukt', () => null);
      saver.schedule('strukt.json', () => 'm');
      await saver.flush();
      expect(log).toEqual(['write strukt.json', 'remove diagrams/x.strukt']);
    });

    it('(b) does not write the manifest while an item write failed; the retry writes both, item first', async () => {
      const { adapter, log, files } = recording('docs/a.md');
      const saver = createSaver(adapter, { delay: 10, retryDelay: 100 });
      saver.schedule('docs/a.md', () => 'a');
      saver.schedule('strukt.json', () => 'm');
      await saver.flush();
      expect(log).toEqual([]);
      expect(files.has('strukt.json')).toBe(false);
      await vi.advanceTimersByTimeAsync(100);
      expect(log).toEqual(['write docs/a.md', 'write strukt.json']);
      expect(saver.status).toBe('saved');
    });

    it('treats lazy content that throws as a failure of that path', async () => {
      const { adapter, log } = recording();
      const saver = createSaver(adapter, { retries: 0 });
      saver.schedule('docs/a.md', () => {
        throw new Error('sem dados');
      });
      saver.schedule('strukt.json', () => 'm');
      await saver.flush();
      expect(log).toEqual([]);
      expect(saver.status).toBe('error');
      expect(saver.error).toBe('Não foi possível salvar docs/a.md: sem dados');
      expect(saver.hasPending()).toBe(true);
    });

    it('(c) after dispose(), a pending timer never writes and schedule() is a no-op', async () => {
      const { adapter, log } = recording();
      const saver = createSaver(adapter, { delay: 50 });
      saver.schedule('docs/a.md', 'a');
      saver.dispose();
      await vi.advanceTimersByTimeAsync(1000);
      saver.schedule('docs/b.md', 'b');
      await vi.advanceTimersByTimeAsync(1000);
      await saver.flush();
      expect(log).toEqual([]);
    });
  });

  it('keeps a newer edit queued when an older write of the same file fails', async () => {
    const adapter = createMemoryAdapter();
    let fail = true;
    const saver = createSaver({
      ...adapter,
      write: async (path, text) => {
        if (fail) {
          fail = false;
          saver.schedule(path, 'novo');
          throw new Error('falhou');
        }
        adapter.files.set(path, text);
      },
    }, { delay: 10, retryDelay: 10 });
    saver.schedule('docs/a.md', 'velho');
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(20);
    expect(adapter.files.get('docs/a.md')).toBe('novo');
    expect(saver.status).toBe('saved');
  });
});

it('reports completed writes and terminal failures, never cancellation, seed or unchanged content', async () => {
  const adapter=createMemoryAdapter();const settled=vi.fn();
  const saver=createSaver(adapter,{onSettled:settled,retries:0});
  saver.seed({a:'original'});saver.schedule('a','original');await saver.flush();expect(settled).not.toHaveBeenCalled();
  saver.schedule('a','cancelled');saver.cancel();await saver.flush();expect(settled).not.toHaveBeenCalled();
  saver.schedule('a','changed');await saver.flush();expect(settled).toHaveBeenLastCalledWith('saved');
  const fail=createSaver({...adapter,write:async()=>{throw Error('fixture failure');}},{onSettled:settled,retries:0});
  fail.schedule('a','new');await fail.flush();expect(settled).toHaveBeenLastCalledWith('error');expect(settled).toHaveBeenCalledTimes(2);
});

it('keeps persistence usable when a completion observer fails',async()=>{
  const adapter=createMemoryAdapter();const saver=createSaver(adapter,{onSettled:()=>{throw Error('observer failure');}});
  saver.schedule('a','first');await saver.flush();saver.schedule('a','second');await saver.flush();
  expect(adapter.files.get('a')).toBe('second');expect(saver.status).toBe('saved');
});
