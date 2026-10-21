import { newWorkspace, addItem, workspaceFiles } from './workspace';
import { writeGeneratedContext } from './contextStorage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { emptyModel } from '@strukt/core';
import { createMemoryAdapter } from './storage';
import { serializeDiagram } from './diagram';
import { COLLAB_MAX_EDGES, COLLAB_MAX_ELEMENTS, COLLAB_MAX_FIELD } from './collaborationSanitize';
import type { CollaborativeRepair } from './collaborationSanitize';
import { applyCollaborativeDiagramDelta, readCollaborativeDiagram } from './collaboration';
import { COLLAB_GONE, COLLAB_UPDATE, collaborationPacket, createCollaborationRooms } from './collaborationRoom';
import { collaborationRoomName, createCollaborationStore } from './collaborationStore';

afterEach(() => vi.useRealTimers());

describe('collaboration file projection', () => {
  it('refreshes agent knowledge after a guest edit without an owner browser', async () => {
    vi.useFakeTimers();
    let data = addItem(newWorkspace('Team'), 'doc', 'Notes').data;
    data = addItem(data, 'diagram', 'API').data;
    data.diagrams.api!.model.elements.API = { kind: 'node', id: 'API', link: 'doc:notes' };
    data.diagrams.api!.model.order = ['API'];
    data.docs.notes = '# Decisions\n\nInitial decision.';
    const adapter = createMemoryAdapter(workspaceFiles(data));
    await writeGeneratedContext(adapter, data);
    const store = createCollaborationStore({
      adapter: async () => adapter,
      persistence: { load: async () => null, append: async () => {}, replace: async () => {}, baseline: async () => {} }, delayMs: 10,
    });
    const room = collaborationRoomName('team', 'doc:notes');
    const doc = await store.load(room);
    doc.getText('content').delete(0, doc.getText('content').length);
    doc.getText('content').insert(0, '# Decisions\n\nNotifications use a durable queue.');
    store.project(room, doc);
    await vi.advanceTimersByTimeAsync(10);
    expect(await adapter.read('context/ARCHITECTURE.md')).toContain('durable queue');
  });

  it('writes a debounced Markdown projection and merges an external overwrite with the edits made since', async () => {
    vi.useFakeTimers();
    const adapter = createMemoryAdapter({ 'docs/notes.md': 'initial' });
    const records = new Map<string, { updates: Uint8Array[]; baseline: Record<string, string | null> }>();
    const errors: string[] = [];
    const store = createCollaborationStore({
      adapter: async () => adapter,
      persistence: {
        load: async (room) => records.get(room) ?? null,
        append: async (room, update) => { records.get(room)!.updates.push(update); },
        replace: async (room, state, baseline) => { records.set(room, { updates: [state], baseline }); },
        baseline: async (room, baseline) => { records.get(room)!.baseline = baseline; },
      },
      onError: (_room, error) => errors.push(String(error)),
      delayMs: 10,
    });
    const room = collaborationRoomName('workspace', 'doc:notes');
    const doc = await store.load(room);
    doc.getText('content').insert(7, ' shared');
    store.project(room, doc);
    await vi.advanceTimersByTimeAsync(10);
    expect(await adapter.read('docs/notes.md')).toBe('initial shared');

    doc.getText('content').insert(14, '!');
    await store.append(room, Y.encodeStateAsUpdate(doc));
    store.project(room, doc);
    await adapter.write('docs/notes.md', 'external');
    await vi.advanceTimersByTimeAsync(10);
    // The '!' typed after "shared" stays after the replaced text; the projection goes on.
    expect(doc.getText('content').toString()).toBe('external!');
    expect(await adapter.read('docs/notes.md')).toBe('external!');
    expect(errors).toEqual([]);
    expect(records.get(room)!.baseline['docs/notes.md']).toBe('external!');
    const replay = new Y.Doc();
    for (const update of records.get(room)!.updates) Y.applyUpdate(replay, update);
    expect(replay.getText('content').toString()).toBe('external!');
  });

  it('projects at least every maxWait while edits keep coming faster than the debounce', async () => {
    vi.useFakeTimers();
    const adapter = createMemoryAdapter({ 'docs/notes.md': '' });
    const store = createCollaborationStore({
      adapter: async () => adapter,
      persistence: { load: async () => null, append: async () => {}, replace: async () => {}, baseline: async () => {} },
      delayMs: 1500,
      maxWaitMs: 5000,
    });
    const room = collaborationRoomName('workspace', 'doc:notes');
    const doc = await store.load(room);
    const seen: Array<[number, string | null]> = [];
    for (let second = 1; second <= 12; second++) {
      doc.getText('content').insert(doc.getText('content').length, `${second % 10}`);
      store.project(room, doc);
      await vi.advanceTimersByTimeAsync(1000);
      seen.push([second, await adapter.read('docs/notes.md')]);
    }
    // One edit a second never lets the 1.5 s debounce fire; the 5 s cap does, twice in 12 s.
    expect(seen[4]).toEqual([5, '12345']);
    expect(seen[9]).toEqual([10, '1234567890']);
    expect(seen[3]![1]).toBe('');
    await vi.advanceTimersByTimeAsync(1500);
    expect(await adapter.read('docs/notes.md')).toBe('123456789012');
  });

  it('keeps the persisted room near the size of the live doc when a text is overwritten again and again', async () => {
    vi.useFakeTimers();
    const model = emptyModel();
    model.elements = { API: { kind: 'node', id: 'API' } };
    model.order = ['API'];
    const { json, layout } = serializeDiagram({ model, layout: { nodes: {}, edges: {} } });
    const adapter = createMemoryAdapter({ 'diagrams/mapa.strukt.json': json, 'diagrams/mapa.layout.json': layout });
    const records = new Map<string, { updates: Uint8Array[]; baseline: Record<string, string | null> }>();
    const persistence = {
      load: async (room: string) => records.get(room) ?? null,
      append: async (room: string, update: Uint8Array) => { records.get(room)!.updates.push(update); },
      replace: async (room: string, state: Uint8Array, baseline: Record<string, string | null>) => { records.set(room, { updates: [state], baseline }); },
      baseline: async (room: string, baseline: Record<string, string | null>) => { records.get(room)!.baseline = baseline; },
    };
    const store = createCollaborationStore({ adapter: async () => adapter, persistence, delayMs: 10 });
    const room = collaborationRoomName('workspace', 'diagram:mapa');
    const stored = () => records.get(room)!.updates.reduce((sum, update) => sum + update.length, 0);
    const doc = await store.load(room);
    const guest = new Y.Doc();
    Y.applyUpdate(guest, Y.encodeStateAsUpdate(doc));
    let peak = 0;
    for (let i = 0; i < 300; i++) {
      // A guest overwrites a 100 KB description, as the room delivers it: persisted first, then applied.
      const vector = Y.encodeStateVector(guest);
      guest.getMap<Y.Map<unknown>>('elements').get('API')!.set('description', `${i}`.padEnd(100_000, 'x'));
      const update = Y.encodeStateAsUpdate(guest, vector);
      await store.append(room, update);
      Y.applyUpdate(doc, update);
      store.project(room, doc);
      peak = Math.max(peak, stored());
    }
    const live = Y.encodeStateAsUpdate(doc).length;
    expect(live).toBeLessThan(110_000);
    // Without compaction: 300 × 100 KB = 30 MB.
    expect(peak).toBeLessThan(1_300_000);
    await store.release!(room);
    expect(stored()).toBeLessThan(live * 1.1);
    const reopened = await store.load(room);
    expect(readCollaborativeDiagram(reopened)!.model.elements.API!.description).toBe('299'.padEnd(100_000, 'x'));
  }, 60_000);

  it('release projects what changed while a projection was in flight', async () => {
    vi.useFakeTimers();
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => { unblock = resolve; });
    const adapter = createMemoryAdapter({ 'docs/notes.md': '' });
    let writes = 0;
    const store = createCollaborationStore({
      adapter: async () => ({ ...adapter, write: async (path: string, text: string) => { if (writes++ === 0) await gate; await adapter.write(path, text); } }),
      persistence: { load: async () => null, append: async () => {}, replace: async () => {}, baseline: async () => {} },
      delayMs: 10,
    });
    const room = collaborationRoomName('workspace', 'doc:notes');
    const doc = await store.load(room);
    doc.getText('content').insert(0, 'um');
    store.project(room, doc);
    await vi.advanceTimersByTimeAsync(10);
    doc.getText('content').insert(2, ' dois');
    const released = store.release!(room);
    unblock();
    await released;
    expect(await adapter.read('docs/notes.md')).toBe('um dois');
  });

  it('keeps projecting a diagram whose merged doc has a parent cycle, and reports each kind of repair once per room', async () => {
    vi.useFakeTimers();
    const model = emptyModel();
    model.elements = { G1: { kind: 'group', id: 'G1' }, G2: { kind: 'group', id: 'G2' }, API: { kind: 'node', id: 'API', parentId: 'G1' } };
    model.order = ['G1', 'G2', 'API'];
    const { json, layout } = serializeDiagram({ model, layout: { nodes: {}, edges: {} } });
    const adapter = createMemoryAdapter({ 'diagrams/mapa.strukt.json': json, 'diagrams/mapa.layout.json': layout });
    const records = new Map<string, { updates: Uint8Array[]; baseline: Record<string, string | null> }>();
    const reported: Array<[string, CollaborativeRepair[]]> = [];
    const errors: unknown[] = [];
    const store = createCollaborationStore({
      adapter: async () => adapter,
      persistence: {
        load: async (room) => records.get(room) ?? null,
        append: async (room, update) => { records.get(room)!.updates.push(update); },
        replace: async (room, state, baseline) => { records.set(room, { updates: [state], baseline }); },
        baseline: async (room, baseline) => { records.get(room)!.baseline = baseline; },
      },
      onError: (_room, error) => errors.push(error),
      onRepair: (room, repairs) => reported.push([room, repairs]),
      delayMs: 10,
    });
    const room = collaborationRoomName('workspace', 'diagram:mapa');
    const doc = await store.load(room);
    const element = (id: string) => doc.getMap<Y.Map<unknown>>('elements').get(id)!;
    doc.transact(() => { element('G1').set('parentId', 'G2'); element('G2').set('parentId', 'G1'); });
    expect(() => store.validate!(room, doc)).not.toThrow();
    store.project(room, doc);
    await vi.advanceTimersByTimeAsync(10);
    const disk = await adapter.read('diagrams/mapa.strukt.json');
    for (const id of ['G1', 'G2', 'API']) expect(disk).toContain(`"id": "${id}"`);
    expect(errors).toEqual([]);

    element('API').set('label', 'Nova');
    store.project(room, doc);
    await vi.advanceTimersByTimeAsync(10);
    expect(await adapter.read('diagrams/mapa.strukt.json')).toContain('"label": "Nova"');
    element('API').set('parentId', 'ghost');
    store.project(room, doc);
    await vi.advanceTimersByTimeAsync(10);
    expect(reported).toEqual([[room, [{ kind: 'cycle', id: 'G2' }]], [room, [{ kind: 'parent', id: 'API' }]]]);
  });

  it('opens a room for a diagram file with errors (merge markers): what could be read, the original backed up once, the file kept until an edit', async () => {
    vi.useFakeTimers();
    const broken = '{\n<<<<<<< HEAD\n  "version": 1,\n=======\n  "version": 2,\n>>>>>>> main\n}';
    const adapter = createMemoryAdapter({ 'diagrams/mapa.strukt.json': broken });
    const writes: string[] = [];
    const records = new Map<string, { updates: Uint8Array[]; baseline: Record<string, string | null> }>();
    const store = createCollaborationStore({
      adapter: async () => ({ ...adapter, write: async (path: string, text: string) => { writes.push(path); await adapter.write(path, text); } }),
      persistence: {
        load: async (room) => records.get(room) ?? null,
        append: async (room, update) => { records.get(room)!.updates.push(update); },
        replace: async (room, state, baseline) => { records.set(room, { updates: [state], baseline }); },
        baseline: async (room, baseline) => { records.get(room)!.baseline = baseline; },
      },
      delayMs: 10,
    });
    const room = collaborationRoomName('workspace', 'diagram:mapa');
    const doc = await store.load(room);
    await vi.advanceTimersByTimeAsync(50);
    expect(readCollaborativeDiagram(doc)!.model.order).toEqual([]);
    expect(adapter.files.get('diagrams/mapa.strukt.json.bak')).toBe(broken);
    expect(adapter.files.get('diagrams/mapa.strukt.json')).toBe(broken);
    expect(writes).toEqual(['diagrams/mapa.strukt.json.bak']);
    await store.release!(room);

    // Opened again (a restart, the backup already there): no second backup write; an edit then writes a valid file.
    writes.length = 0;
    const reopened = await store.load(room);
    await vi.advanceTimersByTimeAsync(50);
    expect(writes).toEqual([]);
    const record = new Y.Map<unknown>();
    reopened.transact(() => {
      record.set('kind', 'node');
      record.set('id', 'API');
      reopened.getMap('elements').set('API', record);
      reopened.getMap('element-order').set('API', 0);
    });
    store.project(room, reopened);
    await vi.advanceTimersByTimeAsync(50);
    expect(adapter.files.get('diagrams/mapa.strukt.json')).toContain('"id": "API"');
    expect(adapter.files.get('diagrams/mapa.strukt.json.bak')).toBe(broken);
  });

  it('validate refuses a raw doc past the element, edge or position caps, or with a string past the field cap', async () => {
    const model = emptyModel();
    model.elements = { API: { kind: 'node', id: 'API', description: 'ADR '.repeat(6000) } };
    model.order = ['API'];
    const { json, layout } = serializeDiagram({ model, layout: { nodes: {}, edges: {} } });
    const adapter = createMemoryAdapter({ 'diagrams/mapa.strukt.json': json, 'diagrams/mapa.layout.json': layout });
    const writes: string[] = [];
    const store = createCollaborationStore({
      adapter: async () => ({ ...adapter, write: async (path: string, text: string) => { writes.push(path); await adapter.write(path, text); } }),
      persistence: { load: async () => null, append: async () => {}, replace: async () => {}, baseline: async () => {} },
      delayMs: 10,
    });
    const room = collaborationRoomName('workspace', 'diagram:mapa');
    vi.useFakeTimers();
    const doc = await store.load(room);
    // A valid long description is neither cut nor rewritten on open.
    await vi.advanceTimersByTimeAsync(20);
    expect(writes).toEqual([]);
    expect(() => store.validate!(room, doc)).not.toThrow();

    const copy = () => {
      const candidate = new Y.Doc();
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(doc));
      return candidate;
    };
    const fill = (name: string, count: number, value: () => unknown) => {
      const candidate = copy();
      candidate.transact(() => { for (let i = 0; i < count; i++) candidate.getMap<unknown>(name).set(`k${i}`, value()); });
      return candidate;
    };
    const box = () => { const map = new Y.Map<unknown>(); map.set('x', 0); map.set('y', 0); return map; };
    expect(() => store.validate!(room, fill('elements', COLLAB_MAX_ELEMENTS, () => 'junk'))).toThrow('limite de 20000 elementos');
    expect(() => store.validate!(room, fill('positions', COLLAB_MAX_ELEMENTS + 1, box))).toThrow('limite de 20000 posições');
    expect(() => store.validate!(room, fill('edge-order', COLLAB_MAX_EDGES + 1, () => 0))).toThrow('limite de 50000 conexões');
    const long = copy();
    (long.getMap<Y.Map<unknown>>('elements').get('API')!).set('junk', 'x'.repeat(COLLAB_MAX_FIELD + 1));
    expect(() => store.validate!(room, long)).toThrow('texto');
    const key = fill('element-order', 1, () => 0);
    key.getMap<unknown>('element-order').set('k'.repeat(COLLAB_MAX_FIELD + 1), 0);
    expect(() => store.validate!(room, key)).toThrow('texto');
    const atField = copy();
    (atField.getMap<Y.Map<unknown>>('elements').get('API')!).set('description', 'x'.repeat(COLLAB_MAX_FIELD));
    expect(() => store.validate!(room, atField)).not.toThrow();
  }, 30_000);
});

