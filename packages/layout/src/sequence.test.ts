import { applyOps, computeRects, emptyModel, participantSize } from '@strukt/core';
import type { DiagramOp, NodeEl } from '@strukt/core';
import { expect, it } from 'vitest';
import { autoLayout } from './elk';
import { eraserRouter } from './eraserRouter';
import { sequenceMessages } from './sequence';

function build(ops: DiagramOp[]) {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

const ops: DiagramOp[] = [
  { op: 'add_node', id: 'Client', presentation: 'participant' },
  { op: 'add_node', id: 'API', presentation: 'participant' },
  { op: 'add_node', id: 'DB', presentation: 'participant' },
  { op: 'connect', from: 'Client', to: 'API', label: 'Request' },
  { op: 'connect', from: 'API', to: 'DB', label: 'Query' },
  { op: 'connect', from: 'DB', to: 'API', label: 'Rows', connector: '-->' },
  { op: 'connect', from: 'API', to: 'Client', label: 'Response', connector: '-->' },
];

it('places participants on one row, routes ordered messages horizontally and extends every lifeline', async () => {
  const model = build(ops), nodes = await autoLayout(model);
  expect(new Set(Object.values(nodes).map(box => box.y)).size).toBe(1);
  const rects = computeRects(model, { nodes, edges: {} });
  const messages = sequenceMessages(model, rects), routed = eraserRouter.route(model, rects);
  let previous = 0;
  for (const edge of model.edges) {
    const message = messages[edge.id]!;
    expect(message.points).toHaveLength(2);
    expect(message.points[0]![1]).toBe(message.points[1]![1]);
    expect(message.points[0]![1]).toBeGreaterThan(previous);
    expect(routed[edge.id]).toEqual(message.points);
    previous = message.points[0]![1];
  }
  for (const id of model.order) expect(rects[id]!.h).toBeGreaterThan(previous - rects[id]!.y);
  const moved = computeRects(model, { nodes: { ...nodes, API: { x: 450, y: 100 } }, edges: {} });
  const after = sequenceMessages(model, moved);
  const headerBottom = moved.API!.y + participantSize(model.elements.API as NodeEl, moved.API!.w).h;
  expect(after['Client→API']!.points[0]![1]).toBeGreaterThan(headerBottom);
  expect(after['Client→API']!.points[0]![1]).toBe(after['Client→API']!.points[1]![1]);
});

it('reorders messages and grows the lifeline when messages are appended', () => {
  const original = build(ops), layout = { nodes: { Client: { x: 0, y: 0 }, API: { x: 300, y: 0 }, DB: { x: 600, y: 0 } }, edges: {} };
  const changed = applyOps(original, [{ op: 'reorder', edges: [3, 0, 1, 2] }, ...Array.from({ length: 8 }, (): DiagramOp => ({ op: 'connect', from: 'API', to: 'DB', label: 'Next' }))]);
  if (!changed.ok) throw new Error(changed.error.message);
  const before = computeRects(original, layout), after = computeRects(changed.model, layout);
  expect(after.API!.h).toBeGreaterThan(before.API!.h);
  expect(sequenceMessages(changed.model, after)['API→Client']!.order).toBe(1);
});
