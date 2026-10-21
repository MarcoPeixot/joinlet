import * as Y from 'yjs';
import { COLLAB_EXTERNAL, COLLAB_REPAIR } from './collaboration';
import { CollaborationRefusal } from './collaborationFiles';
import { sanitizePresence } from './collaborationPresence';
import type { PresenceInfo } from './collaborationPresence';

export const COLLAB_SYNC = 0;
export const COLLAB_UPDATE = 1;
export const COLLAB_PRESENCE = 2;
export const COLLAB_ERROR = 3;
export const COLLAB_ACK = 4;
export const COLLAB_PROJECTED = 5;
/** The room's item was deleted: the client stops syncing it and says so. */
export const COLLAB_GONE = 6;
export const COLLAB_LIMIT = 1_000_000;
/** A guest's presence updates closer than this are dropped (cursors move far faster than anyone needs to see). */
export const PRESENCE_MIN_GAP_MS = 30;
/** Close code for a room the host does not have (an item not saved in its manifest). A refused upgrade would not do:
 * browsers report it as 1006, with no status, like any network failure. */
export const COLLAB_CLOSE_NOT_FOUND = 4404;
/** Close code for a socket whose invite was revoked or has expired: the client stops, it does not reconnect. */
export const COLLAB_CLOSE_REVOKED = 4403;

/**
 * What a guest is told about a failure: a refusal's own message (pt-BR, safe), never an adapter's or SQLite's (they
 * carry the host's paths). The real cause goes to the host's log.
 */
function guestMessage(error: unknown, fallback: string): string {
  if (error instanceof CollaborationRefusal) return error.message;
  console.warn(`Colaboração: ${fallback} ${error instanceof Error ? error.message : String(error)}`);
  return fallback;
}

export function collaborationPacket(kind: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const packet = new Uint8Array(payload.length + 1);
  packet[0] = kind;
  packet.set(payload, 1);
  return packet;
}

export interface CollaborationPeer {
  id: string;
  send(packet: Uint8Array): void;
  close(code: number): void;
  /** A viewer (the read-only link): it syncs and shows presence, but its edits are dropped. */
  readOnly?: boolean;
}

export interface CollaborationRoomStore {
  load(room: string): Promise<Y.Doc>;
  append(room: string, update: Uint8Array): Promise<void>;
  /** Schedules the room's projection; a room that is not open is left alone. */
  project(room: string, doc?: Y.Doc): void;
  release?(room: string): Promise<void>;
  validate?(room: string, doc: Y.Doc): void;
  /** Writes the repairs the room's content needs into `doc` (one transaction, origin `COLLAB_REPAIR`) and returns
   * that update, or null when there is nothing to repair (no transaction at all). */
  repair?(room: string, doc: Y.Doc): Uint8Array | null;
  /** True while the room's item is deleted (its files gone): a peer that joins is told. */
  gone?(room: string): boolean;
}

interface Room {
  doc: Y.Doc;
  peers: Map<CollaborationPeer, PresenceInfo & { at?: number }>;
  queue: Promise<void>;
  eviction?: ReturnType<typeof setTimeout>;
  /** A copy of `doc` where each update is tried first; kept in step with `doc`, rebuilt after a refused update. */
  candidate?: Y.Doc;
}

/**
 * Shared protocol for both authenticated servers. Updates are durable before delivery. After each accepted update (and
 * when a room is opened) the host writes the store's repairs into the doc: persisted with the update, applied, then
 * sent to every peer, the sender included, as one more update. Clients never repair; the repair runs only for an
 * incoming update or a load, never for its own transaction, and a clean doc gets none.
 */
