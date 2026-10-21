import { COLLAB_ACK, COLLAB_CLOSE_NOT_FOUND, COLLAB_CLOSE_REVOKED, COLLAB_ERROR, COLLAB_GONE, COLLAB_PRESENCE, COLLAB_SYNC, COLLAB_UPDATE, collaborationPacket } from '@strukt/workspace/collaboration';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { uiStore } from '../ui/uiStore';
// The default gate saves the workspace first; these tests have none.
vi.mock('./appWorkspace', () => ({ workspace: { flush: async () => {} } }));
import { accessEnded, setAccessEndedHandler } from './accessEnded';
import { CollaborationClient, MAX_DISCARDS, MAX_UPDATE_BYTES, closeCollaborationClient, closeCollaborationClients, collaborationClient, renameCollaborator } from './collaboration';

class FakeSocket {
  static all: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 1;
  binaryType = '';
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: URL) { FakeSocket.all.push(this); }
  send(data: Uint8Array) { this.sent.push(data); }
  close(code = 1000) { this.readyState = 3; queueMicrotask(() => this.onclose?.({ code })); }
  open() { this.onopen?.(); }
  receive(packet: Uint8Array) { this.onmessage?.({ data: packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength) as ArrayBuffer }); }
  serverClose(code: number) { this.readyState = 3; this.onclose?.({ code }); }
}

const session = { repo: 'proj', csrf: '', mcpUrl: '', mode: 'lan' as const };
const make = (onDiscard = vi.fn()) => ({ onDiscard, client: new CollaborationClient(session, 'doc:notas', { gate: async () => {}, onDiscard }) });

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('window', { location: new URL('http://localhost/') });
  vi.spyOn(Math, 'random').mockReturnValue(1);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const connectedSocket = async () => { await vi.advanceTimersByTimeAsync(0); const socket = FakeSocket.all.at(-1)!; socket.open(); return socket; };

