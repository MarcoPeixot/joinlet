import { BETA_PLAN } from '@strukt/workspace';
import { uiText } from '../i18n';
import * as Y from 'yjs';
import { COLLAB_ACK, COLLAB_CLOSE_NOT_FOUND, COLLAB_CLOSE_REVOKED, COLLAB_ERROR, COLLAB_GONE, COLLAB_PRESENCE, COLLAB_PROJECTED, COLLAB_SYNC, COLLAB_UPDATE, collaborationPacket, sanitizePresence } from '@strukt/workspace/collaboration';
import type { PresenceState } from '@strukt/workspace/collaboration';
import { showToast } from '../ui/uiStore';
import { ACCESS_ENDED, accessEnded } from './accessEnded';
import { bumpCollaborationEpoch } from './collaborationView';
import { nudgeManifestSync } from './manifestSync';
import type { RemoteSession } from './remote';

/** The host refuses updates above ~1 MB; stay under it so a big paste is never sent (and never loops). */
export const MAX_UPDATE_BYTES = 900_000;
export const MAX_DISCARDS = 3;
export const DISCARD_WINDOW_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;
const STABLE_MS = 10_000;
const ITEM_GONE = uiText("Este item foi excluído.");
/** Cursors and pointers move far faster than anyone needs to see them: at most one update per this long. */
const PRESENCE_GAP_MS = 80;

/** New items reach the host only after the manifest is saved: wait for the pending autosave before joining. */
async function saveFirst(): Promise<void> {
  try { await (await import('./appWorkspace')).workspace.flush(); } catch { /* the host refuses the join if it is still missing */ }
}

export interface CollaborationOptions {
  gate?: () => Promise<void>;
  onDiscard?: (client: CollaborationClient, reason: string) => void;
}

export type CollaborationStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
export type Collaborator = { id: string; name: string; color: string; cid?: string; state?: PresenceState };
type Listener = () => void;

