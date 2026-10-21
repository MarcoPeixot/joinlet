import { addCanvasDiagram, applyOps, computeRects, emptyLayout, emptyModel, syncLayout } from '@strukt/core';
import { expect, it } from 'vitest';
import { autoLayout } from './elk';
it('lays out complete diagram frames without interleaving their nodes', async () => {
  const source = applyOps(emptyModel(), [{ op: 'add_node', id: 'API' }, { op: 'add_node', id: 'Banco' }, { op: 'connect', from: 'API', to: 'Banco' }]);
  if (!source.ok) throw Error(source.error.message);
  let model = emptyModel(), layout = emptyLayout();
  const frames: string[] = [];
  for (const title of ['Consulta', 'Ingestão']) {
    const made = addCanvasDiagram(model, layout, source.model, { nodes: { API: { x: 0, y: 0 }, Banco: { x: 300, y: 0 } }, edges: {} }, title);
    const applied = applyOps(model, made.ops); if (!applied.ok) throw Error(applied.error.message);
    model = applied.model; layout = syncLayout(layout, model, made.ops, made.positions); frames.push(made.frame);
  }
  for (const direction of ['right', 'down'] as const) {
    const nodes = await autoLayout(model, {}, direction);
    const r = computeRects(model, { nodes, edges: {} });
    if (direction === 'right') expect(r[frames[1]!]!.x).toBeGreaterThan(r[frames[0]!]!.x + r[frames[0]!]!.w + 100);
    else expect(r[frames[1]!]!.y).toBeGreaterThan(r[frames[0]!]!.y + r[frames[0]!]!.h + 100);
  }
});
