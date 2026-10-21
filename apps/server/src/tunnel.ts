import { spawn } from 'node:child_process';
import { UserError } from './userError';

/** The slice of a child process the tunnel uses (a fake in tests). */
export interface TunnelProcess {
  stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  stdout?: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  on(event: 'error', listener: (error: Error & { code?: string }) => void): unknown;
  on(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown;
  kill(signal?: string): unknown;
}
export type TunnelSpawn = (command: string, args: string[]) => TunnelProcess;

export interface TunnelHandle {
  /** `https://<words>.trycloudflare.com`, no path. */
  url: string;
  stop(): Promise<void>;
}

export interface TunnelOptions {
  /** The collaboration host's port on this machine. */
  port: number;
  /** Called when the process ends without `stop` having been asked. */
  onExit?(): void;
  spawnFn?: TunnelSpawn;
  timeoutMs?: number;
}

export type TunnelStarter = (options: { port: number; onExit?(): void }) => Promise<TunnelHandle>;

const INSTALL_HINT = 'O cloudflared não está instalado. Instale-o (macOS: brew install cloudflared; outros sistemas: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) e tente de novo.';
/** A quick tunnel's host: one lowercase label under trycloudflare.com, never `api` (cloudflared's own endpoint). */
const URL_PATTERN = /(?<![A-Za-z0-9@./:-])https:\/\/([a-z0-9][a-z0-9-]*)\.trycloudflare\.com(?![A-Za-z0-9@:.-])/g;
const MAX_BUFFER = 64 * 1024;

/** The quick tunnel's origin in a piece of cloudflared's log, or null. */
export function findTunnelUrl(log: string): string | null {
  for (const match of log.matchAll(URL_PATTERN)) {
    if (match[1] === 'api') continue;
    return `https://${match[1]}.trycloudflare.com`;
  }
  return null;
}

/**
 * `cloudflared tunnel --url http://127.0.0.1:<port>`: a Cloudflare quick tunnel to the collaboration host only (never
 * the owner's server). Resolves only after cloudflared prints a public URL and registers a live connection; the raw log never reaches the person.
 */
export function startCloudflaredTunnel({ port, onExit, spawnFn = (command, args) => spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }) as unknown as TunnelProcess, timeoutMs = 30_000 }: TunnelOptions): Promise<TunnelHandle> {
  return new Promise<TunnelHandle>((resolve, reject) => {
    const child = spawnFn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate']);
    let settled = false;
    let stopping = false;
    let exited = false;
    const exitWaiters: Array<() => void> = [];
    let buffer = '';
    let publicUrl: string | null = null;
    let connected = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new UserError('O cloudflared demorou demais para abrir o túnel. Verifique sua conexão e tente de novo.'));
    }, timeoutMs);

    const onData = (chunk: Buffer | string) => {
      if (settled) return;
      buffer = (buffer + String(chunk)).slice(-MAX_BUFFER);
      publicUrl ??= findTunnelUrl(buffer);
      connected ||= buffer.includes('Registered tunnel connection');
      if (!publicUrl || !connected) return;
      const url = publicUrl;
      settled = true;
      clearTimeout(timer);
      buffer = '';
      resolve({
        url,
        stop: () => {
          stopping = true;
          if (exited) return Promise.resolve();
          return new Promise<void>((done) => {
            exitWaiters.push(done);
            child.kill('SIGTERM');
          });
        },
      });
    };
    child.stderr?.on('data', onData);
    child.stdout?.on('data', onData);

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new UserError(error.code === 'ENOENT' ? INSTALL_HINT : 'Não foi possível executar o cloudflared.'));
    });
    child.on('exit', () => {
      exited = true;
      for (const done of exitWaiters.splice(0)) done();
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new UserError('O cloudflared encerrou antes de abrir o túnel. Rode "cloudflared tunnel --url http://127.0.0.1:8790" no terminal para ver o motivo.'));
      } else if (!stopping) onExit?.();
    });
  });
}
