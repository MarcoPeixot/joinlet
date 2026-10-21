import { BetaLimitError } from '@strukt/workspace';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { Database } from 'bun:sqlite';
import { collaborationRoomName, createCollaborationRooms, createCollaborationStore } from '@strukt/workspace/collaboration';
import { createSqliteCollaborationPersistence } from '@strukt/workspace/collaboration-sqlite';
import { WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import type { RemoteAuthOptions } from './auth';
import { openGithubWorkspace } from './githubWorkspace';
import type { createRemoteAuth } from './auth';
import type { HostedBackend } from './hosted';

const sessionToken = (header: string | undefined) => header?.split(';').map((part) => part.trim()).find((part) => part.startsWith('strukt_session='))?.slice('strukt_session='.length);

export function createRemoteCollaboration(options: RemoteAuthOptions, auth: ReturnType<typeof createRemoteAuth>, hosted?: HostedBackend) {
  const db = new Database(options.databasePath, { create: true });
  db.exec('PRAGMA journal_mode=WAL');
  const persistence = createSqliteCollaborationPersistence(db);
  const grants = new Map<string, NonNullable<ReturnType<typeof auth.browserGrant>>>();
  let rooms: ReturnType<typeof createCollaborationRooms>;
  const store = createCollaborationStore({
    persistence,
    async adapter(repo) {
      if (repo.startsWith('cloud:') && hosted) return hosted.store.adapter(repo);
      const grant = grants.get(repo);
      if (!grant) throw new Error('Sessão do repositório indisponível.');
      const github = await auth.githubForGrant(grant);
      return openGithubWorkspace({ ...github, userId: 0, fetch: options.fetch });
    },
    onError: (room, error) => void rooms.error(room, error),
    onProjected: (room) => void rooms.projected(room),
    onGone: (room) => void rooms.gone(room),
    onRepair: (room, repairs) => console.warn(`Colaboração: diagrama reparado no documento compartilhado (${room}): ${repairs.map((repair) => `${repair.kind} ${JSON.stringify(repair.id.slice(0, 80))}`).join(', ')}.`),
    delayMs: 2500,
  });
  rooms = createCollaborationRooms(store);
  hosted?.onChanged((workspace,path) => {
    const diagram=/^diagrams\/([A-Za-z0-9_-]+)\.(?:strukt|layout)\.json$/.exec(path);
    const doc=/^docs\/([A-Za-z0-9_-]+)\.md$/.exec(path);
    const item=diagram?`diagram:${diagram[1]}`:doc?`doc:${doc[1]}`:null;
    if(item)store.project(collaborationRoomName(workspace,item));
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });
  const accessChecks=new Map<import('ws').WebSocket,()=>boolean>();
  hosted?.onAccessChanged(()=>{for(const [socket,valid]of accessChecks)if(!valid())socket.close(4401);});
  let shuttingDown = false;
  const allowedOrigin = new URL(options.publicUrl).origin;

  function reject(socket: Duplex, status: number): void {
    socket.end(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Forbidden'}\r\nConnection: close\r\n\r\n`);
  }

  async function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    try {
      if (shuttingDown) return reject(socket, 503);
      const url = new URL(request.url ?? '', options.publicUrl);
      if (url.pathname !== '/api/collaboration') return reject(socket, 403);
      if (options.siteUrl && request.headers.host?.toLowerCase() !== new URL(options.publicUrl).host) return reject(socket, 403);
      if (request.headers.origin !== allowedOrigin) return reject(socket, 403);
      const cloud = hosted?.context(request.headers.cookie);
      const token = sessionToken(request.headers.cookie);
      const grant = token ? auth.browserGrant(token) : null;
      if ((!cloud && !grant) || url.searchParams.get('repo') !== (cloud?.workspace ?? grant?.repo)) return reject(socket, 401);
      const github = cloud ? null : await auth.githubForGrant(grant!);
      const scope = cloud?.workspace ?? grant!.repo;
      const member = cloud?.member ?? String(github!.userId);
      const valid = () => cloud ? cloud.valid() : !!auth.browserGrant(token!);
      const presence = auth.beta.presence(scope);
      if(cloud)hosted!.store.touch(cloud);else presence.touch(member);
      const room = collaborationRoomName(scope, `${url.searchParams.get('kind')}:${url.searchParams.get('slug')}`);
      if (grant && !cloud) grants.set(scope, grant);
      sockets.handleUpgrade(request, socket, head, (websocket) => {
        accessChecks.set(websocket,valid);
        const heartbeat = setInterval(() => {
          try { if (!valid()) { websocket.close(4401); return; } if(cloud)hosted!.store.touch(cloud);else presence.touch(member); }
          catch { websocket.close(4429, 'Beta participant limit reached.'); }
        }, 15_000);
        heartbeat.unref();
        const peer = {
          id: randomUUID(),
          readOnly: cloud ? cloud.role !== 'edit' : false,
          send: (packet: Uint8Array) => { if (websocket.bufferedAmount > 2_000_000) websocket.close(1013); else websocket.send(packet); },
          close: (code: number) => websocket.close(code),
        };
        void rooms.join(room, peer).then(() => {
          websocket.on('message', (data: RawData, isBinary: boolean) => {
            if (!valid()) return websocket.close(4401);
            if (!isBinary) return websocket.close(1003);
            rooms.receive(room, peer, new Uint8Array(data as Buffer)).catch(() => websocket.close(1011));
          });
        }).catch(() => websocket.close(1011));
        websocket.on('close', () => { clearInterval(heartbeat); accessChecks.delete(websocket); rooms.leave(room, peer).catch(() => {}); });
      });
    } catch (error) { reject(socket, error instanceof BetaLimitError ? 429 : 403); }
  }

  return { upgrade, async shutdown() {
    shuttingDown = true;
    try { await rooms.shutdown(); }
    finally {
      for (const socket of sockets.clients) socket.terminate();
      sockets.close();
      grants.clear();
      db.close();
    }
  } };
}
