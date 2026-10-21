import { createServer } from 'node:net';
import { noAudit } from './audit';
import type { AuditEntry, AuditLog, AuditReason } from './audit';
import type { InviteView } from './invites';
import { startCloudflaredTunnel } from './tunnel';
import type { TunnelStarter } from './tunnel';
import { UserError } from './userError';

export interface SharePerson { name: string; color: string }
export type TunnelStatus = { active: false } | { active: true; provider: 'cloudflared'; url: string; expiresAt: number };
export type ShareStatus = { active: false } | { active: true; root: string; people: SharePerson[]; invites: InviteView[]; tunnel: TunnelStatus; startedAt: number };

/** What the share needs from a running collaboration host (`startCollaborationHost` returns it). */
export interface ShareHost {
  invites: {
    list(): InviteView[];
    create(input: { name: unknown; role: unknown; ttl: unknown }): InviteView;
    revoke(id: string): boolean;
  };
  /** The tunnel's `https://` origin while public access is on (links, cookies and sockets accept it), else null. */
  setPublicOrigin(origin: string | null): void;
  people(): Promise<SharePerson[]>;
  setOwnerInvite?(id: string): void;
  stop(): Promise<void>;
}

export interface ShareDeps {
  start(options: { root: string; port: number; audit: AuditLog }): Promise<ShareHost>;
  /** The owner's audit log of a workspace (the same instance the host writes to). */
  audit?(root: string): AuditLog;
  tunnel?: TunnelStarter;
  freePort?(): Promise<number>;
  now?(): number;
  /** Runs `run` after `ms`; returns how to cancel it (tests drive it by hand). */
  schedule?(run: () => void, ms: number): () => void;
}

export const TUNNEL_TTLS = { '30m': 30 * 60_000, '2h': 2 * 3_600_000, '24h': 24 * 3_600_000 } as const;
export type TunnelTtl = keyof typeof TUNNEL_TTLS;

const FIRST_PORT = 8790;
const LAST_PORT = 8799;