describe('CollaborationClient', () => {
  it('backs off exponentially and resets the attempt only after an ACK', async () => {
    const { client } = make();
    let socket = await connectedSocket();
    for (const wait of [500, 1000, 2000]) {
      socket.serverClose(1006); // opened but never accepted anything
      const count = FakeSocket.all.length;
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(FakeSocket.all.length).toBe(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeSocket.all.length).toBe(count + 1);
      socket = FakeSocket.all.at(-1)!;
      socket.open();
    }
    socket.receive(collaborationPacket(COLLAB_ACK));
    socket.serverClose(1006);
    const count = FakeSocket.all.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeSocket.all.length).toBe(count + 1);
    client.retire();
  });

  it('caps the backoff at 30 s', async () => {
    const { client } = make();
    let socket = await connectedSocket();
    for (let i = 0; i < 10; i++) { socket.serverClose(1006); await vi.advanceTimersByTimeAsync(30_000); socket = FakeSocket.all.at(-1)!; socket.open(); }
    const count = FakeSocket.all.length;
    socket.serverClose(1006);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(FakeSocket.all.length).toBe(count);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.all.length).toBe(count + 1);
    client.retire();
  });

  it('does not send an update above the size limit and asks its owner to rebuild the room', async () => {
    const { client, onDiscard } = make();
    const socket = await connectedSocket();
    const before = socket.sent.length;
    client.doc.getText('content').insert(0, 'x'.repeat(MAX_UPDATE_BYTES + 10));
    expect(socket.sent.length).toBe(before);
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(onDiscard.mock.calls[0]![1]).toContain('grande demais');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.all).toHaveLength(1); // retired: no reconnect with the forked doc
  });

  it('rebuilds after a refused update (COLLAB_ERROR then 1011) instead of reconnecting the forked doc', async () => {
    const { onDiscard } = make();
    const socket = await connectedSocket();
    socket.receive(collaborationPacket(COLLAB_ERROR, new TextEncoder().encode('Atualização recusada: grande demais.')));
    socket.serverClose(1011);
    expect(onDiscard).toHaveBeenCalledWith(expect.anything(), 'Atualização recusada: grande demais.');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('a projection error without a close keeps the session (no discard)', async () => {
    const { client, onDiscard } = make();
    const socket = await connectedSocket();
    socket.receive(collaborationPacket(COLLAB_ERROR, new TextEncoder().encode('Falha ao publicar.')));
    expect(client.status).toBe('error');
    expect(onDiscard).not.toHaveBeenCalled();
    client.retire();
  });

  it('ignores unknown message types', async () => {
    const { client } = make();
    const socket = await connectedSocket();
    expect(() => socket.receive(new Uint8Array([99, 1, 2]))).not.toThrow();
    client.retire();
  });

  it('warns once when the host keeps refusing the join (item not saved yet)', async () => {
    const { client } = make();
    let socket = await connectedSocket();
    uiStore.setState({ toast: null });
    for (let i = 0; i < 2; i++) { socket.serverClose(1006); await vi.advanceTimersByTimeAsync(30_000); socket = FakeSocket.all.at(-1)!; socket.open(); }
    expect(uiStore.getState().toast).toBeNull(); // a network failure is not a refusal
    for (let i = 0; i < 2; i++) { socket.serverClose(COLLAB_CLOSE_NOT_FOUND); await vi.advanceTimersByTimeAsync(30_000); socket = FakeSocket.all.at(-1)!; socket.open(); }
    expect(uiStore.getState().toast).toBeNull();
    socket.serverClose(COLLAB_CLOSE_NOT_FOUND);
    expect(uiStore.getState().toast).toContain('Salve o novo item');
    client.retire();
  });

  it('stops syncing an item the host says was deleted, says so and never reconnects', async () => {
    const { client, onDiscard } = make();
    const socket = await connectedSocket();
    socket.receive(collaborationPacket(COLLAB_GONE));
    expect(uiStore.getState().toast).toContain('Este item foi excluído');
    expect(client.status).toBe('error');
    expect(client.fatal).toBe(true);
    socket.serverClose(1001);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(onDiscard).not.toHaveBeenCalled();
    client.destroy();
  });

  it('a revoked or expired invite (4403) ends the session for good: no reconnect, the person is told once', async () => {
    const ended = vi.fn();
    setAccessEndedHandler(ended);
    const { client, onDiscard } = make();
    const socket = await connectedSocket();
    socket.serverClose(COLLAB_CLOSE_REVOKED);
    expect(client.status).toBe('error');
    expect(client.fatal).toBe(true);
    expect(client.error).toContain('revogado ou expirou');
    expect(ended).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(onDiscard).not.toHaveBeenCalled();
    accessEnded();
    expect(ended).toHaveBeenCalledTimes(1);
    client.destroy();
    setAccessEndedHandler(null);
  });

  it('leaving a deleted item\'s room destroys its client: the next one for that item is fresh', async () => {
    const first = collaborationClient(session, 'doc:apagado');
    closeCollaborationClient(session, 'doc:apagado');
    const second = collaborationClient(session, 'doc:apagado');
    expect(second).not.toBe(first);
    expect(collaborationClient(session, 'doc:apagado')).toBe(second);
    closeCollaborationClients();
  });

  it('sends what it holds on connect (its diff against the host\'s state vector) and counts pending until ACK', async () => {
    const { client } = make();
    client.doc.getText('content').insert(0, 'offline'); // before the socket opens: held, not sent
    const socket = await connectedSocket();
    expect(socket.sent.map((packet) => packet[0])).toEqual([COLLAB_SYNC, COLLAB_PRESENCE]);
    // The host answers with its state vector (it has nothing yet): the client sends exactly what it holds.
    socket.receive(collaborationPacket(COLLAB_SYNC, Y.encodeStateVector(new Y.Doc())));
    const diff = socket.sent.at(-1)!;
    expect(diff[0]).toBe(COLLAB_UPDATE);
    const host = new Y.Doc();
    Y.applyUpdate(host, diff.subarray(1));
    expect(host.getText('content').toString()).toBe('offline');
    expect(client.pending).toBe(1);
    // A host that already holds it gets nothing more.
    const count = socket.sent.length;
    socket.receive(collaborationPacket(COLLAB_SYNC, Y.encodeStateVector(host)));
    expect(socket.sent).toHaveLength(count);
    client.doc.getText('content').insert(7, '!');
    expect(client.pending).toBe(2);
    socket.receive(collaborationPacket(COLLAB_ACK));
    socket.receive(collaborationPacket(COLLAB_ACK));
    expect(client.pending).toBe(0);
    client.retire();
  });

  it('gives up after 3 discards within a minute: fatal (the banner\'s "Recarregar"), a toast action, no reconnect', async () => {
    const item = 'doc:recusado';
    const seen: CollaborationClient[] = [];
    for (let i = 0; i < MAX_DISCARDS; i++) {
      const client = collaborationClient(session, item);
      expect(seen).not.toContain(client); // each discard rebuilt the room with a fresh client
      seen.push(client);
      const socket = await connectedSocket();
      socket.receive(collaborationPacket(COLLAB_ERROR, new TextEncoder().encode('Atualização recusada.')));
      socket.serverClose(1011);
      expect(client.fatal).toBe(i === MAX_DISCARDS - 1);
    }
    const last = seen.at(-1)!;
    expect(last.status).toBe('error');
    expect(last.error).toContain('pausada');
    expect(uiStore.getState().toast).toContain('A colaboração parou');
    expect(uiStore.getState().toastAction?.label).toBe('Recarregar');
    // The dead client stays: bound views keep showing the banner instead of rebuilding again.
    expect(collaborationClient(session, item)).toBe(last);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.all).toHaveLength(MAX_DISCARDS);
    closeCollaborationClients();
  });
});

