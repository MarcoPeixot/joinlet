import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { COLLAB_ACK, COLLAB_ERROR, COLLAB_PRESENCE, COLLAB_SYNC, COLLAB_UPDATE, collaborationPacket, createCollaborationRooms } from './collaborationRoom';
import { CollaborationRefusal } from './collaborationFiles';

describe('collaboration rooms', () => {
  it('ignores packets for a room that failed to open (never rejects, never reopens it)', async () => {
    let loads = 0;
    let fail!: (error: unknown) => void;
    const rooms = createCollaborationRooms({
      load: () => { loads++; return new Promise<Y.Doc>((_, reject) => { fail = reject; }); },
      append: async () => {},
      project: () => {},
    });
    const sent: number[] = [];
    const peer = { id: 'a', send: (packet: Uint8Array) => sent.push(packet[0]!), close: () => {} };
    const joined = rooms.join('big', peer);
    // What a guest sends from `onopen`, before the room has loaded.
    const early = [
      rooms.receive('big', peer, collaborationPacket(COLLAB_SYNC, Y.encodeStateVector(new Y.Doc()))),
      rooms.receive('big', peer, collaborationPacket(COLLAB_PRESENCE, new TextEncoder().encode('{"name":"x","color":"#123456"}'))),
    ];
    fail(new CollaborationRefusal('grande demais'));
    await expect(joined).rejects.toThrow('grande demais');
    await expect(Promise.all(early)).resolves.toBeDefined();
    // Late packets (the socket is still closing) and a peer that never joined: no second load.
    await expect(rooms.receive('big', peer, collaborationPacket(COLLAB_SYNC, new Uint8Array()))).resolves.toBeUndefined();
    await expect(rooms.receive('other', { ...peer, id: 'b' }, collaborationPacket(COLLAB_SYNC, new Uint8Array()))).resolves.toBeUndefined();
    await expect(rooms.leave('big', peer)).resolves.toBeUndefined();
    expect(loads).toBe(1);
  });

  it('a leave while the room is still failing to open resolves', async () => {
    let fail!: (error: unknown) => void;
    const rooms = createCollaborationRooms({
      load: () => new Promise<Y.Doc>((_, reject) => { fail = reject; }),
      append: async () => {},
      project: () => {},
    });
    const peer = { id: 'a', send: () => {}, close: () => {} };
    const joined = rooms.join('broken', peer).catch(() => 'refused');
    const left = rooms.leave('broken', peer);
    fail(new Error('EACCES: permission denied, open /home/owner/repo/.arch/diagrams/x.strukt.json'));
    await expect(left).resolves.toBeUndefined();
    expect(await joined).toBe('refused');
  });

  it('saves before broadcasting and keeps other rooms isolated', async () => {
    const events: string[] = [];
    const rooms = createCollaborationRooms({
      load: async () => new Y.Doc(),
      append: async () => { events.push('saved'); },
      project: () => { events.push('projected'); },
    });
    const peer = (id: string) => ({ id, send: (packet: Uint8Array) => { if (packet[0] === COLLAB_UPDATE || packet[0] === COLLAB_ACK) events.push(`sent:${id}:${packet[0]}`); }, close: () => {} });
    const a = peer('a');
    const b = peer('b');
    const c = peer('c');
    await rooms.join('workspace:doc', a);
    await rooms.join('workspace:doc', b);
    await rooms.join('workspace:other', c);
    events.length = 0;
    const edit = new Y.Doc();
    edit.getText('content').insert(0, 'Olá');
    await rooms.receive('workspace:doc', a, collaborationPacket(COLLAB_UPDATE, Y.encodeStateAsUpdate(edit)));
    expect(events).toEqual(['saved', `sent:b:${COLLAB_UPDATE}`, `sent:a:${COLLAB_ACK}`, 'projected']);
  });

  it('a read-only peer sees everything but its edits are dropped: nothing saved, delivered or projected', async () => {
    const events: string[] = [];
    const rooms = createCollaborationRooms({
      load: async () => new Y.Doc(),
      append: async () => { events.push('saved'); },
      project: () => { events.push('projected'); },
    });
    const peer = (id: string, readOnly?: boolean) => ({ id, readOnly, send: (packet: Uint8Array) => { events.push(`sent:${id}:${packet[0]}`); }, close: (code: number) => events.push(`closed:${id}:${code}`) });
    const editor = peer('editor');
    const viewer = peer('viewer', true);
    await rooms.join('w:doc', editor);
    await rooms.join('w:doc', viewer);
    events.length = 0;
    const edit = new Y.Doc();
    edit.getText('content').insert(0, 'invasor');
    await rooms.receive('w:doc', viewer, collaborationPacket(COLLAB_UPDATE, Y.encodeStateAsUpdate(edit)));
    expect(events).toEqual([]);
    // Presence still goes through (the viewer is someone in the room), and a viewer still receives the editor's edits.
    await rooms.receive('w:doc', viewer, collaborationPacket(COLLAB_PRESENCE, new TextEncoder().encode('{"name":"Ana","color":"#123456"}')));
    expect(events.some((event) => event.startsWith(`sent:editor:${COLLAB_PRESENCE}`))).toBe(true);
    events.length = 0;
    await rooms.receive('w:doc', editor, collaborationPacket(COLLAB_UPDATE, Y.encodeStateAsUpdate(edit)));
    expect(events).toContain(`sent:viewer:${COLLAB_UPDATE}`);
    expect((await rooms.people()).map((person) => person.name).sort()).toEqual(['Ana', 'Colaborador']);
  });

  it('does not deliver an update when persistence fails', async () => {
    const events: string[] = [];
    const roomDoc = new Y.Doc();
    const rooms = createCollaborationRooms({
      load: async () => roomDoc,
      append: async () => { throw new Error('disk full'); },
      project: () => {},
    });
    const peer = (id: string) => ({ id, send: (packet: Uint8Array) => { if (packet[0] === COLLAB_UPDATE) events.push(`sent:${id}`); }, close: (code: number) => events.push(`closed:${id}:${code}`) });
    const a = peer('a');
    const b = peer('b');
    await rooms.join('doc', a);
    await rooms.join('doc', b);
    events.length = 0;
    const edit = new Y.Doc();
    edit.getText('content').insert(0, 'preservado');
    await rooms.receive('doc', a, collaborationPacket(COLLAB_UPDATE, Y.encodeStateAsUpdate(edit)));
    expect(events).toEqual(['closed:a:1011']);
    expect(roomDoc.getText('content').toString()).toBe('');
  });

  it('tells a guest a refusal\'s own message but never an adapter\'s or SQLite\'s (paths of the host)', async () => {
    const leak = new Error("EACCES: permission denied, open '/home/owner/repo/.arch/docs/notas.md'");
    let fail: unknown = leak;
    const rooms = createCollaborationRooms({
      load: async () => new Y.Doc(),
      append: async () => { throw fail; },
      project: () => {},
    });
    const errors: string[] = [];
    const peer = { id: 'a', send: (packet: Uint8Array) => { if (packet[0] === COLLAB_ERROR) errors.push(new TextDecoder().decode(packet.subarray(1))); }, close: () => {} };
    await rooms.join('doc', peer);
    const edit = new Y.Doc();
    edit.getText('content').insert(0, 'x');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await rooms.receive('doc', peer, collaborationPacket(COLLAB_UPDATE, Y.encodeStateAsUpdate(edit)));
    await rooms.error('doc', leak);
    fail = new CollaborationRefusal('Edição recusada: grande demais.');
    await rooms.receive('doc', peer, collaborationPacket(COLLAB_UPDATE, Y.encodeStateAsUpdate(edit)));
    await rooms.error('doc', new CollaborationRefusal('Diagrama alterado fora do Joinlet contém erros.'));
    expect(errors).toHaveLength(4);
    expect(errors.join('\n')).not.toMatch(/home|owner|EACCES|\.arch/);
    expect(errors.slice(2)).toEqual(['Edição recusada: grande demais.', 'Diagrama alterado fora do Joinlet contém erros.']);
    // The host's log keeps the real cause.
    expect(warn.mock.calls.flat().join('\n')).toContain('EACCES');
    warn.mockRestore();
  });
});