/** The first free port from 8790 on (the port the standalone LAN host uses), so two hosts never collide. */
async function firstFreePort(): Promise<number> {
  for (let port = FIRST_PORT; port <= LAST_PORT; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = createServer();
      probe.once('error', () => resolve(false));
      probe.listen(port, '0.0.0.0', () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('Não há porta livre para o compartilhamento (8790–8799).');
}

const defaultSchedule = (run: () => void, ms: number) => {
  const timer = setTimeout(run, ms);
  timer.unref();
  return () => clearTimeout(timer);
};

/** Messages the host itself words in pt-BR for the person; anything else (paths, stack) stays in the server's log. */
const SAFE = /^(A pasta não tem um workspace|Frontend não compilado|Não há porta livre)/;

/** What a person may be told: a `UserError`'s own words, else `fallback` (the real cause goes to the log). */
function told(error: unknown, fallback: string, context: string): Error {
  if (error instanceof UserError) return error;
  console.warn(`Compartilhamento: ${context}: ${error instanceof Error ? error.message : String(error)}`);
  return new Error(fallback);
}

/**
 * The one shared session of this machine: starts a LAN collaboration host for a workspace folder on request and
 * stops it on request (or when the server exits). It manages the named invites of that host and, only when asked
 * and acknowledged, a public tunnel to the host (never to this server) that falls on its own. Everything it returns
 * carries invite links with their tokens: it is handed only to the loopback caller.
 */
export function createShare({ start, audit: auditFor = () => noAudit, tunnel: openTunnel = startCloudflaredTunnel, freePort = firstFreePort, now = Date.now, schedule = defaultSchedule }: ShareDeps) {
  let current: { host: ShareHost; root: string; port: number; startedAt: number; audit: AuditLog; owner?: InviteView } | null = null;
  let tunnel: { url: string; expiresAt: number; stop(): Promise<void>; cancel(): void } | null = null;
  let tunnelOpening = false;
  const audits = new Map<string, AuditLog>();
  const auditOf = (root: string) => {
    let log = audits.get(root);
    if (!log) { log = auditFor(root); audits.set(root, log); }
    return log;
  };

  const status = async (): Promise<ShareStatus> => {
    if (!current) return { active: false };
    const people = await current.host.people().catch(() => []);
    return {
      active: true, root: current.root, people, invites: current.host.invites.list().filter(invite => invite.id !== current?.owner?.id), startedAt: current.startedAt,
      tunnel: tunnel ? { active: true, provider: 'cloudflared', url: tunnel.url, expiresAt: tunnel.expiresAt } : { active: false },
    };
  };

  const running = () => {
    if (!current) throw new UserError('Ative o compartilhamento antes de continuar.');
    return current;
  };

  /** Takes the tunnel down (once) and tells the host and the audit why. */
  const closeTunnel = async (reason: AuditReason, stop = true) => {
    const closing = tunnel;
    if (!closing) return;
    tunnel = null;
    closing.cancel();
    current?.host.setPublicOrigin(null);
    current?.audit.record({ type: 'tunnel.stop', provider: 'cloudflared', reason });
    if (stop) await closing.stop().catch((error: unknown) => console.warn(`Compartilhamento: falha ao encerrar o túnel: ${error instanceof Error ? error.message : String(error)}`));
  };

  return {
    status,
    /** Only the loopback owner's guarded routes may use this credential. Never sent in guest links. */
    ownerTarget(path: string) {
      const share = running();
      if (!/^\/api\/(remote\/(session|init|workspace|revision|pr|plan)|collaboration)(\?|$)/.test(path)) throw new UserError('Endpoint indisponível.');
      share.owner ??= share.host.invites.create({ name: 'Workspace owner', role: 'edit', ttl: 'never' });
      share.host.setOwnerInvite?.(share.owner.id);
      const token = new URL(share.owner.url).searchParams.get('token')!;
      const origin = `http://127.0.0.1:${share.port}`;
      return { url: `${origin}${path}`, headers: { cookie: `strukt_collab=${token}`, origin, 'x-strukt-csrf': token } };
    },
    async start(root: string): Promise<ShareStatus> {
      if (current) {
        if (current.root === root) return status();
        throw new Error('Já existe um compartilhamento ativo de outra pasta. Pare-o antes de compartilhar esta.');
      }
      try {
        const port = await freePort();
        const audit = auditOf(root);
        current = { host: await start({ root, port, audit }), root, port, startedAt: now(), audit };
        audit.record({ type: 'share.start' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (SAFE.test(message)) throw new Error(message);
        console.warn(`Compartilhamento: falha ao iniciar o host: ${message}`);
        throw new Error('Não foi possível iniciar o compartilhamento.');
      }
      return status();
    },
    async stop(): Promise<ShareStatus> {
      const running = current;
      if (!running) return { active: false };
      await closeTunnel('share_stopped');
      current = null;
      await running.host.stop().catch((error: unknown) => console.warn(`Compartilhamento: falha ao encerrar: ${error instanceof Error ? error.message : String(error)}`));
      running.audit.record({ type: 'share.stop' });
      return { active: false };
    },
    async createInvite(input: { name: unknown; role: unknown; ttl: unknown }): Promise<ShareStatus> {
      const { host } = running();
      try { host.invites.create(input); }
      catch (error) { throw told(error, 'Não foi possível criar o convite.', 'falha ao criar convite'); }
      return status();
    },
    async revokeInvite(id: unknown): Promise<ShareStatus> {
      const { host } = running();
      if (typeof id !== 'string' || !host.invites.revoke(id)) throw new UserError('Convite não encontrado (talvez já tenha sido revogado ou expirado).');
      return status();
    },
    async startTunnel(input: { ttl?: unknown; acknowledged?: unknown }): Promise<ShareStatus> {
      const share = running();
      if (input.acknowledged !== true) throw new UserError('Confirme o aviso antes de ligar o acesso público.');
      const ttl = input.ttl === undefined ? '2h' : input.ttl;
      if (typeof ttl !== 'string' || !Object.hasOwn(TUNNEL_TTLS, ttl)) throw new UserError('Escolha a duração do acesso público: 30 minutos, 2 horas ou 24 horas.');
      if (tunnel || tunnelOpening) throw new UserError('O acesso público já está ligado.');
      const ms = TUNNEL_TTLS[ttl as TunnelTtl];
      let handle;
      tunnelOpening = true;
      try { handle = await openTunnel({ port: share.port, onExit: () => void closeTunnel('exited', false) }); }
      catch (error) { throw told(error, 'Não foi possível abrir o acesso público.', 'falha ao abrir o túnel'); }
      finally { tunnelOpening = false; }
      // The share may have stopped while cloudflared was starting: never leave a tunnel to a host that is gone.
      if (current !== share) {
        await handle.stop().catch(() => {});
        throw new UserError('O compartilhamento foi encerrado enquanto o acesso público abria.');
      }
      const expiresAt = now() + ms;
      const cancel = schedule(() => void closeTunnel('expired'), ms);
      tunnel = { url: handle.url, expiresAt, stop: handle.stop, cancel };
      share.host.setPublicOrigin(handle.url);
      share.audit.record({ type: 'tunnel.start', provider: 'cloudflared', expiresAt });
      return status();
    },
    async stopTunnel(): Promise<ShareStatus> {
      await closeTunnel('manual');
      return status();
    },
    /** The last 100 events of the workspace's audit log, newest first (also readable while nothing is shared). */
    activity: (root: string): Promise<AuditEntry[]> => auditOf(root).recent(100),
  };
}

export type Share = ReturnType<typeof createShare>;
