import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyOps, emptyLayout, emptyModel, syncLayout } from '@strukt/core';
import type { DiagramOp } from '@strukt/core';
import { createMemoryAdapter } from './storage';
import { applyCollaborativeDiagramDelta, readCollaborativeDiagram } from './collaboration';
import { importCollaborationFiles, projectedCollaborationFiles, readCollaborationFiles, seedCollaborationFiles } from './collaborationFiles';
import { deserializeDiagram, serializeDiagram } from './diagram';

describe('collaborative files', () => {
  it('projects a diagram edit into valid portable JSON and layout files', async () => {
    const item = { kind: 'diagram' as const, slug: 'sample' };
    const adapter = createMemoryAdapter();
    const files = await readCollaborationFiles(adapter, item);
    const doc = new Y.Doc();
    seedCollaborationFiles(doc, item, files);
    const before = { model: emptyModel(), layout: emptyLayout() };
    applyCollaborativeDiagramDelta(doc, before, {
      model: { ...before.model, elements: { A: { id: 'A', kind: 'node', label: 'API' } }, order: ['A'] },
      layout: { nodes: { A: { x: 20, y: 30 } }, edges: {} },
    });
    const projected = projectedCollaborationFiles(doc, item);
    const parsed = deserializeDiagram(projected['diagrams/sample.strukt.json']!, projected['diagrams/sample.layout.json']!);
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(parsed.snapshot.model.elements.A.label).toBe('API');
    expect(parsed.snapshot.layout.nodes.A).toEqual({ x: 20, y: 30 });
  });

  it('reports an external Markdown conflict instead of replacing concurrent text', () => {
    const item = { kind: 'doc' as const, slug: 'notes' };
    const doc = new Y.Doc();
    seedCollaborationFiles(doc, item, { 'docs/notes.md': 'one' });
    doc.getText('content').insert(3, ' local');
    expect(() => importCollaborationFiles(doc, item, { 'docs/notes.md': 'one' }, { 'docs/notes.md': 'one external' })).toThrow('simultaneamente');
    expect(doc.getText('content').toString()).toBe('one local');
  });

  it('projects every element into .strukt.json after concurrent moves close a parent cycle, and never writes hostile ids', () => {
    const item = { kind: 'diagram' as const, slug: 'mapa' };
    const start = applyOps(emptyModel(), [
      { op: 'add_group', id: 'G1' }, { op: 'add_group', id: 'G2' }, { op: 'add_node', id: 'API', parentId: 'G1' }, { op: 'add_node', id: 'DB' },
      { op: 'connect', from: 'API', to: 'DB' },
    ]);
    if (!start.ok) throw new Error(start.error.message);
    const { json, layout } = serializeDiagram({ model: start.model, layout: { nodes: { G1: { x: 0, y: 0 }, G2: { x: 400, y: 0 }, API: { x: 20, y: 40 }, DB: { x: 800, y: 0 } }, edges: {} } });
    const server = new Y.Doc();
    seedCollaborationFiles(server, item, { 'diagrams/mapa.strukt.json': json, 'diagrams/mapa.layout.json': layout });
    const seed = Y.encodeStateAsUpdate(server);
    const peer = (ops: DiagramOp[]) => {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, seed);
      const vector = Y.encodeStateVector(doc);
      const before = readCollaborativeDiagram(doc)!;
      const result = applyOps(before.model, ops);
      if (!result.ok) throw new Error(result.error.message);
      applyCollaborativeDiagramDelta(doc, before, { model: result.model, layout: syncLayout(before.layout, result.model, ops) });
      return Y.encodeStateAsUpdate(doc, vector);
    };
    Y.applyUpdate(server, peer([{ op: 'move_to_group', id: 'G1', parentId: 'G2' }]));
    Y.applyUpdate(server, peer([{ op: 'move_to_group', id: 'G2', parentId: 'G1' }]));
    server.transact(() => {
      const impostor = new Y.Map<unknown>();
      impostor.set('kind', 'node');
      impostor.set('id', 'DB');
      server.getMap<unknown>('elements').set('Impostor', impostor);
      const proto = new Y.Map<unknown>();
      proto.set('kind', 'node');
      server.getMap<unknown>('elements').set('__proto__', proto);
      (server.getMap<unknown>('positions').get('DB') as Y.Map<unknown>).set('x', Number.NaN);
    });

    const repairs: string[] = [];
    const projected = projectedCollaborationFiles(server, item, (found) => repairs.push(...found.map((repair) => repair.kind)));
    const text = projected['diagrams/mapa.strukt.json']!;
    const parsed = deserializeDiagram(text, projected['diagrams/mapa.layout.json']!);
    expect(parsed.diagnostics).toEqual([]);
    expect(Object.keys(parsed.snapshot.model.elements).sort()).toEqual(['API', 'DB', 'G1', 'G2', 'Impostor']);
    expect(parsed.snapshot.model.elements.G1!.parentId).toBe('G2');
    expect(parsed.snapshot.model.elements.API!.parentId).toBe('G1');
    expect(parsed.snapshot.model.edges.map((edge) => edge.id)).toEqual(['API→DB']);
    expect(text.match(/"id": "DB"/g)).toHaveLength(1);
    expect(`${text}${projected['diagrams/mapa.layout.json']}`).not.toMatch(/__proto__|null/);
    expect(Object.keys(parsed.snapshot.layout.nodes).sort()).toEqual(['API', 'G1', 'G2']);
    expect(repairs.sort()).toEqual(['cycle', 'id', 'position', 'reserved']);
  });

  it('keeps long valid text whole through the seed, the projection and an agent edit imported from disk', () => {
    const item = { kind: 'diagram' as const, slug: 'mapa' };
    const model = emptyModel();
    const link = `https://grafana.example.com/d/abc?${'var-x=1&'.repeat(300)}`;
    model.elements = { API: { kind: 'node', id: 'API', description: 'ADR '.repeat(6000), link }, DB: { kind: 'node', id: 'DB' } };
    model.order = ['API', 'DB'];
    const before = serializeDiagram({ model, layout: { nodes: { API: { x: 0, y: 0 } }, edges: {} } });
    const disk = { 'diagrams/mapa.strukt.json': before.json, 'diagrams/mapa.layout.json': before.layout };
    const doc = new Y.Doc();
    seedCollaborationFiles(doc, item, disk);
    // Byte-identical: opening a room never schedules a rewrite of valid text.
    expect(projectedCollaborationFiles(doc, item)).toEqual(disk);
    const agent = serializeDiagram({ model: { ...model, elements: { ...model.elements, DB: { kind: 'node', id: 'DB', description: 'x'.repeat(30_000) } } }, layout: { nodes: { API: { x: 0, y: 0 } }, edges: {} } });
    const edited = { 'diagrams/mapa.strukt.json': agent.json, 'diagrams/mapa.layout.json': agent.layout };
    importCollaborationFiles(doc, item, disk, edited);
    expect(readCollaborativeDiagram(doc)!.model.elements.DB!.description).toHaveLength(30_000);
    expect(projectedCollaborationFiles(doc, item)).toEqual(edited);
  });
});
