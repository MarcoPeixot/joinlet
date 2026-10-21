import { expect } from 'vitest';
import { parseDiagramJson, printDiagramJson } from '@strukt/json';
import type { ImportResult } from './common';

/** The imported model prints to canonical JSON that re-parses without error diagnostics and keeps every element. */
export function expectValid(result: ImportResult): void {
  const json = printDiagramJson(result.model);
  const back = parseDiagramJson(json);
  expect(back.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  expect(back.model.order.length).toBe(result.model.order.length);
  expect(back.model.edges.length).toBe(result.model.edges.length);
}

export const messages = (result: ImportResult) => result.diagnostics.map((d) => d.message);