describe('presence', () => {
  const decode = (packet: Uint8Array) => JSON.parse(new TextDecoder().decode(packet.subarray(1)));
  const presencePackets = (socket: FakeSocket) => socket.sent.filter((packet) => packet[0] === COLLAB_PRESENCE).map(decode);

  it('announces its identity with a stable client id when it connects', async () => {
    const { client } = make();
    const socket = await connectedSocket();
    const [identity] = presencePackets(socket);
    expect(identity).toMatchObject({ name: expect.any(String), color: expect.stringMatching(/^#[0-9a-f]{6}$/) });
    expect(identity.cid).toMatch(/^[A-Za-z0-9_-]{6,32}$/);
    expect(client.selfCid).toBe(identity.cid);
    client.retire();
  });

  it('a rename (the name comments are signed with) reaches the room at once, keeping the same id and color', async () => {
    const { client } = make();
    const socket = await connectedSocket();
    const [first] = presencePackets(socket);
    client.setName('Bia Lima');
    expect(presencePackets(socket).at(-1)).toEqual({ ...first, name: 'Bia Lima' });
    client.retire();
  });

  it('renameCollaborator renames the client of every open item', async () => {
    const open = collaborationClient(session, 'doc:notas');
    const socket = await connectedSocket();
    renameCollaborator('Cadu');
    expect(presencePackets(socket).at(-1)).toMatchObject({ name: 'Cadu' });
    closeCollaborationClients();
    open.retire();
  });

  it('sends state updates at most every 80 ms and always ends on the latest one', async () => {
    const { client } = make();
    const socket = await connectedSocket();
    const before = presencePackets(socket).length;
    client.setPresence({ diagram: { nodes: ['A'] } });
    client.setPresence({ diagram: { nodes: ['B'] } });
    client.setPresence({ diagram: { nodes: ['C'] } });
    expect(presencePackets(socket).length).toBe(before + 1);
    expect(presencePackets(socket).at(-1).state).toEqual({ diagram: { nodes: ['A'] } });
    await vi.advanceTimersByTimeAsync(100);
    expect(presencePackets(socket).length).toBe(before + 2);
    expect(presencePackets(socket).at(-1).state).toEqual({ diagram: { nodes: ['C'] } });
    client.retire();
  });

  it('keeps the latest state for the next connection', async () => {
    const { client } = make();
    const first = await connectedSocket();
    client.setPresence({ diagram: { nodes: ['Z'] } });
    first.serverClose(1006);
    await vi.advanceTimersByTimeAsync(1000);
    const second = FakeSocket.all.at(-1)!;
    second.open();
    expect(presencePackets(second)[0].state).toEqual({ diagram: { nodes: ['Z'] } });
    client.retire();
  });

  it('reads the announced list defensively and tells the others from itself', async () => {
    const { client } = make();
    const socket = await connectedSocket();
    const self = client.selfCid;
    const list = [
      { id: 'me', name: 'Eu', color: '#3972dc', cid: self },
      { id: 'ana', name: 'Ana', color: '#c75c8f', cid: 'ana-123456', state: { diagram: { pointer: { x: 1, y: 2 }, evil: 1 } } },
      { id: 'bad', name: '', color: 'nope' },
    ];
    socket.receive(collaborationPacket(COLLAB_PRESENCE, new TextEncoder().encode(JSON.stringify(list))));
    expect(client.peers.map((peer) => peer.name)).toEqual(['Eu', 'Ana']);
    expect(client.others.map((peer) => peer.name)).toEqual(['Ana']);
    expect(client.others[0]!.state).toEqual({ diagram: { pointer: { x: 1, y: 2 } } });
    client.retire();
  });
});

