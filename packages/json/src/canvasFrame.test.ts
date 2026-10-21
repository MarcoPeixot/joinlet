import { expect, it } from 'vitest';
import { applyOps, emptyModel, canvasFrames } from '@strukt/core';
import { parseDiagramJson } from './parse';
import { printDiagramJson } from './print';
it('round-trips multiple named diagram areas through the canonical file format', () => {
  const made = applyOps(emptyModel(), [{ op: 'add_group', id: 'Consulta', canvasFrame: true }, { op: 'add_node', id: 'API', parentId: 'Consulta' }, { op: 'add_group', id: 'Ingestão', canvasFrame: true }]);
  if (!made.ok) throw Error(made.error.message);
  const parsed = parseDiagramJson(printDiagramJson(made.model));
  expect(parsed.diagnostics).toEqual([]); expect(canvasFrames(parsed.model)).toEqual(['Consulta', 'Ingestão']);
});