describe('presence relay', () => {
  const decoder = new TextDecoder();
  const encode = (value: unknown) => collaborationPacket(COLLAB_PRESENCE, new TextEncoder().encode(JSON.stringify(value)));
  async function pair() {
    const rooms = createCollaborationRooms({ load: async () => new Y.Doc(), append: async () => {}, project: () => {} });
    const lists: Record<string, unknown[]> = { a: [], b: [] };
    const peer = (id: string) => ({ id, send: (packet: Uint8Array) => { if (packet[0] === COLLAB_PRESENCE) lists[id]!.push(JSON.parse(decoder.decode(packet.subarray(1)))); }, close: () => {} });
    const a = peer('a');
    const b = peer('b');
    await rooms.join('r', a);
    await rooms.join('r', b);
    const last = (id: string) => lists[id]!.at(-1) as { id: string; name: string; cid?: string; state?: unknown }[];
    return { rooms, a, b, last };
  }

  it('relays a peer\'s name, color, client id and sanitized state to everyone', async () => {
    const { rooms, a, last } = await pair();
    await rooms.receive('r', a, encode({ name: 'Ana', color: '#3972dc', cid: 'ana-123456', state: { diagram: { pointer: { x: 1, y: 2 }, nodes: ['API'] }, evil: 1 } }));
    for (const id of ['a', 'b']) {
      expect(last(id).find((entry) => entry.id === 'a')).toEqual({ id: 'a', name: 'Ana', color: '#3972dc', cid: 'ana-123456', state: { diagram: { pointer: { x: 1, y: 2 }, nodes: ['API'] } } });
    }
  });

  it('keeps the identity when the state is bad, and ignores a bad identity', async () => {
    const { rooms, a, last } = await pair();
    await rooms.receive('r', a, encode({ name: 'Ana', color: '#3972dc', state: 'nope' }));
    expect(last('b').find((entry) => entry.id === 'a')).toEqual({ id: 'a', name: 'Ana', color: '#3972dc' });
    await rooms.receive('r', a, encode({ name: 'x'.repeat(100), color: 'red' }));
    expect(last('b').find((entry) => entry.id === 'a')?.name).toBe('Ana');
  });

  it('ignores updates from one peer arriving less than 30 ms apart, but never the first', async () => {
    vi.useFakeTimers();
    try {
      const { rooms, a, last } = await pair();
      await rooms.receive('r', a, encode({ name: 'Ana', color: '#3972dc', state: { diagram: { nodes: ['one'] } } }));
      await rooms.receive('r', a, encode({ name: 'Ana', color: '#3972dc', state: { diagram: { nodes: ['two'] } } }));
      expect((last('b').find((entry) => entry.id === 'a')!.state as { diagram: { nodes: string[] } }).diagram.nodes).toEqual(['one']);
      vi.advanceTimersByTime(40);
      await rooms.receive('r', a, encode({ name: 'Ana', color: '#3972dc', state: { diagram: { nodes: ['three'] } } }));
      expect((last('b').find((entry) => entry.id === 'a')!.state as { diagram: { nodes: string[] } }).diagram.nodes).toEqual(['three']);
    } finally { vi.useRealTimers(); }
  });
});

