import { describe, expect, it } from 'vitest';
import { addCanvasDiagram, applyOps, canvasFrames, computeRects, diffModels, emptyLayout, emptyModel, splitCanvasDiagram, syncLayout } from './index';
import type { DiagramOp } from './index';
const make = (ops: DiagramOp[]) => { const r = applyOps(emptyModel(), ops); if (!r.ok) throw Error(r.error.message); return r.model; };
const source = make([{ op: 'add_group', id: 'Dados' }, { op: 'add_node', id: 'Banco', parentId: 'Dados', icon: 'postgresql', description: 'Banco de vetores' }, { op: 'add_node', id: 'API' }, { op: 'connect', from: 'API', to: 'Banco', label: 'consulta' }]);
const layout = { nodes: { Banco: { x: 300, y: 100 }, API: { x: 20, y: 100 } }, edges: {} };
describe('multiple diagrams on one canvas', () => {
  it('copies nested groups, labels, connections and style with collision-safe ids, without moving existing content', () => {
    const first = addCanvasDiagram(emptyModel(), emptyLayout(), source, layout, 'Consulta');
    const a = applyOps(emptyModel(), first.ops); if (!a.ok) throw Error(a.error.message);
    const firstLayout = syncLayout(emptyLayout(), a.model, first.ops, first.positions);
    const second = addCanvasDiagram(a.model, firstLayout, source, layout, 'Consulta');
    const b = applyOps(a.model, second.ops); if (!b.ok) throw Error(b.error.message);
    const scene = syncLayout(firstLayout, b.model, second.ops, second.positions);
    expect(canvasFrames(b.model)).toHaveLength(2);
    expect(b.model.order.filter(id => b.model.elements[id]!.label === 'Banco')).toHaveLength(2);
    expect(b.model.edges).toHaveLength(2);
    expect(b.model.elements.Banco?.description).toBe('Banco de vetores');
    expect(scene.nodes.Banco).toEqual(firstLayout.nodes.Banco);
    const rects = computeRects(b.model, scene);
    expect(rects[second.frame]!.x).toBeGreaterThan(rects[first.frame]!.x + rects[first.frame]!.w + 100);
    const replay = applyOps(emptyModel(), diffModels(emptyModel(), b.model));
    expect(replay.ok && canvasFrames(replay.model)).toEqual(canvasFrames(b.model));
  });
  it('partitions into frames in a single atomic batch with shared boundary nodes duplicated visibly', () => {
    const split = splitCanvasDiagram(source, layout, [{ title: 'Consulta', elements: ['API', 'Dados'] }, { title: 'Persistência', elements: ['Dados'] }]);
    const result = applyOps(source, split.ops); if (!result.ok) throw Error(result.error.message);
    expect(canvasFrames(result.model)).toHaveLength(2);
    expect(result.model.order.filter(id => result.model.elements[id]?.label === 'Banco')).toHaveLength(2);
    expect(result.model.edges).toHaveLength(1);
    expect(source.order).toHaveLength(3);
  });
  it('refuses the frame property on a node and preserves it across ordinary model operations', () => {
    expect(applyOps(source, [{ op: 'update', id: 'API', set: { canvasFrame: true } }]).ok).toBe(false);
    expect(make([{ op: 'add_group', id: 'Consulta', canvasFrame: true }]).elements.Consulta).toMatchObject({ canvasFrame: true });
  });
});