export class CollaborationClient {
  readonly doc = new Y.Doc();
  status: CollaborationStatus = 'connecting';
  error: string | null = null;
  peers: Collaborator[] = [];
  ready = false;
  pending = 0;
  private socket: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private attempt = 0;
  private openedAt = 0;
  private refused = 0;
  /** True once the session gave up (too many discards): no reconnect, the banner offers "Recarregar". */
  fatal = false;
  private listeners = new Set<Listener>();
  private identity = { name: uiText("Colaborador"), color: '#3972dc', cid: randomClientId() };
  private state: PresenceState | null = null;
  private stateSentAt = 0;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly session: RemoteSession, readonly item: string, private readonly options: CollaborationOptions = {}) {
    try {
      const existing = sessionStorage.getItem('strukt:collaborator');
      const saved = existing ? JSON.parse(existing) as Partial<typeof this.identity> : null;
      this.identity = {
        name: saved?.name ?? uiText("Colaborador {0}", [Math.floor(Math.random() * 90) + 10]),
        color: saved?.color ?? ['#3972dc', '#c75c8f', '#319b77', '#a572d4', '#c08235'][Math.floor(Math.random() * 5)]!,
        cid: saved?.cid ?? this.identity.cid,
      };
      sessionStorage.setItem('strukt:collaborator', JSON.stringify(this.identity));
    } catch { /* Session storage may be blocked. */ }
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.send(update);
        this.emit();
      }
    });
    void (options.gate ?? saveFirst)().then(() => this.connect());
  }

  /** Changes the name the others see (the choice also lives in the tab's `strukt:collaborator` record, see comments/identity). */
  setName(name: string): void {
    this.identity = { ...this.identity, name };
    try { sessionStorage.setItem('strukt:collaborator', JSON.stringify(this.identity)); } catch { /* Session storage may be blocked. */ }
    this.sendPresence();
  }

  /** This client's id in the announced list. */
  get selfCid(): string { return this.identity.cid; }

  /** Everyone in the room but this client. */
  get others(): Collaborator[] { return this.peers.filter((peer) => peer.cid !== this.identity.cid); }

  /** Tells the room where this client's cursor is. Throttled; the latest state always goes out, the rest are skipped. */
  setPresence(state: PresenceState | null): void {
    this.state = state;
    if (this.stateTimer) return;
    const wait = PRESENCE_GAP_MS - (Date.now() - this.stateSentAt);
    if (wait <= 0) return this.flushPresence();
    this.stateTimer = setTimeout(() => { this.stateTimer = null; this.flushPresence(); }, wait);
  }

  private flushPresence(): void {
    this.stateSentAt = Date.now();
    this.sendPresence();
  }

  private sendPresence(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const payload = { ...this.identity, ...(this.state ? { state: this.state } : {}) };
    this.socket.send(collaborationPacket(COLLAB_PRESENCE, new TextEncoder().encode(JSON.stringify(payload))));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener();
    return () => this.listeners.delete(listener);
  }

  /** Sends an update unless it is too big for the host; then the local copy is discarded and rebuilt from the server. */
  private send(update: Uint8Array): void {
    if (update.length > MAX_UPDATE_BYTES) {
      this.discard(uiText("A alteração é grande demais para sincronizar (limite de {0} KB). Ela foi desfeita para manter todos em sincronia.", [Math.round(MAX_UPDATE_BYTES / 1000)]));
      return;
    }
    this.socket?.send(collaborationPacket(COLLAB_UPDATE, update));
    this.pending++;
  }

  /** Never keep a forked doc: drop the unacknowledged local state; the owner rebuilds the client from the host. */
  private discard(reason: string): void {
    if (this.stopped) return;
    this.retire();
    this.options.onDiscard?.(this, reason);
  }

  /** Stops the socket and timers but leaves the doc readable for consumers that are about to remount. */
  retire(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.stateTimer) clearTimeout(this.stateTimer);
    this.socket?.close();
  }

  giveUp(message: string): void {
    this.fatal = true;
    this.status = 'error';
    this.error = message;
    this.emit();
  }

  private emit() { for (const listener of this.listeners) listener(); }

  private connect() {
    if (this.stopped) return;
    this.status = 'connecting';
    this.emit();
    const url = new URL(`${this.session.apiBase ?? '/api'}/collaboration`, window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const [kind, slug] = this.item.split(':');
    url.searchParams.set('repo', this.session.repo);
    url.searchParams.set('kind', kind!);
    url.searchParams.set('slug', slug!);
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    socket.onopen = () => {
      this.openedAt = Date.now();
      this.pending = 0;
      socket.send(collaborationPacket(COLLAB_SYNC, Y.encodeStateVector(this.doc)));
      this.sendPresence();
      this.status = 'connected';
      this.emit();
    };
    socket.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      const packet = new Uint8Array(event.data);
      const data = packet.subarray(1);
      if (packet[0] === COLLAB_SYNC) {
        const diff = Y.encodeStateAsUpdate(this.doc, data);
        if (diff.length > 2) this.send(diff);
      } else if (packet[0] === COLLAB_UPDATE) {
        try { Y.applyUpdate(this.doc, data, this); this.ready = true; } catch { return this.discard(uiText("Não foi possível ler a atualização recebida. A sessão foi recarregada.")); }
      } else if (packet[0] === COLLAB_ACK) {
        this.attempt = 0; // the host accepted something: only now is the connection healthy
        this.pending = Math.max(0, this.pending - 1);
      } else if (packet[0] === COLLAB_PRESENCE) {
        this.peers = parsePeers(data);
      } else if (packet[0] === COLLAB_ERROR) {
        // A projection failure only shows; a refused update is followed by a 1011 close (see onclose), which rebuilds.
        this.status = 'error';
        this.error = new TextDecoder().decode(data) || uiText("O servidor recusou a alteração.");
      } else if (packet[0] === COLLAB_GONE) {
        // Deleted by someone (or `git rm`): the host no longer writes it; never keep editing or reconnecting.
        this.retire();
        this.giveUp(ITEM_GONE);
        showToast(ITEM_GONE);
        nudgeManifestSync(); // the manifest that drops it is on its way: the list and the open view follow it
        return;
      } else if (packet[0] === COLLAB_PROJECTED) {
        this.status = 'connected';
        this.error = null;
      }
      this.emit();
    };
    socket.onclose = (event: CloseEvent) => {
      if (this.stopped) return;
      if (this.openedAt && Date.now() - this.openedAt >= STABLE_MS) this.attempt = 0;
      this.openedAt = 0;
      if (event?.code === 4429) {
        this.retire();
        const message = uiText('Este workspace atingiu o limite de {0} pessoas simultâneas do Joinlet Beta. Tente novamente quando alguém sair.', [BETA_PLAN.limits.participants]);
        this.giveUp(message);
        accessEnded(message);
        return;
      }
      if (event?.code === COLLAB_CLOSE_REVOKED) {
        // The invite was revoked or expired: never reconnect (it would only be refused again).
        this.retire();
        this.giveUp(ACCESS_ENDED);
        accessEnded();
        return;
      }
      if (event?.code === 1011 && this.error) return this.discard(this.error);
      if (event?.code === COLLAB_CLOSE_NOT_FOUND && ++this.refused === 3) showToast(uiText("Salve o novo item antes de iniciar a colaboração."));
      if (this.status !== 'error') this.status = 'disconnected';
      this.emit();
      const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempt++);
      this.timer = setTimeout(() => this.connect(), delay * (0.5 + Math.random() * 0.5));
    };
    socket.onerror = () => socket.close();
  }

  destroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.stateTimer) clearTimeout(this.stateTimer);
    this.socket?.close();
    this.doc.destroy();
    this.listeners.clear();
  }
}

