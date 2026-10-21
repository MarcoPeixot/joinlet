import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { applyOps, emptyModel, normalizeEdgeIds, own, syncLayout } from '@strukt/core';
import type { DiagramModel, DiagramOp } from '@strukt/core';
import { parseDiagramJson, printDiagramJson } from '@strukt/json';
import {
  COLLAB_REPAIR, applyCollaborativeDiagramDelta, readCollaborativeDiagram, repairCollaborativeDiagram, repairedLocalDiagram, seedCollaborativeDiagram,
} from './collaboration';
import { projectedCollaborationFiles } from './collaborationFiles';
import { COLLAB_ERROR, COLLAB_UPDATE, collaborationPacket, createCollaborationRooms } from './collaborationRoom';
import { COLLAB_MAX_DEPTH, COLLAB_MAX_ELEMENTS } from './collaborationSanitize';
import type { CollaborativeRepair } from './collaborationSanitize';
import { collaborationRoomName, createCollaborationStore } from './collaborationStore';
import type { PersistedCollaborationRoom } from './collaborationStore';
import { deserializeDiagram, printLayout, serializeDiagram } from './diagram';
import type { DiagramSnapshot } from './diagram';
import { createMemoryAdapter } from './storage';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const ROOM = collaborationRoomName('workspace', 'diagram:mapa');
const DIAGRAM = 'diagrams/mapa.strukt.json';
const LAYOUT = 'diagrams/mapa.layout.json';
const FROM_HOST = Symbol('from host');

/** A browser tab driven like CollaborationBridge: a local edit applies ops to what the canvas shows, publishes the
 * delta and shows `repairedLocalDiagram` of the result when it needs a repair (no re-read of its own doc); a packet
 * from the host re-reads the doc. Packets wait in `inbox` until delivered, so a test picks the interleaving. */
class Tab {
  readonly doc = new Y.Doc();
  view: DiagramSnapshot | null = null;
  readonly inbox: Uint8Array[] = [];
  readonly outbox: Uint8Array[] = [];
  readonly errors: string[] = [];
  closed: number | null = null;
  readonly peer: { id: string; send(packet: Uint8Array): void; close(code: number): void };

  constructor(readonly name: string) {
    this.peer = { id: name, send: (packet) => { this.inbox.push(packet); }, close: (code) => { this.closed = code; } };
    this.doc.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== FROM_HOST) this.outbox.push(update); });
  }

  /** Delivers up to `count` packets from the host, in order. */
  receive(count = Infinity): void {
    for (let i = 0; i < count && this.inbox.length; i++) {
      const packet = this.inbox.shift()!;
      if (packet[0] === COLLAB_UPDATE) {
        Y.applyUpdate(this.doc, packet.subarray(1), FROM_HOST);
        this.view = readCollaborativeDiagram(this.doc);
      } else if (packet[0] === COLLAB_ERROR) this.errors.push(new TextDecoder().decode(packet.subarray(1)));
    }
  }

  edit(ops: DiagramOp[]): void {
    const before = this.view!;
    const result = applyOps(before.model, ops);
    if (!result.ok) throw new Error(result.error.message);
    const after = { model: result.model, layout: syncLayout(before.layout, result.model, ops) };
    applyCollaborativeDiagramDelta(this.doc, before, after);
    this.view = repairedLocalDiagram(after) ?? after;
  }
}

type Persisted = Map<string, PersistedCollaborationRoom>;

