import { describe, expect, it } from 'vitest';
import { applyOps, emptyModel } from '@strukt/core';
import type { DiagramOp } from '@strukt/core';
import { emptySyncState, parseSyncState, printSyncState } from './syncState';

const model = (ops: DiagramOp[]) => {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
};
const base = model([{ op: 'add_group', id: 'vpc', label: 'VPC' }, { op: 'add_node', id: 'web', parentId: 'vpc', tech: 'aws_instance' }, { op: 'add_node', id: 'db', shape: 'cylinder' }, { op: 'connect', from: 'web', to: 'db', label: 'SQL' }]);

describe('sync state', () => {
  it('round-trips and prints the same bytes', () => {
    const state = { ...emptySyncState(), sources: { infra: { diagram: 'infra', base }, api: { diagram: 'api', base: emptyModel() } } };
    const text = printSyncState(state);
    expect(text.endsWith('\n')).toBe(true);
    const back = parseSyncState(text);
    expect(back.warnings).toEqual([]);
    expect(Object.keys(back.state.sources)).toEqual(['api', 'infra']);
    expect(back.state.sources.infra!.base.order).toEqual(base.order);
    expect(back.state.sources.infra!.base.elements.web).toMatchObject({ parentId: 'vpc', tech: 'aws_instance' });
    expect(back.state.sources.infra!.base.edges.map((e) => `${e.from}>${e.to}:${e.label}`)).toEqual(['web>db:SQL']);
    expect(printSyncState(back.state)).toBe(text);
  });

  it('has no spans or diagnostics in what it reads back', () => {
    const back = parseSyncState(printSyncState({ ...emptySyncState(), sources: { infra: { diagram: 'infra', base } } }));
    for (const el of Object.values(back.state.sources.infra!.base.elements)) expect(el.span).toBeUndefined();
    expect(back.state.sources.infra!.base.diagnostics).toEqual([]);
  });

  it('treats a missing file as an empty state', () => {
    expect(parseSyncState(null)).toEqual({ state: emptySyncState(), warnings: [] });
  });

  it('degrades with a warning on damaged files and entries', () => {
    expect(parseSyncState('{oops').warnings[0]).toMatch(/JSON inválido/);
    expect(parseSyncState('[]').warnings[0]).toMatch(/formato/);
    const text = JSON.stringify({ version: 1, sources: { good: { diagram: 'a', base: { version: 1, nodes: [{ id: 'x' }], connections: [] } }, bad: { diagram: 'a', base: 'nope' }, '../x': { diagram: 'a', base: {} }, worse: { diagram: 'a', base: { version: 1, nodes: 5 } } } });
    const result = parseSyncState(text);
    expect(Object.keys(result.state.sources)).toEqual(['good']);
    expect(result.warnings.join('\n')).toContain('"bad"');
    expect(result.warnings.join('\n')).toContain('"worse"');
  });

  it('never lets __proto__ become a source', () => {
    const result = parseSyncState('{"version":1,"sources":{"__proto__":{"diagram":"a","base":{"version":1,"nodes":[],"connections":[]}}}}');
    expect(Object.keys(result.state.sources)).toEqual([]);
    expect(({} as Record<string, unknown>).diagram).toBeUndefined();
  });
});
