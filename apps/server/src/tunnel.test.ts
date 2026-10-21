import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { findTunnelUrl, startCloudflaredTunnel } from './tunnel';
import type { TunnelProcess } from './tunnel';
import { UserError } from './userError';

class FakeProcess extends EventEmitter implements TunnelProcess {
  stderr = new EventEmitter();
  stdout = new EventEmitter();
  killed: string[] = [];
  kill(signal?: string) { this.killed.push(signal ?? 'SIGTERM'); queueMicrotask(() => this.emit('exit', null, signal ?? 'SIGTERM')); return true; }
  say(text: string) { this.stderr.emit('data', Buffer.from(text)); }
}

const BANNER = [
  '2026-10-03T12:00:00Z INF Thank you for trying Cloudflare Tunnel.',
  '2026-10-03T12:00:01Z INF Requesting new quick Tunnel on trycloudflare.com...',
  '2026-10-03T12:00:02Z INF +--------------------------------------------------------------------------------------------+',
  '2026-10-03T12:00:02Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |',
  '2026-10-03T12:00:02Z INF |  https://random-words-here.trycloudflare.com                                               |',
  '2026-10-03T12:00:02Z INF +--------------------------------------------------------------------------------------------+',
  '2026-10-03T12:00:03Z INF Registered tunnel connection connIndex=0 protocol=quic',
].join('\n');

describe('findTunnelUrl', () => {
  it('reads the quick tunnel address out of cloudflared\'s log', () => {
    expect(findTunnelUrl(BANNER)).toBe('https://random-words-here.trycloudflare.com');
  });
  it('never takes the API host or a look-alike', () => {
    expect(findTunnelUrl('Post "https://api.trycloudflare.com/tunnel": EOF')).toBeNull();
    expect(findTunnelUrl('https://evil.com/?u=https://x.trycloudflare.com.evil.com')).toBeNull();
    expect(findTunnelUrl('http://x.trycloudflare.com')).toBeNull();
    expect(findTunnelUrl('https://x.trycloudflare.com.evil.com/')).toBeNull();
    expect(findTunnelUrl('https://user@x.trycloudflare.com')).toBeNull();
    expect(findTunnelUrl('https://xtrycloudflare.com')).toBeNull();
    expect(findTunnelUrl('nada')).toBeNull();
  });
  it('accepts a path after the host and returns only the origin', () => {
    expect(findTunnelUrl('see https://a-b-1.trycloudflare.com/foo?x=1 now')).toBe('https://a-b-1.trycloudflare.com');
  });
});

describe('cloudflared tunnel', () => {
  it('runs cloudflared against the loopback port and resolves with the public URL, even split across chunks', async () => {
    const child = new FakeProcess();
    const spawnFn = vi.fn(() => child);
    const pending = startCloudflaredTunnel({ port: 8790, spawnFn });
    expect(spawnFn).toHaveBeenCalledWith('cloudflared', ['tunnel', '--url', 'http://127.0.0.1:8790', '--no-autoupdate']);
    child.say(BANNER.slice(0, 200));
    child.say(BANNER.slice(200));
    const tunnel = await pending;
    expect(tunnel.url).toBe('https://random-words-here.trycloudflare.com');
  });

  it('does not expose a URL until the tunnel connection is registered', async () => {
    const child = new FakeProcess();
    let ready = false;
    const pending = startCloudflaredTunnel({ port: 8790, spawnFn: () => child }).then(result => { ready = true; return result; });
    child.say('https://ready-test.trycloudflare.com\n');
    await Promise.resolve();
    expect(ready).toBe(false);
    child.say('INF Registered tunnel connection connIndex=0');
    expect((await pending).url).toBe('https://ready-test.trycloudflare.com');
  });

  it('stop kills the process and resolves once it exits; the exit it caused is not reported as a crash', async () => {
    const child = new FakeProcess();
    const onExit = vi.fn();
    const pending = startCloudflaredTunnel({ port: 1, spawnFn: () => child, onExit });
    child.say(BANNER);
    const tunnel = await pending;
    await tunnel.stop();
    expect(child.killed).toEqual(['SIGTERM']);
    await tunnel.stop(); // twice is fine
    expect(onExit).not.toHaveBeenCalled();
  });

  it('reports an exit nobody asked for', async () => {
    const child = new FakeProcess();
    const onExit = vi.fn();
    const pending = startCloudflaredTunnel({ port: 1, spawnFn: () => child, onExit });
    child.say(BANNER);
    await pending;
    child.emit('exit', 1, null);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('explains how to install cloudflared when the binary is missing', async () => {
    const child = new FakeProcess();
    const pending = startCloudflaredTunnel({ port: 1, spawnFn: () => child });
    child.emit('error', Object.assign(new Error('spawn cloudflared ENOENT'), { code: 'ENOENT' }));
    await expect(pending).rejects.toThrow(UserError);
    await expect(pending).rejects.toThrow('brew install cloudflared');
  });

  it('fails with a clear message when cloudflared exits before printing a URL, and when it takes too long', async () => {
    const quick = new FakeProcess();
    const early = startCloudflaredTunnel({ port: 1, spawnFn: () => quick });
    quick.emit('exit', 1, null);
    await expect(early).rejects.toThrow('encerrou');
    vi.useFakeTimers();
    try {
      const slow = new FakeProcess();
      const waiting = startCloudflaredTunnel({ port: 1, spawnFn: () => slow, timeoutMs: 5_000 });
      const assertion = expect(waiting).rejects.toThrow('demorou');
      await vi.advanceTimersByTimeAsync(5_001);
      await assertion;
      expect(slow.killed).toEqual(['SIGTERM']);
    } finally { vi.useRealTimers(); }
  });

  it('never leaks the raw log in its failures', async () => {
    const child = new FakeProcess();
    const pending = startCloudflaredTunnel({ port: 1, spawnFn: () => child });
    child.say('ERR secret path /Users/dono/.cloudflared/cert.pem');
    child.emit('exit', 1, null);
    await expect(pending).rejects.not.toThrow('/Users/dono');
  });

  it('keeps reading a log that never ends without growing without bound', async () => {
    const child = new FakeProcess();
    const pending = startCloudflaredTunnel({ port: 1, spawnFn: () => child });
    for (let i = 0; i < 200; i++) child.say('x'.repeat(10_000));
    child.say(`\n${BANNER}`);
    await expect(pending).resolves.toMatchObject({ url: 'https://random-words-here.trycloudflare.com' });
  });
});