export function createCollaborationRooms(store: CollaborationRoomStore) {
  const rooms = new Map<string, Promise<Room>>();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const roomFor = (name: string): Promise<Room> => {
    let pending = rooms.get(name);
    if (!pending) {
      pending = store.load(name).then(async (doc) => {
        const repair = store.repair?.(name, doc);
        if (repair) await store.append(name, repair);
        const room: Room = { doc, peers: new Map(), queue: Promise.resolve() };
        doc.on('update', (update: Uint8Array, origin: unknown) => {
          // Everything the doc gets reaches the candidate (for what was tried there first, a no-op).
          if (room.candidate) Y.applyUpdate(room.candidate, update);
          // What the store merges from the files (an agent's write) reaches every peer as one more update.
          if (origin !== COLLAB_EXTERNAL) return;
          const packet = collaborationPacket(COLLAB_UPDATE, update);
          for (const peer of room.peers.keys()) peer.send(packet);
        });
        return room;
      });
      rooms.set(name, pending);
      void pending.catch(() => rooms.delete(name));
    }
    return pending;
  };

  const announce = (room: Room) => {
    const packet = collaborationPacket(COLLAB_PRESENCE, encoder.encode(JSON.stringify([...room.peers].map(([peer, { at: _at, ...user }]) => ({ id: peer.id, ...user })))));
    for (const peer of room.peers.keys()) peer.send(packet);
  };

  return {
    /** Everyone connected to any room, once each (by client id; a guest without one counts once per connection). */
    async people(): Promise<{ name: string; color: string }[]> {
      const opened = await Promise.all([...rooms.values()].map((pending) => pending.catch(() => null)));
      const seen = new Map<string, { name: string; color: string }>();
      for (const room of opened) {
        for (const [peer, { name, color, cid }] of room?.peers ?? []) seen.set(cid ?? `peer:${peer.id}`, { name, color });
      }
      return [...seen.values()];
    },
    async projected(name: string): Promise<void> {
      const room = await rooms.get(name)?.catch(() => null);
      if (!room) return;
      for (const peer of room.peers.keys()) peer.send(collaborationPacket(COLLAB_PROJECTED));
    },
    async gone(name: string): Promise<void> {
      const room = await rooms.get(name)?.catch(() => null);
      if (!room) return;
      for (const peer of room.peers.keys()) peer.send(collaborationPacket(COLLAB_GONE));
    },
    async error(name: string, error: unknown): Promise<void> {
      const room = await rooms.get(name)?.catch(() => null);
      if (!room) return;
      const packet = collaborationPacket(COLLAB_ERROR, encoder.encode(guestMessage(error, 'Falha ao gravar as mudanças no host.')));
      for (const peer of room.peers.keys()) peer.send(packet);
    },
    /** Rejects when the room cannot open; a `CollaborationRefusal` is told to the peer first (the host then closes it). */
    async join(name: string, peer: CollaborationPeer): Promise<void> {
      let room: Room;
      try { room = await roomFor(name); }
      catch (error) {
        if (error instanceof CollaborationRefusal) peer.send(collaborationPacket(COLLAB_ERROR, encoder.encode(error.message)));
        throw error;
      }
      if (room.eviction) clearTimeout(room.eviction);
      room.peers.set(peer, { name: 'Colaborador', color: '#3972dc' });
      peer.send(collaborationPacket(COLLAB_SYNC, Y.encodeStateVector(room.doc)));
      peer.send(collaborationPacket(COLLAB_UPDATE, Y.encodeStateAsUpdate(room.doc)));
      announce(room);
      if (store.gone?.(name)) peer.send(collaborationPacket(COLLAB_GONE));
    },
    /** Only a peer that joined may send: never opens a room (one that failed to open is not retried) and never rejects
     * for a room that did not open, whatever a guest sends before or after its join fails. */
    async receive(name: string, peer: CollaborationPeer, packet: Uint8Array): Promise<void> {
      const room = await rooms.get(name)?.catch(() => null);
      if (!room || !room.peers.has(peer)) return;
      if (packet.byteLength < 1 || packet.byteLength > COLLAB_LIMIT) return peer.close(1009);
      const payload = packet.subarray(1);
      if (packet[0] === COLLAB_SYNC) {
        try { peer.send(collaborationPacket(COLLAB_UPDATE, Y.encodeStateAsUpdate(room.doc, payload))); }
        catch { peer.close(1007); }
      } else if (packet[0] === COLLAB_UPDATE) {
        // Enforced here, not in the client: a viewer's local state never reaches the file, the store or the others.
        if (peer.readOnly) return;
        room.queue = room.queue.catch(() => {}).then(async () => {
          // Cloning the doc per update cost as much as validating it; the candidate is kept instead.
          if (!room.candidate) {
            room.candidate = new Y.Doc();
            Y.applyUpdate(room.candidate, Y.encodeStateAsUpdate(room.doc));
          }
          const candidate = room.candidate;
          try {
            Y.applyUpdate(candidate, payload);
            store.validate?.(name, candidate);
            // A fresh client id for each repair: a guest cannot pre-plant structs under the one it would use.
            candidate.clientID = Math.floor(Math.random() * 0x100000000);
            // The candidate is the room doc plus this update, so its repair applies to the room doc right after it.
            const repair = store.repair?.(name, candidate) ?? null;
            await store.append(name, repair ? Y.mergeUpdates([payload, repair]) : payload);
            Y.applyUpdate(room.doc, payload);
            if (repair) Y.applyUpdate(room.doc, repair, COLLAB_REPAIR);
            for (const other of room.peers.keys()) if (other !== peer) other.send(packet);
            peer.send(collaborationPacket(COLLAB_ACK));
            if (repair) {
              const fix = collaborationPacket(COLLAB_UPDATE, repair);
              for (const each of room.peers.keys()) each.send(fix);
            }
            store.project(name, room.doc);
          } catch (error) {
            // It holds the refused update: the next one gets a fresh copy of the room doc.
            candidate.destroy();
            room.candidate = undefined;
            throw error;
          }
        });
        try { await room.queue; }
        catch (error) {
          peer.send(collaborationPacket(COLLAB_ERROR, encoder.encode(guestMessage(error, 'Falha ao salvar a edição no host.'))));
          peer.close(1011);
        }
      } else if (packet[0] === COLLAB_PRESENCE) {
        let raw: unknown;
        try { raw = JSON.parse(decoder.decode(payload)); } catch { return peer.close(1007); }
        const info = sanitizePresence(raw);
        if (!info) return;
        const now = Date.now();
        const previous = room.peers.get(peer);
        if (previous?.at !== undefined && now - previous.at < PRESENCE_MIN_GAP_MS) return;
        room.peers.set(peer, { ...info, at: now });
        announce(room);
      }
    },
    /**
     * For a host that is stopping: closes every peer (1001), waits for the updates in flight and releases every room
     * (the store writes its pending projection). Rejects, after trying them all, when a room could not be released.
     */
    async shutdown(): Promise<void> {
      const results = await Promise.allSettled([...rooms].map(async ([name, pending]) => {
        const room = await pending.catch(() => null);
        if (!room) return;
        clearTimeout(room.eviction);
        const peers = [...room.peers.keys()];
        room.peers.clear();
        for (const peer of peers) peer.close(1001);
        await room.queue.catch(() => {});
        await store.release?.(name);
        rooms.delete(name);
        room.candidate?.destroy();
        room.doc.destroy();
      }));
      const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failed.length) throw new AggregateError(failed.map((result) => result.reason), 'Falha ao gravar salas da colaboração.');
    },
    async leave(name: string, peer: CollaborationPeer): Promise<void> {
      const room = await rooms.get(name)?.catch(() => null);
      if (!room || !room.peers.delete(peer)) return;
      announce(room);
      if (!room.peers.size) {
        const evict = () => {
          if (room.peers.size) return;
          void room.queue.catch(() => {}).then(async () => {
            if (room.peers.size) return;
            try { await store.release?.(name); }
            catch { room.eviction = setTimeout(evict, 60_000); return; }
            if (room.peers.size) return;
            rooms.delete(name);
            room.candidate?.destroy();
            room.doc.destroy();
          });
        };
        room.eviction = setTimeout(evict, 60_000);
      }
    },
  };
}