describe('who is online', () => {
  const encode = (value: unknown) => collaborationPacket(COLLAB_PRESENCE, new TextEncoder().encode(JSON.stringify(value)));
  const peer = (id: string) => ({ id, send: () => {}, close: () => {} });

  it('lists each person once across rooms, by client id, and drops who left', async () => {
    const rooms = createCollaborationRooms({ load: async () => new Y.Doc(), append: async () => {}, project: () => {} });
    const [a1, a2, b] = [peer('a1'), peer('a2'), peer('b')];
    await rooms.join('doc:notas', a1);
    await rooms.join('diagram:mapa', a2); // the same person, a second room
    await rooms.join('doc:notas', b);
    await rooms.receive('doc:notas', a1, encode({ name: 'Ana', color: '#3972dc', cid: 'ana-123456' }));
    await rooms.receive('diagram:mapa', a2, encode({ name: 'Ana', color: '#3972dc', cid: 'ana-123456' }));
    await rooms.receive('doc:notas', b, encode({ name: 'Bia', color: '#c75c8f', cid: 'bia-123456' }));
    expect((await rooms.people()).map((person) => person.name).sort()).toEqual(['Ana', 'Bia']);
    await rooms.leave('doc:notas', b);
    expect((await rooms.people()).map((person) => person.name)).toEqual(['Ana']);
  });

  it('counts a guest that has not announced a client id once per connection', async () => {
    const rooms = createCollaborationRooms({ load: async () => new Y.Doc(), append: async () => {}, project: () => {} });
    await rooms.join('doc:notas', peer('x'));
    await rooms.join('doc:outro', peer('y'));
    expect(await rooms.people()).toHaveLength(2);
    expect(await createCollaborationRooms({ load: async () => new Y.Doc(), append: async () => {}, project: () => {} }).people()).toEqual([]);
  });
});
