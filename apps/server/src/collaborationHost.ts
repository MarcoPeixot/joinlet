import { SELF_HOSTED_PLAN, type AccessPlan, createBetaPresence } from '@strukt/workspace';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, stat } from 'node:fs/promises';
import { homedir, networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from 'bun:sqlite';
import { file as bunFile, serve } from 'bun';
import { COLLAB_CLOSE_NOT_FOUND, COLLAB_CLOSE_REVOKED, COLLAB_UPDATE, collaborationRoomName, createCollaborationRooms, createCollaborationStore } from '@strukt/workspace/collaboration';
import { createSqliteCollaborationPersistence } from '@strukt/workspace/collaboration-sqlite';
import { createFsAdapter, openWorkspaceAt } from '@strukt/workspace/fs';
import { createAuditLog } from './audit';
import type { AuditLog } from './audit';
import { COLLAB_BODY_LIMIT, createCollaborationHandler } from './collaborationHttp';
import { createFailureLimiter } from './failureLimiter';
import type { FailureLimiter } from './failureLimiter';
import { createInviteRegistry, newInviteToken } from './invites';
import type { Invite, InviteRole, InviteView } from './invites';

function lanAddress(): string {
  for (const group of Object.values(networkInterfaces())) for (const address of group ?? []) {
    if (address.family === 'IPv4' && !address.internal) return address.address;
  }
  return '127.0.0.1';
}

/** `~/.config/strukt/audit` (or under `STRUKT_CONFIG_DIR`): where each workspace's share log lives. */
export const defaultAuditDir = () => join(process.env.STRUKT_CONFIG_DIR?.trim() || join(homedir(), '.config', 'strukt'), 'audit');

/** The same guest's accepted edits in one room are audited once per this long. */
const WRITE_AUDIT_GAP_MS = 60_000;
/** How often invites that expire while nobody asks are noticed (their sockets close within this). */
const SWEEP_MS = 1_000;

/** The workspace path a room projects to, for the audit (a room name is `[root, "diagram:<slug>"]`). */
function roomPath(room: string): string | undefined {
  try {
    const [, item] = JSON.parse(room) as [string, string];
    const [kind, slug] = item.split(':');
    return kind === 'diagram' ? `diagrams/${slug}.strukt.json` : kind === 'doc' ? `docs/${slug}.md` : undefined;
  } catch { return undefined; }
}

/** A separate LAN host: guests cannot reach the owner's AI, Git, settings or MCP routes. */
export async function startCollaborationHost(options: {
  accessPlan?: AccessPlan;
  root: string; port?: number; publicUrl?: string; token?: string; viewToken?: string; databasePath?: string;
  /** Where Bun listens: every interface by default (the LAN session); tests use loopback. */
  hostname?: string;
  /** The built web app; `apps/web/dist` by default. */
  dist?: string;
  /** The owner's audit log for this workspace; by default one is opened under `defaultAuditDir()`. */
  audit?: AuditLog;
  /** The clock of invites, the attempt limit and the audit (tests move it). */
  now?(): number;
  limiter?: FailureLimiter;
}) {
  const opened = await openWorkspaceAt(options.root);
  if (!opened) throw new Error('A pasta não tem um workspace do Joinlet (.arch/strukt.json).');
  const port = options.port ?? 8790;
  const origin = new URL(options.publicUrl ?? `http://${lanAddress()}:${port}`).origin;
  const now = options.now ?? Date.now;
  const audit = options.audit ?? createAuditLog({ dir: defaultAuditDir(), root: opened.root, now });
  let publicOrigin: string | null = null;
  let ownerInviteId: string | undefined;
  const presence = createBetaPresence({ now, reserved: 1, plan: () => options.accessPlan ?? SELF_HOSTED_PLAN });
  /** Open sockets by invite: an invite that is revoked or expires takes its sockets with it. */
  const sockets = new Map<string, { invite: string; participant?: string; close(code: number, reason: string): void }>();
  const invites = createInviteRegistry({
    now,
    onEvent: ({ type, invite }) => {
      audit.record({ type: `invite.${type}`, invite: invite.name, inviteId: invite.id, role: invite.role, expiresAt: invite.expiresAt });
      if (type === 'create') return;
      for (const socket of sockets.values()) if (socket.invite === invite.id) socket.close(COLLAB_CLOSE_REVOKED, 'Convite revogado ou expirado.');
    },
  });
  const edit = invites.create({ name: 'Link para editar', role: 'edit', ttl: 'never', token: options.token ?? newInviteToken() });
  const view = invites.create({ name: 'Link só para ver', role: 'view', ttl: 'never', token: options.viewToken ?? newInviteToken() });
  const link = (base: string, invite: Invite) => `${base}/join?token=${encodeURIComponent(invite.token)}`;
  const inviteView = (invite: Invite): InviteView => ({
    id: invite.id, name: invite.name, role: invite.role, createdAt: invite.createdAt, expiresAt: invite.expiresAt,
    url: link(origin, invite), publicUrl: publicOrigin ? link(publicOrigin, invite) : null,
  });
  const sweeper = setInterval(() => {
    invites.sweep();
    for (const socket of sockets.values()) if (socket.participant && socket.participant !== 'owner') {
      try { presence.touch(socket.participant); } catch { socket.close(4429, 'Beta participant limit reached.'); }
    }
  }, SWEEP_MS);
  sweeper.unref();
  const databasePath = options.databasePath ?? join(homedir(), '.config', 'strukt', 'collaboration.sqlite');
  await mkdir(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath, { create: true });
  if (databasePath !== ':memory:') await chmod(databasePath, 0o600);
  db.exec('PRAGMA journal_mode=WAL');
  const adapter = () => createFsAdapter(opened.archDir);
  let rooms: ReturnType<typeof createCollaborationRooms>;
  const store = createCollaborationStore({
    persistence: createSqliteCollaborationPersistence(db),
    adapter: async () => adapter(),
    onError: (room, error) => void rooms.error(room, error),
    onProjected: (room) => void rooms.projected(room),
    onGone: (room) => void rooms.gone(room),
    onRepair: (room, repairs) => console.warn(`Colaboração: diagrama reparado no documento compartilhado (${room}): ${repairs.map((repair) => `${repair.kind} ${JSON.stringify(repair.id.slice(0, 80))}`).join(', ')}.`),
  });
  rooms = createCollaborationRooms(store);
  const peers = new Map<string, { id: string; send(packet: Uint8Array): void; close(code: number): void }>();
  const dist = resolve(options.dist ?? fileURLToPath(new URL('../../web/dist/', import.meta.url)));
  await Promise.all([stat(join(dist, 'index.html')), stat(join(dist, 'app/index.html'))]).catch(() => { throw new Error('Frontend não compilado. Rode bun run build antes de iniciar a colaboração.'); });
  const handler = createCollaborationHandler({
    accessPlan: options.accessPlan,
    root: opened.root,
    presence, ownerInvite: () => ownerInviteId,
    archDir: opened.archDir,
    adapter,
    invites,
    audit,
    now,
    limiter: options.limiter ?? createFailureLimiter({ now }),
    origin,
    publicOrigin: () => publicOrigin,
    port,
    dist,
    asset: async (file) => { const asset = bunFile(file); return await asset.exists() ? new Response(asset) : null; },
    newId: randomUUID,
    // A guest deleted (or rewrote) a room's file: the room re-reads it soon (a deleted item tells its peers).
    onRoomFile: (item) => store.project(collaborationRoomName(opened.root, item)),
  });

  const lastWrite = new Map<string, number>();
  const server = serve<{ room: string; id: string; refused?: string; readOnly?: boolean; invite?: string; role?: InviteRole; participant?: string }>({
    port,
    hostname: options.hostname ?? '0.0.0.0',
    // Never Bun's error page (stack, paths, cwd); the handler answers every failure with a plain JSON body.
    development: false,
    maxRequestBodySize: COLLAB_BODY_LIMIT,
    error: () => Response.json({ error: 'Erro interno.' }, { status: 500 }),
    fetch: (request, server) => handler(request, (req, data) => server.upgrade(req, { data }), { ip: server.requestIP(request)?.address }),
    websocket: {
      maxPayloadLength: 1_000_000,
      async open(socket) {
        // The invite may have ended between the upgrade and now.
        if (socket.data.invite && !invites.isLive(socket.data.invite)) return socket.close(COLLAB_CLOSE_REVOKED, 'Convite revogado ou expirado.');
        if (socket.data.invite) sockets.set(socket.data.id, { invite: socket.data.invite, participant: socket.data.participant, close: (code, reason) => socket.close(code, reason) });
        if (socket.data.refused !== undefined) return socket.close(COLLAB_CLOSE_NOT_FOUND, socket.data.refused);
        const peer = { id: socket.data.id, readOnly: socket.data.readOnly, send: (packet: Uint8Array) => { if (socket.getBufferedAmount() > 2_000_000) socket.close(1013); else socket.send(packet); }, close: (code: number) => socket.close(code) };
        peers.set(socket.data.id, peer);
        try { await rooms.join(socket.data.room, peer); }
        catch (error) {
          console.warn(`Colaboração: a sala ${socket.data.room} não abriu: ${error instanceof Error ? error.message : String(error)}`);
          socket.close(1011);
        }
      },
      message(socket, message) {
        if (socket.data.participant && socket.data.participant !== 'owner') {
          try { presence.touch(socket.data.participant); } catch { return socket.close(4429, 'Beta participant limit reached.'); }
        }
        const peer = peers.get(socket.data.id);
        if (!peer || typeof message === 'string') return socket.close(1003);
        // Revocation and expiry also apply to a socket that is already open, on every message.
        if (socket.data.invite && !invites.isLive(socket.data.invite)) return socket.close(COLLAB_CLOSE_REVOKED, 'Convite revogado ou expirado.');
        if (message.byteLength > 0 && new Uint8Array(message)[0] === COLLAB_UPDATE && !socket.data.readOnly) {
          const key = `${socket.data.invite}|${socket.data.room}`;
          const last = lastWrite.get(key);
          const path = roomPath(socket.data.room);
          const holder = invites.get(socket.data.invite!);
          if (path && holder && (last === undefined || now() - last >= WRITE_AUDIT_GAP_MS)) {
            lastWrite.delete(key);
            lastWrite.set(key, now());
            while (lastWrite.size > 1000) lastWrite.delete(lastWrite.keys().next().value as string);
            audit.record({ type: 'write', invite: holder.name, inviteId: holder.id, role: holder.role, path, op: 'write' });
          }
        }
        // Never an unhandled rejection: whatever a guest sends must not be able to stop the host.
        rooms.receive(socket.data.room, peer, new Uint8Array(message)).catch((error: unknown) => {
          console.warn(`Colaboração: falha ao tratar uma mensagem da sala ${socket.data.room}: ${error instanceof Error ? error.message : String(error)}`);
          socket.close(1011);
        });
      },
      close(socket) {
        sockets.delete(socket.data.id);
        const peer = peers.get(socket.data.id);
        if (peer) rooms.leave(socket.data.room, peer).catch((error: unknown) => console.warn(`Colaboração: falha ao sair da sala ${socket.data.room}: ${error instanceof Error ? error.message : String(error)}`));
        peers.delete(socket.data.id);
      },
    },
  });
  /** Stops accepting, closes the peers, writes every room's pending projection, then closes the database. */
  const stop = async () => {
    clearInterval(sweeper);
    server.stop(true);
    try { await rooms.shutdown(); }
    finally { db.close(); }
  };
  return {
    server, stop, audit,
    people: () => rooms.people(),
    setOwnerInvite(id: string) { ownerInviteId = id; },
    /** The two default links (`Link para editar`, `Link só para ver`), kept for the standalone host's console. */
    inviteUrl: link(origin, edit),
    viewUrl: link(origin, view),
    invites: {
      list: (): InviteView[] => invites.list().map(inviteView),
      create(input: { name: unknown; role: unknown; ttl: unknown }): InviteView { return inviteView(invites.create(input)); },
      revoke: (id: string) => invites.revoke(id),
    },
    /** The tunnel's `https://` origin while public access is on (links, cookies and sockets accept it), else null. */
    setPublicOrigin(next: string | null): void { publicOrigin = next; },
  };
}
