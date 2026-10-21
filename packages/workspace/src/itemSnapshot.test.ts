import { applyOps, emptyModel } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import type { DiagramSnapshot } from './diagram';
import { restoreItem, snapshotItem } from './itemSnapshot';
import { addItem, newWorkspace, removeItem, workspaceFiles } from './workspace';
import type { WorkspaceData } from './workspace';

function diagram(): DiagramSnapshot {
  const result = applyOps(emptyModel(), [{ op: 'add_node', id: 'API' }, { op: 'add_node', id: 'Banco', shape: 'cylinder' }, { op: 'connect', from: 'API', to: 'Banco' }]);
  if (!result.ok) throw new Error(result.error.message);
  return { model: result.model, layout: { nodes: { API: { x: 1, y: 2 }, Banco: { x: 300, y: 2 } }, edges: {} } };
}

function rich(): WorkspaceData {
  let data = newWorkspace('Loja', { title: 'Pedidos', snapshot: diagram() });
  data = addItem(data, 'diagram', 'Pagamentos').data;
  data = addItem(data, 'diagram', 'Estoque').data;
  data = addItem(data, 'doc', 'Notas').data;
  data = addItem(data, 'sketch', 'Rascunho').data;
  return {
    ...data,
    flows: { pagamentos: [{ id: 'f', name: 'Fluxo', steps: [] }] as never },
    perspectives: { pagamentos: [{ id: 'p', name: 'Riscos', tags: ['risco:alto'] }] },
    evidence: { pagamentos: { API: [{ path: 'src/a.ts' }] as never } },
    shared: { version: 1, entities: { e: { id: 'e' } }, views: { pagamentos: { API: 'e' }, estoque: {} } },
    concerns: [{ id: 'c1', diagram: 'pagamentos', message: 'x', status: 'open', createdAt: '2026-01-01' }, { id: 'c2', diagram: 'estoque', message: 'y', status: 'open', createdAt: '2026-01-01' }],
  };
}

describe('snapshotItem / restoreItem', () => {
  it('restores a deleted diagram byte-for-byte: manifest position, files, flows, evidence, shared views, concerns, board card', () => {
    const before = rich();
    const snap = snapshotItem(before, 'diagram', 'pagamentos')!;
    const removed = removeItem(before, 'diagram', 'pagamentos');
    expect(removed.manifest.diagrams.map((d) => d.slug)).toEqual(['pedidos', 'estoque']);
    const restored = restoreItem(removed, snap)!;
    expect(restored.manifest.diagrams.map((d) => d.slug)).toEqual(['pedidos', 'pagamentos', 'estoque']);
    // Concerns are appended (their relative order is not meaningful), so compare them apart.
    const { 'concerns.json': _a, ...restoredFiles } = workspaceFiles(restored);
    const { 'concerns.json': _b, ...beforeFiles } = workspaceFiles(before);
    expect(restoredFiles).toEqual(beforeFiles);
    expect(restored.flows?.pagamentos).toEqual(before.flows?.pagamentos);
    expect(restored.perspectives?.pagamentos).toEqual(before.perspectives?.pagamentos);
    expect(restored.evidence?.pagamentos).toEqual(before.evidence?.pagamentos);
    expect(restored.shared?.views.pagamentos).toEqual({ API: 'e' });
    expect(restored.concerns?.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(restored.board.cards.find((c) => c.id === 'diagram:pagamentos')).toEqual(before.board.cards.find((c) => c.id === 'diagram:pagamentos'));
  });

  it('restores docs and sketches', () => {
    const before = rich();
    for (const [kind, slug] of [['doc', 'notas'], ['sketch', 'rascunho']] as const) {
      const snap = snapshotItem(before, kind, slug)!;
      const restored = restoreItem(removeItem(before, kind, slug), snap)!;
      expect(workspaceFiles(restored)).toEqual(workspaceFiles(before));
    }
  });

  it('returns null for a missing item and refuses to overwrite a slug that is back in use', () => {
    const before = rich();
    expect(snapshotItem(before, 'diagram', 'nope')).toBeNull();
    expect(snapshotItem(before, 'diagram', 'constructor')).toBeNull();
    const snap = snapshotItem(before, 'doc', 'notas')!;
    expect(restoreItem(before, snap)).toBeNull();
  });

  it('keeps the snapshot independent of later edits to the data', () => {
    const before = rich();
    const snap = snapshotItem(before, 'diagram', 'pedidos')!;
    const later = removeItem(before, 'diagram', 'pedidos');
    expect(snap.content).toBe(before.diagrams.pedidos);
    expect(restoreItem(later, snap)!.diagrams.pedidos).toBe(before.diagrams.pedidos);
  });
});