describe('an item deleted while its room is live', () => {
  const D = 'diagrams/mapa.strukt.json';
  const L = 'diagrams/mapa.layout.json';
  const M = 'docs/notas.md';
  const manifest = (diagrams: string[], docs: string[]) => JSON.stringify({
    version: 1, name: 'W', diagrams: diagrams.map((slug) => ({ slug, title: slug })), docs: docs.map((slug) => ({ slug, title: slug })), sketches: [],
  });
  const setup = (files: Record<string, string>) => {
    const model = emptyModel();
    model.elements = { Web: { kind: 'node', id: 'Web' }, API: { kind: 'node', id: 'API' } };
    model.order = ['Web', 'API'];
    const { json, layout } = serializeDiagram({ model, layout: { nodes: { Web: { x: 0, y: 0, w: 160, h: 60 }, API: { x: 300, y: 0, w: 160, h: 60 } }, edges: {} } });
    const adapter = createMemoryAdapter({ [D]: json, [L]: layout, [M]: 'Olá', ...files });
    const records = new Map<string, { updates: Uint8Array[]; baseline: Record<string, string | null> }>();
    const persistence = {
      load: async (room: string) => records.get(room) ?? null,
      append: async (room: string, update: Uint8Array) => { records.get(room)!.updates.push(update); },
      replace: async (room: string, state: Uint8Array, baseline: Record<string, string | null>) => { records.set(room, { updates: [state], baseline }); },
      baseline: async (room: string, baseline: Record<string, string | null>) => { records.get(room)!.baseline = baseline; },
      drop: async (room: string) => { records.delete(room); },
    };
    const errors: string[] = [];
    let rooms!: ReturnType<typeof createCollaborationRooms>;
    const store = createCollaborationStore({
      adapter: async () => adapter, persistence, delayMs: 10, onError: (_room, error) => errors.push(String(error)),
      onGone: (room) => void rooms.gone(room),
    });
    rooms = createCollaborationRooms(store);
    const peer = (id: string) => {
      const doc = new Y.Doc();
      const kinds: number[] = [];
      return {
        doc, kinds, id, close: () => {},
        send: (packet: Uint8Array) => { kinds.push(packet[0]!); if (packet[0] === COLLAB_UPDATE) Y.applyUpdate(doc, packet.subarray(1)); },
      };
    };
    return { adapter, records, errors, rooms, peer, diagram: collaborationRoomName('ws', 'diagram:mapa'), notes: collaborationRoomName('ws', 'doc:notas') };
  };
  const edit = async (rooms: ReturnType<typeof createCollaborationRooms>, room: string, peer: { doc: Y.Doc } & Parameters<ReturnType<typeof createCollaborationRooms>['receive']>[1], change: (doc: Y.Doc) => void) => {
    const before = Y.encodeStateVector(peer.doc);
    change(peer.doc);
    await rooms.receive(room, peer, collaborationPacket(COLLAB_UPDATE, Y.encodeStateAsUpdate(peer.doc, before)));
  };
  const move = (doc: Y.Doc) => {
    const snapshot = readCollaborativeDiagram(doc)!;
    const web = snapshot.layout.nodes.Web!;
    applyCollaborativeDiagramDelta(doc, snapshot, { ...snapshot, layout: { ...snapshot.layout, nodes: { ...snapshot.layout.nodes, Web: { ...web, x: web.x + 40 } } } });
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

  it('never recreates the files (edits, eviction, shutdown), tells each peer once and forgets the room', async () => {
    const { adapter, records, errors, rooms, peer, diagram, notes } = setup({});
    const a = peer('A');
    const b = peer('B');
    await rooms.join(diagram, a);
    await rooms.join(notes, b);
    await settle();
    // A guest, the owner's app or `git rm` deletes both items.
    for (const path of [D, L, M]) await adapter.remove(path);
    await edit(rooms, diagram, a, move);
    await edit(rooms, notes, b, (doc) => doc.getText('content').insert(0, 'x'));
    await settle();
    await edit(rooms, diagram, a, move);
    await settle();
    expect({ diagram: await adapter.read(D), layout: await adapter.read(L), doc: await adapter.read(M) }).toEqual({ diagram: null, layout: null, doc: null });
    expect(a.kinds.filter((kind) => kind === COLLAB_GONE)).toHaveLength(1);
    expect(b.kinds.filter((kind) => kind === COLLAB_GONE)).toHaveLength(1);
    await rooms.leave(diagram, a);
    await rooms.leave(notes, b);
    await rooms.shutdown(); // the release the 60 s eviction runs, and SIGTERM
    expect({ diagram: await adapter.read(D), layout: await adapter.read(L), doc: await adapter.read(M) }).toEqual({ diagram: null, layout: null, doc: null });
    expect(adapter.files.size).toBe(0);
    // A new item with the same slug later starts from its own files, not from the deleted room.
    expect(records.has(diagram)).toBe(false);
    expect(records.has(notes)).toBe(false);
    expect(errors).toEqual([]);
  });

  it('a partial deletion counts once the manifest no longer lists the item', async () => {
    const { adapter, rooms, peer, diagram } = setup({ 'strukt.json': manifest(['mapa'], ['notas']) });
    const a = peer('A');
    await rooms.join(diagram, a);
    await settle();
    await adapter.remove(D);
    await adapter.write('strukt.json', manifest([], ['notas']));
    const layout = await adapter.read(L);
    await edit(rooms, diagram, a, move);
    await settle();
    await rooms.shutdown();
    expect(await adapter.read(D)).toBeNull();
    expect(await adapter.read(L)).toBe(layout);
    expect(a.kinds).toContain(COLLAB_GONE);
  });

  it('files restored while the room is live (an undone delete) resume the projection', async () => {
    const { adapter, rooms, peer, diagram } = setup({});
    const a = peer('A');
    await rooms.join(diagram, a);
    await settle();
    const saved = { [D]: await adapter.read(D), [L]: await adapter.read(L) };
    await adapter.remove(D);
    await adapter.remove(L);
    await edit(rooms, diagram, a, move);
    await settle();
    expect(await adapter.read(D)).toBeNull();
    for (const [path, text] of Object.entries(saved)) await adapter.write(path, text!);
    await edit(rooms, diagram, a, move);
    await settle();
    expect(JSON.parse((await adapter.read(L))!).nodes.Web.x).toBe(80);
    expect(await adapter.read(D)).toBe(saved[D]);
    await rooms.shutdown();
  });

  it('a persisted room whose files were deleted while the host was down stays deleted and tells whoever joins', async () => {
    const { adapter, rooms, peer, diagram } = setup({});
    const a = peer('A');
    await rooms.join(diagram, a);
    await settle();
    await rooms.leave(diagram, a);
    await rooms.shutdown();
    await adapter.remove(D);
    await adapter.remove(L);
    const b = peer('B');
    await rooms.join(diagram, b);
    await edit(rooms, diagram, b, move);
    await settle();
    await rooms.shutdown();
    expect(await adapter.read(D)).toBeNull();
    expect(await adapter.read(L)).toBeNull();
    expect(b.kinds).toContain(COLLAB_GONE);
  });
});