/** The real room protocol over the real store (memory adapter, in-memory persistence), as both hosts wire them. */
async function host(files: Record<string, string>, records: Persisted = new Map()) {
  const adapter = createMemoryAdapter(files);
  const appended: Uint8Array[] = [];
  const reported: CollaborativeRepair[] = [];
  const store = createCollaborationStore({
    adapter: async () => adapter,
    persistence: {
      load: async (room) => records.get(room) ?? null,
      append: async (room, update) => { appended.push(update); records.get(room)!.updates.push(update); },
      replace: async (room, state, baseline) => { records.set(room, { updates: [state], baseline }); },
      baseline: async (room, baseline) => { records.get(room)!.baseline = baseline; },
    },
    onRepair: (_room, repairs) => reported.push(...repairs),
    delayMs: 10,
  });
  let doc: Y.Doc | null = null;
  let repairCalls = 0;
  let repairTransactions = 0;
  const rooms = createCollaborationRooms({
    ...store,
    load: async (room) => {
      doc = await store.load(room);
      doc.on('update', (_update: Uint8Array, origin: unknown) => { if (origin === COLLAB_REPAIR) repairTransactions++; });
      return doc;
    },
    repair: (room, target) => { repairCalls++; return store.repair!(room, target); },
  });
  const tabs: Tab[] = [];
  const self = {
    rooms, adapter, records, appended, reported, tabs,
    get doc() { return doc!; },
    get repairCalls() { return repairCalls; },
    get repairTransactions() { return repairTransactions; },
    async join(...names: string[]): Promise<Tab[]> {
      const joined = names.map((name) => new Tab(name));
      for (const tab of joined) {
        await rooms.join(ROOM, tab.peer);
        tabs.push(tab);
      }
      // Drains the sync and every presence announcement, so each inbox then holds only what edits cause.
      for (const tab of tabs) tab.receive();
      return joined;
    },
    async send(tab: Tab): Promise<void> {
      for (const update of tab.outbox.splice(0)) await rooms.receive(ROOM, tab.peer, collaborationPacket(COLLAB_UPDATE, update));
    },
    receiveAll(): void { for (const tab of tabs) tab.receive(); },
    /** Lets the debounced projection write the files. */
    async flush(): Promise<void> { await vi.advanceTimersByTimeAsync(50); },
  };
  return self;
}

/** What a canvas shows, canonically: the printed diagram and its layout file. */
const shown = (snapshot: DiagramSnapshot | null) => (snapshot ? printDiagramJson(snapshot.model) + printLayout(snapshot.model, snapshot.layout) : 'nothing');

