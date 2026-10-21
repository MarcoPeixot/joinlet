import { applyOps, computeRects, emptyModel } from '@strukt/core';
import { expect, it } from 'vitest';
import { selectedDiagram } from './selection';
import { renderDiagramSvg } from './svg';

it('isolates a nested component at its real geometry, and a selected group includes only its own contents', () => {
  const result = applyOps(emptyModel(), [{ op: 'add_group', id: 'Grupo' }, { op: 'add_node', id: 'API', parentId: 'Grupo' }, { op: 'add_node', id: 'Banco', parentId: 'Grupo' }, { op: 'add_node', id: 'Fora' }, { op: 'connect', from: 'API', to: 'Banco' }, { op: 'connect', from: 'Banco', to: 'Fora' }]);
  if (!result.ok) throw new Error(result.error.message);
  const layout = { nodes: { API: { x: 100, y: 150 }, Banco: { x: 400, y: 150 }, Fora: { x: 800, y: 0 } }, edges: {} };
  const picked = selectedDiagram(result.model, layout, ['API']);
  expect(picked.model.order).toEqual(['API']);
  expect(picked.model.elements.API?.parentId).toBeUndefined();
  expect(picked.rects.API).toEqual(computeRects(result.model, layout).API);
  const group = selectedDiagram(result.model, layout, ['Grupo', 'API']);
  expect(group.model.order).toEqual(['Grupo', 'API', 'Banco']);
  expect(group.model.edges.map(edge => edge.id)).toEqual(['API→Banco']);
  const svg = renderDiagramSvg(group.model, group.layout, { theme: 'dark', rects: group.rects, background: false });
  expect(svg).not.toContain('>Fora<');
  expect(svg).not.toMatch(/undefined|NaN/);
});