function randomClientId(): string {
  const bytes = globalThis.crypto?.getRandomValues(new Uint8Array(12)) ?? Array.from({ length: 12 }, () => Math.floor(Math.random() * 256));
  return Array.from(bytes, (byte) => 'abcdefghijklmnopqrstuvwxyz0123456789'[byte % 36]).join('');
}

/** The host's announced list, read defensively: an entry that does not pass the same checks the host applies is skipped. */
function parsePeers(data: Uint8Array): Collaborator[] {
  let list: unknown;
  try { list = JSON.parse(new TextDecoder().decode(data)); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry: unknown) => {
    const id = typeof (entry as { id?: unknown } | null)?.id === 'string' ? (entry as { id: string }).id : null;
    const info = sanitizePresence(entry);
    return id && info ? [{ id, ...info }] : [];
  });
}

const clients = new Map<string, CollaborationClient>();

export function collaborationClient(session: RemoteSession, item: string): CollaborationClient {
  const key = JSON.stringify([session.repo, item]);
  let client = clients.get(key);
  if (!client) {
    client = new CollaborationClient(session, item, { onDiscard: (dead, reason) => discardClient(key, dead, reason) });
    clients.set(key, client);
  }
  return client;
}

/** Leaves one item's room (it was deleted here): the next `collaborationClient` for it starts a fresh one. */
export function closeCollaborationClient(session: RemoteSession, item: string): void {
  const key = JSON.stringify([session.repo, item]);
  clients.get(key)?.destroy();
  clients.delete(key);
}

/** Everyone this tab is connected as takes the new name. */
export function renameCollaborator(name: string): void {
  for (const client of clients.values()) client.setName(name);
}

export function closeCollaborationClients(): void {
  for (const client of clients.values()) client.destroy();
  clients.clear();
}

const discards = new Map<string, number[]>();

/** Toast the reason, then rebuild the room from the host (fresh doc + full sync) unless it keeps failing. */
function discardClient(key: string, client: CollaborationClient, reason: string): void {
  const now = Date.now();
  const recent = [...(discards.get(key) ?? []), now].filter((at) => now - at < DISCARD_WINDOW_MS);
  discards.set(key, recent);
  if (recent.length >= MAX_DISCARDS) {
    client.giveUp(uiText("{0} A colaboração foi pausada depois de várias recusas.", [reason]));
    showToast(uiText("A colaboração parou depois de várias recusas do servidor."), { label: uiText("Recarregar"), run: () => window.location.reload() });
    return;
  }
  showToast(reason);
  if (clients.get(key) === client) clients.delete(key);
  bumpCollaborationEpoch();
}