/** Every tab's canvas, the host's read, and the disk: all must show the same diagram. */
async function expectConverged(h: Awaited<ReturnType<typeof host>>) {
  await h.flush();
  const server = readCollaborativeDiagram(h.doc)!;
  const disk = deserializeDiagram(await h.adapter.read(DIAGRAM), await h.adapter.read(LAYOUT));
  expect(disk.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  expect(shown(disk.snapshot)).toBe(shown(server));
  for (const tab of h.tabs) {
    expect(tab.inbox, `${tab.name} has undelivered packets`).toEqual([]);
    expect(shown(tab.view), `${tab.name}'s canvas`).toBe(shown(server));
    expect(rawState(tab.doc), `${tab.name}'s raw doc`).toEqual(rawState(h.doc));
  }
  expectRawInvariants(h.doc);
  return server;
}

/** The raw doc as plain data, map by map. */
function rawState(doc: Y.Doc) {
  const plain = (value: unknown): unknown => (value instanceof Y.Map ? Object.fromEntries([...value.entries()].map(([key, inner]) => [key, plain(inner)]).sort(([a], [b]) => (a! < b! ? -1 : 1))) : value);
  return Object.fromEntries(['style', 'elements', 'edges', 'positions', 'element-order', 'edge-order'].map((name) => [name, plain(doc.getMap(name))]));
}

/** The structural rules, checked on the raw CRDT (not on the repaired view). */
function expectRawInvariants(doc: Y.Doc) {
  const elements = doc.getMap<unknown>('elements');
  const record = (id: string) => elements.get(id) as Y.Map<unknown> | undefined;
  for (const [id, value] of elements.entries()) {
    expect(value, `element ${id} is a record`).toBeInstanceOf(Y.Map);
    const el = value as Y.Map<unknown>;
    expect(el.get('id'), `id of ${id}`).toBe(id);
    let depth = 0;
    const seen = new Set<string>([id]);
    for (let parent = el.get('parentId'); parent !== undefined; parent = record(parent as string)!.get('parentId')) {
      expect(typeof parent === 'string' && record(parent) instanceof Y.Map && record(parent)!.get('kind'), `parent of ${id} is an existing group`).toBe('group');
      expect(seen.has(parent as string), `cycle through ${id}`).toBe(false);
      seen.add(parent as string);
      depth++;
    }
    expect(depth, `depth of ${id}`).toBeLessThanOrEqual(COLLAB_MAX_DEPTH);
  }
  for (const [id, value] of doc.getMap<unknown>('edges').entries()) {
    const edge = value as Y.Map<unknown>;
    expect(edge.get('id'), `id of edge ${id}`).toBe(id);
    expect(elements.has(edge.get('from') as string) && elements.has(edge.get('to') as string), `endpoints of ${id}`).toBe(true);
  }
  for (const id of doc.getMap('positions').keys()) expect(elements.has(id), `box of ${id}`).toBe(true);
  for (const id of doc.getMap('element-order').keys()) expect(elements.has(id), `order of ${id}`).toBe(true);
  for (const id of doc.getMap('edge-order').keys()) expect(doc.getMap('edges').has(id), `order of edge ${id}`).toBe(true);
  expect(repairCollaborativeDiagram(doc).update, 'nothing left to repair').toBeNull();
}

function files(snapshot: DiagramSnapshot): Record<string, string> {
  const { json, layout } = serializeDiagram(snapshot);
  return { [DIAGRAM]: json, [LAYOUT]: layout };
}

/** The verification workspace, with a node and a group whose names the UI hands out again once they are free. */
function mapa(): DiagramSnapshot {
  const model = emptyModel();
  const nodes: DiagramSnapshot['layout']['nodes'] = {};
  const add = (el: DiagramModel['elements'][string], box: { x: number; y: number; w: number; h: number }) => {
    model.elements[el.id] = el;
    model.order.push(el.id);
    nodes[el.id] = box;
  };
  add({ kind: 'node', id: 'API' }, { x: 0, y: 0, w: 160, h: 60 });
  add({ kind: 'node', id: 'DB', shape: 'cylinder' }, { x: 300, y: 0, w: 160, h: 60 });
  add({ kind: 'node', id: 'Cache', label: 'Cache' }, { x: 0, y: 200, w: 160, h: 60 });
  add({ kind: 'node', id: 'Nó 3' }, { x: 300, y: 200, w: 160, h: 60 });
  add({ kind: 'group', id: 'G1', label: 'Grupo 1' }, { x: 700, y: 0, w: 300, h: 200 });
  add({ kind: 'group', id: 'G2', label: 'Grupo 2' }, { x: 700, y: 300, w: 300, h: 200 });
  add({ kind: 'group', id: 'Grupo 2' }, { x: 1200, y: 300, w: 300, h: 200 });
  model.edges.push({ id: '', from: 'API', to: 'DB', connector: '>' });
  return { model: normalizeEdgeIds(model), layout: { nodes, edges: {} } };
}

const parentOf = (snapshot: DiagramSnapshot | null, id: string) => own(snapshot!.model.elements, id)?.parentId;

describe('the host repairs the doc after every accepted update (S1–S3 from the review)', () => {
  it('S1: after a parent cycle, the actor moving G1 to the top level sees the same tree as every peer and the disk', async () => {
    const h = await host(files(mapa()));
    const [a, b] = await h.join('A', 'B', 'C');
    a!.edit([{ op: 'move_to_group', id: 'G1', parentId: 'G2' }]);
    b!.edit([{ op: 'move_to_group', id: 'G2', parentId: 'G1' }]);
    await h.send(a!);
    await h.send(b!);
    h.receiveAll();
    // The cycle was broken in the CRDT itself, not only in the view: G2's stale link to G1 is gone.
    expect((h.doc.getMap('elements').get('G2') as Y.Map<unknown>).has('parentId')).toBe(false);
    expect(h.repairTransactions).toBe(1);
    await expectConverged(h);

    a!.edit([{ op: 'move_to_group', id: 'G1', parentId: null }]);
    await h.send(a!);
    h.receiveAll();
    const server = await expectConverged(h);
    expect([parentOf(server, 'G1'), parentOf(server, 'G2')]).toEqual([undefined, undefined]);
  });

  it('S1 in the window before the repair arrives: the actor edits on a doc still holding the cycle and nobody drifts', async () => {
    const h = await host(files(mapa()));
    const [a, b] = await h.join('A', 'B', 'C');
    a!.edit([{ op: 'move_to_group', id: 'G1', parentId: 'G2' }]);
    b!.edit([{ op: 'move_to_group', id: 'G2', parentId: 'G1' }]);
    await h.send(a!);
    await h.send(b!);
    // A's inbox: the ACK of its own update, B's update, then the host's repair. A edits between the last two.
    a!.receive(2);
    expect(rawState(a!.doc)).not.toEqual(rawState(h.doc));
    a!.edit([{ op: 'move_to_group', id: 'G1', parentId: null }]);
    const seen: Array<[string | undefined, string | undefined]> = [[parentOf(a!.view, 'G1'), parentOf(a!.view, 'G2')]];
    await h.send(a!);
    while (a!.inbox.length) {
      a!.receive(1);
      seen.push([parentOf(a!.view, 'G1'), parentOf(a!.view, 'G2')]);
    }
    h.receiveAll();
    // The actor's canvas never shows G2 jumping into G1, before or after the repair lands.
    for (const step of seen) expect(step).toEqual([undefined, undefined]);
    const server = await expectConverged(h);
    expect([parentOf(server, 'G1'), parentOf(server, 'G2')]).toEqual([undefined, undefined]);
  });

  it('S2: a new node that reuses the name of a removed one does not inherit a connection made to the old one', async () => {
    const h = await host(files(mapa()));
    const [a, b, c] = await h.join('A', 'B', 'C');
    a!.edit([{ op: 'connect', from: 'API', to: 'Nó 3' }]);
    b!.edit([{ op: 'remove', id: 'Nó 3' }]);
    await h.send(a!);
    await h.send(b!);
    h.receiveAll();
    expect(h.doc.getMap('edges').has('API→Nó 3')).toBe(false);
    await expectConverged(h);
    c!.edit([{ op: 'add_node', id: 'Nó 3' }]);
    await h.send(c!);
    h.receiveAll();
    const server = await expectConverged(h);
    expect(server.model.edges.map((edge) => edge.id)).toEqual(['API→DB']);
  });

  it('S3: an element moved into a removed group does not jump into a new group that reuses the name', async () => {
    const h = await host(files(mapa()));
    const [a, b, c] = await h.join('A', 'B', 'C');
    a!.edit([{ op: 'move_to_group', id: 'Cache', parentId: 'Grupo 2' }]);
    b!.edit([{ op: 'remove', id: 'Grupo 2' }]);
    await h.send(a!);
    await h.send(b!);
    h.receiveAll();
    expect((h.doc.getMap('elements').get('Cache') as Y.Map<unknown>).has('parentId')).toBe(false);
    c!.edit([{ op: 'add_group', id: 'Grupo 2' }]);
    await h.send(c!);
    h.receiveAll();
    const server = await expectConverged(h);
    expect(parentOf(server, 'Cache')).toBeUndefined();
  });
});

describe('the repair transaction', () => {
  it('is persisted with the update that needed it and replays to the same clean doc', async () => {
    const h = await host(files(mapa()));
    const [a, b] = await h.join('A', 'B');
    a!.edit([{ op: 'move_to_group', id: 'G1', parentId: 'G2' }]);
    b!.edit([{ op: 'move_to_group', id: 'G2', parentId: 'G1' }]);
    await h.send(a!);
    await h.send(b!);
    const replay = new Y.Doc();
    for (const update of h.records.get(ROOM)!.updates) Y.applyUpdate(replay, update);
    expect(rawState(replay)).toEqual(rawState(h.doc));
    expectRawInvariants(replay);
    expect(h.reported.map((repair) => repair.kind)).toEqual(['cycle']);
  });

  it('never fires for its own origin or for a clean update, and tabs never send it back', async () => {
    const h = await host(files(mapa()));
    const [a, b, c] = await h.join('A', 'B', 'C');
    const loadCalls = h.repairCalls;
    a!.edit([{ op: 'move_to_group', id: 'G1', parentId: 'G2' }]);
    b!.edit([{ op: 'move_to_group', id: 'G2', parentId: 'G1' }]);
    await h.send(a!);
    await h.send(b!);
    h.receiveAll();
    expect(h.repairTransactions).toBe(1);
    // One repair check per accepted update; applying the repair itself (origin COLLAB_REPAIR) never triggers another.
    expect(h.repairCalls - loadCalls).toBe(2);
    for (const tab of [a!, b!, c!]) expect(tab.outbox, `${tab.name} echoes nothing`).toEqual([]);

    // A tab that reconnects re-sends its whole doc, the repair included: accepted, nothing more to repair.
    const appended = h.appended.length;
    await h.rooms.receive(ROOM, c!.peer, collaborationPacket(COLLAB_UPDATE, Y.encodeStateAsUpdate(c!.doc)));
    c!.edit([{ op: 'update', id: 'API', set: { label: 'API v2' } }]);
    await h.send(c!);
    h.receiveAll();
    expect(h.repairTransactions).toBe(1);
    expect(h.appended.length - appended).toBe(2);
    await expectConverged(h);
  });

  it('runs when a room is opened: a room persisted with hidden state is cleaned once, then opens clean', async () => {
    // A room saved before the host wrote repairs: its updates hold a merged parent cycle and a dangling connection.
    const server = new Y.Doc();
    seedCollaborativeDiagram(server, mapa());
    const seed = Y.encodeStateAsUpdate(server);
    for (const ops of [[{ op: 'move_to_group', id: 'G1', parentId: 'G2' }, { op: 'connect', from: 'Cache', to: 'Nó 3' }], [{ op: 'move_to_group', id: 'G2', parentId: 'G1' }, { op: 'remove', id: 'Nó 3' }]] as DiagramOp[][]) {
      const peer = new Y.Doc();
      Y.applyUpdate(peer, seed);
      const vector = Y.encodeStateVector(peer);
      const before = readCollaborativeDiagram(peer)!;
      const result = applyOps(before.model, ops);
      if (!result.ok) throw new Error(result.error.message);
      applyCollaborativeDiagramDelta(peer, before, { model: result.model, layout: syncLayout(before.layout, result.model, ops) });
      Y.applyUpdate(server, Y.encodeStateAsUpdate(peer, vector));
    }
    const disk = projectedCollaborationFiles(server, { kind: 'diagram', slug: 'mapa' });
    const records: Persisted = new Map([[ROOM, { updates: [Y.encodeStateAsUpdate(server)], baseline: disk }]]);

    const h = await host(disk, records);
    await h.join('A');
    expect(h.appended).toHaveLength(1);
    expect(h.repairTransactions).toBe(1);
    await expectConverged(h);
    expect(new Set(h.reported.map((repair) => repair.kind))).toEqual(new Set(['cycle', 'edge', 'order']));

    const again = await host(disk, records);
    await again.join('B');
    expect(again.appended).toEqual([]);
    expectRawInvariants(again.doc);
  });
});

describe('depth: concurrent valid moves cannot build a tree the file format refuses', () => {
  it('two moves that nest 21 and 15 levels deep are both accepted; the host detaches the 32nd level for everyone', async () => {
    const model = emptyModel();
    const nodes: DiagramSnapshot['layout']['nodes'] = {};
    const add = (id: string, parentId?: string) => {
      model.elements[id] = { kind: 'group', id, ...(parentId ? { parentId } : {}) };
      model.order.push(id);
      nodes[id] = { x: 0, y: 0 };
    };
    for (let i = 0; i < 20; i++) add(`X${i}`, i ? `X${i - 1}` : undefined);
    for (let i = 0; i < 14; i++) add(`Y${i}`, i ? `Y${i - 1}` : undefined);
    add('G');
    const h = await host(files({ model, layout: { nodes, edges: {} } }));
    const [a, b] = await h.join('A', 'B');
    a!.edit([{ op: 'move_to_group', id: 'X0', parentId: 'G' }]);
    b!.edit([{ op: 'move_to_group', id: 'G', parentId: 'Y13' }]);
    await h.send(a!);
    await h.send(b!);
    h.receiveAll();
    expect([a!.closed, b!.closed, a!.errors, b!.errors]).toEqual([null, null, [], []]);
    const server = await expectConverged(h);
    expect(parentOf(server, 'X0')).toBe('G');
    expect(parentOf(server, 'G')).toBe('Y13');
    expect(parentOf(server, 'X17')).toBeUndefined();
    expect(parentOf(server, 'X18')).toBe('X17');
    expect(parseDiagramJson((await h.adapter.read(DIAGRAM))!).diagnostics).toEqual([]);
  });

  it('a 32-level trap: moving a node under the deepest group is accepted and lands at the top level', async () => {
    const ops: DiagramOp[] = [{ op: 'add_node', id: 'API' }];
    for (let i = 0; i < 32; i++) ops.push({ op: 'add_group', id: `L${i}`, ...(i ? { parentId: `L${i - 1}` } : {}) });
    const built = applyOps(emptyModel(), ops);
    if (!built.ok) throw new Error(built.error.message);
    const h = await host(files({ model: built.model, layout: { nodes: {}, edges: {} } }));
    const [a] = await h.join('A', 'B');
    a!.edit([{ op: 'move_to_group', id: 'API', parentId: 'L31' }]);
    // The actor's canvas shows what the host will make of its edit right away, not one round trip later.
    expect(parentOf(a!.view, 'API')).toBeUndefined();
    await h.send(a!);
    h.receiveAll();
    expect([a!.closed, a!.errors]).toEqual([null, []]);
    const server = await expectConverged(h);
    expect(parentOf(server, 'API')).toBeUndefined();
    expect(parentOf(server, 'L31')).toBe('L30');
  });
});

describe('an external write during a session (agent, CLI, checkout)', () => {
  it('is merged into the room like on open: both changes reach the disk and every tab, and projection goes on', async () => {
    const h = await host(files(mapa()));
    const [a, b] = await h.join('A', 'B');
    a!.edit([{ op: 'update', id: 'API', set: { label: 'Da sessão' } }]);
    await h.send(a!);
    // The agent edits the file before the debounced projection wrote the guest's edit.
    const agent = deserializeDiagram(await h.adapter.read(DIAGRAM), await h.adapter.read(LAYOUT)).snapshot;
    const result = applyOps(agent.model, [{ op: 'add_node', id: 'Agente' }, { op: 'update', id: 'DB', set: { label: 'Banco' } }]);
    if (!result.ok) throw new Error(result.error.message);
    const written = files({ model: result.model, layout: agent.layout });
    await h.adapter.write(DIAGRAM, written[DIAGRAM]!);
    await h.flush();
    h.receiveAll();
    const server = await expectConverged(h);
    expect(server.model.elements.API!.label).toBe('Da sessão');
    expect(server.model.elements.DB!.label).toBe('Banco');
    expect(own(server.model.elements, 'Agente')).toBeTruthy();

    // Persisted with the room, and the next edit still reaches the disk.
    const replay = new Y.Doc();
    for (const update of h.records.get(ROOM)!.updates) Y.applyUpdate(replay, update);
    expect(own(readCollaborativeDiagram(replay)!.model.elements, 'Agente')).toBeTruthy();
    b!.edit([{ op: 'update', id: 'Cache', set: { label: 'Depois' } }]);
    await h.send(b!);
    h.receiveAll();
    await expectConverged(h);
    expect(await h.adapter.read(DIAGRAM)).toContain('"label": "Depois"');
  });

  it('keeps a file with errors (a merge in progress) on disk and does not project over it', async () => {
    const h = await host(files(mapa()));
    const [a] = await h.join('A');
    a!.edit([{ op: 'update', id: 'API', set: { label: 'Da sessão' } }]);
    await h.send(a!);
    await h.adapter.write(DIAGRAM, '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> main\n');
    await h.flush();
    expect(await h.adapter.read(DIAGRAM)).toContain('<<<<<<<');
  });
});

describe('shutdown', () => {
  it('closes every peer and writes the pending projections of every room before it resolves', async () => {
    const h = await host(files(mapa()));
    const [a] = await h.join('A');
    a!.edit([{ op: 'update', id: 'API', set: { label: 'Antes de sair' } }]);
    await h.send(a!);
    // No timer runs: the debounced projection has not written yet.
    expect(await h.adapter.read(DIAGRAM)).not.toContain('Antes de sair');
    await h.rooms.shutdown();
    expect(await h.adapter.read(DIAGRAM)).toContain('"label": "Antes de sair"');
    expect(a!.closed).toBe(1001);
    // Nothing is left to run afterwards.
    await h.rooms.receive(ROOM, a!.peer, collaborationPacket(COLLAB_UPDATE, Y.encodeStateAsUpdate(a!.doc)));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('bounds on the raw doc', () => {
  const bulk = (doc: Y.Doc, count: number, prefix = 'h') => {
    doc.transact(() => {
      const elements = doc.getMap<unknown>('elements');
      for (let i = 0; i < count; i++) {
        const record = new Y.Map<unknown>();
        record.set('kind', 'node');
        record.set('id', `${prefix}${i}`);
        elements.set(`${prefix}${i}`, record);
      }
    });
  };

  it(`refuses an update that takes the doc past ${COLLAB_MAX_ELEMENTS} raw elements: nothing is applied, saved or delivered`, async () => {
    const h = await host(files(mapa()));
    const [a, b] = await h.join('A', 'B');
    // Two updates under the packet limit: the first fits, the second would pass the cap.
    bulk(a!.doc, COLLAB_MAX_ELEMENTS / 2, 'h');
    await h.send(a!);
    h.receiveAll();
    const before = rawState(h.doc);
    const appended = h.appended.length;
    bulk(a!.doc, COLLAB_MAX_ELEMENTS / 2, 'k');
    await h.send(a!);
    expect(a!.inbox.map((packet) => packet[0])).toEqual([COLLAB_ERROR]);
    a!.receive();
    expect(a!.errors[0]).toContain('limite de 20000 elementos');
    expect(a!.closed).toBe(1011);
    expect(h.appended.length).toBe(appended);
    expect(rawState(h.doc)).toEqual(before);
    expect(b!.inbox).toEqual([]);
  });

  const huge = () => {
    const model = emptyModel();
    for (let i = 0; i < COLLAB_MAX_ELEMENTS + 5000; i++) {
      model.elements[`n${i}`] = { kind: 'node', id: `n${i}` };
      model.order.push(`n${i}`);
    }
    return files({ model, layout: { nodes: {}, edges: {} } });
  };

  it(`refuses to open a room for a valid diagram over ${COLLAB_MAX_ELEMENTS} elements: nothing is trimmed, saved or written`, async () => {
    const disk = huge();
    // The single-user parser takes it whole, so the refusal is the only thing that keeps the room from trimming it.
    const parsed = deserializeDiagram(disk[DIAGRAM]!, disk[LAYOUT]!);
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(parsed.snapshot.model.order).toHaveLength(COLLAB_MAX_ELEMENTS + 5000);
    const h = await host(disk);
    const tab = new Tab('A');
    await expect(h.rooms.join(ROOM, tab.peer)).rejects.toThrow(`passa do limite de ${COLLAB_MAX_ELEMENTS} elementos`);
    tab.receive();
    // Told to the guest (the host then closes the socket and logs it).
    expect(tab.errors).toEqual([expect.stringContaining('não pode ser editado nesta sessão')]);
    await h.flush();
    expect(Object.fromEntries(h.adapter.files)).toEqual(disk);
    expect([...h.records.keys()]).toEqual([]);
    expect(h.appended).toEqual([]);
  }, 60_000);

  it('refuses a persisted room whose file on disk grew past the cap, without importing or writing it', async () => {
    const doc = new Y.Doc();
    seedCollaborativeDiagram(doc, mapa());
    const records: Persisted = new Map([[ROOM, { updates: [Y.encodeStateAsUpdate(doc)], baseline: files(mapa()) }]]);
    const disk = huge();
    const h = await host(disk, records);
    await expect(h.join('A')).rejects.toThrow('limite');
    await h.flush();
    expect(Object.fromEntries(h.adapter.files)).toEqual(disk);
    expect(records.get(ROOM)!.updates).toHaveLength(1);
  }, 60_000);

  it('tries the next update against the room doc, not against the refused one', async () => {
    const h = await host(files(mapa()));
    const [a, b] = await h.join('A', 'B');
    bulk(a!.doc, COLLAB_MAX_ELEMENTS / 2, 'h');
    await h.send(a!);
    h.receiveAll();
    bulk(a!.doc, COLLAB_MAX_ELEMENTS / 2, 'k');
    await h.send(a!);
    expect(a!.closed).toBe(1011);
    b!.receive();
    b!.edit([{ op: 'update', id: 'API', set: { label: 'Depois da recusa' } }]);
    await h.send(b!);
    expect([b!.closed, b!.errors]).toEqual([null, []]);
    expect(readCollaborativeDiagram(h.doc)!.model.elements.API!.label).toBe('Depois da recusa');
  }, 60_000);

  it('repairs an update against what an external write merged into the room', async () => {
    const h = await host(files(mapa()));
    const [a, b] = await h.join('A', 'B');
    // An agent removes G1; A's next edit makes the room project, which merges the removal and sends it out.
    const disk = deserializeDiagram(await h.adapter.read(DIAGRAM), await h.adapter.read(LAYOUT)).snapshot;
    const removed = applyOps(disk.model, [{ op: 'remove', id: 'G1' }]);
    if (!removed.ok) throw new Error(removed.error.message);
    await h.adapter.write(DIAGRAM, files({ model: removed.model, layout: disk.layout })[DIAGRAM]!);
    a!.edit([{ op: 'update', id: 'API', set: { label: 'x' } }]);
    await h.send(a!);
    await h.flush();
    a!.receive();
    // B has not seen the removal yet and moves Cache into G1: the room's repair must see G1 gone.
    b!.edit([{ op: 'move_to_group', id: 'Cache', parentId: 'G1' }]);
    await h.send(b!);
    h.receiveAll();
    const server = await expectConverged(h);
    expect(own(server.model.elements, 'G1')).toBeUndefined();
    expect(server.model.elements.Cache!.parentId).toBeUndefined();
  });

  it('keeps a room bloated before the bound openable: it opens trimmed to the cap and accepts edits', async () => {
    const doc = new Y.Doc();
    seedCollaborativeDiagram(doc, mapa());
    bulk(doc, COLLAB_MAX_ELEMENTS + 500);
    const disk = files(mapa());
    const records: Persisted = new Map([[ROOM, { updates: [Y.encodeStateAsUpdate(doc)], baseline: disk }]]);
    const h = await host(disk, records);
    const [a] = await h.join('A');
    expect(h.doc.getMap('elements').size).toBe(COLLAB_MAX_ELEMENTS);
    expect(a!.view!.model.order).toHaveLength(COLLAB_MAX_ELEMENTS);
    a!.edit([{ op: 'update', id: 'API', set: { label: 'Ainda editável' } }]);
    await h.send(a!);
    expect([a!.closed, a!.errors]).toEqual([null, []]);
    expect(readCollaborativeDiagram(h.doc)!.model.elements.API!.label).toBe('Ainda editável');
    expect(h.reported.map((repair) => repair.kind)).toContain('limit');
  }, 60_000);
});

describe('fuzz: concurrent legit edits (fuzz2 from the review, through the real room)', () => {
  // COLLAB_FUZZ_TRIALS / COLLAB_FUZZ_SEED run it longer by hand.
  it('leaves a raw doc that satisfies the structural rules, identical on every tab, the host and the disk', async () => {
    let state = Number(process.env.COLLAB_FUZZ_SEED ?? 7);
    const rand = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
    const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
    const GROUPS = ['toString', 'constructor', 'G1', 'g1', 'Ä', 'A', 'b', 'B', '10', '9'];
    const NAMES = [...GROUPS, 'N0', 'N1', 'N2', 'N3', 'N4', 'N5', 'Nó 3'];

    const randomOps = (view: DiagramSnapshot): DiagramOp[] => {
      const ids = view.model.order;
      const groups = ids.filter((id) => view.model.elements[id]!.kind === 'group');
      const free = NAMES.filter((id) => !own(view.model.elements, id));
      const r = rand();
      if (r < 0.4 && groups.length && ids.length) return [{ op: 'move_to_group', id: pick(ids), parentId: rand() < 0.1 ? null : pick(groups) }];
      if (r < 0.55 && ids.length) return [{ op: 'remove', id: pick(ids) }];
      if (r < 0.75 && ids.length) return [{ op: 'connect', from: pick(ids), to: pick(ids) }];
      if (r < 0.9 && free.length) return [rand() < 0.5 ? { op: 'add_group', id: pick(free) } : { op: 'add_node', id: pick(free), ...(groups.length && rand() < 0.5 ? { parentId: pick(groups) } : {}) }];
      return ids.length ? [{ op: 'update', id: pick(ids), set: { label: `L${Math.floor(rand() * 9)}` } }] : [];
    };

    let repaired = 0;
    for (let trial = 0; trial < Number(process.env.COLLAB_FUZZ_TRIALS ?? 40); trial++) {
      const model = emptyModel();
      const nodes: DiagramSnapshot['layout']['nodes'] = {};
      for (const id of GROUPS) { model.elements[id] = { kind: 'group', id }; model.order.push(id); nodes[id] = { x: 0, y: 0 }; }
      for (let i = 0; i < 6; i++) { const id = `N${i}`; model.elements[id] = { kind: 'node', id, parentId: pick(GROUPS) }; model.order.push(id); nodes[id] = { x: 1, y: 1 }; }
      const h = await host(files({ model, layout: { nodes, edges: {} } }));
      const tabs = await h.join(...Array.from({ length: 2 + Math.floor(rand() * 3) }, (_, i) => `T${i}`));
      for (let round = 0; round < 3; round++) {
        // Every tab edits its own view offline, then the updates reach the host in a random order, some tabs
        // receiving part of their inbox (and editing again) in between.
        for (const tab of tabs) for (let k = 1 + Math.floor(rand() * 4); k > 0; k--) {
          const ops = randomOps(tab.view!);
          if (ops.length && applyOps(tab.view!.model, ops).ok) tab.edit(ops);
        }
        for (const tab of [...tabs].sort(() => rand() - 0.5)) {
          await h.send(tab);
          const other = pick(tabs);
          other.receive(Math.floor(rand() * 3));
          const ops = randomOps(other.view!);
          if (rand() < 0.3 && ops.length && applyOps(other.view!.model, ops).ok) other.edit(ops);
        }
        for (const tab of tabs) await h.send(tab);
        h.receiveAll();
        for (const tab of tabs) expect(tab.closed, `trial ${trial}: ${tab.name} was refused`).toBeNull();
        await expectConverged(h);
      }
      repaired += h.repairTransactions;
    }
    // The storm really produced merged states that needed repairs.
    expect(repaired).toBeGreaterThan(10);
  }, 120_000);
});
