import { applyOps, emptyModel } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { hoverCardInfo } from './hoverCard';

function model() {
  const result = applyOps(emptyModel(), [
    { op: 'add_node', id: 'api', label: 'API' },
    { op: 'add_node', id: 'db', label: 'DB' },
    { op: 'add_node', id: 'constructor' },
    { op: 'connect', from: 'api', to: 'db' },
  ]);
  if (!result.ok) throw new Error(result.error.message);
  const m = structuredClone(result.model);
  Object.assign(m.elements.api!, { tech: 'Bun', description: 'x'.repeat(200) });
  m.elements.db!.link = 'doc:schema';
  return m;
}

describe('hoverCardInfo', () => {
  it('summarises tech, a trimmed description and the connection count', () => {
    const info = hoverCardInfo(model(), 'api')!;
    expect(info).toMatchObject({ title: 'API', tech: 'Bun', connections: 1 });
    expect(info.excerpt!.length).toBeLessThanOrEqual(120);
    expect(info.excerpt!.endsWith('…')).toBe(true);
  });
  it('flags doc links', () => {
    expect(hoverCardInfo(model(), 'db')).toMatchObject({ link: 'doc', connections: 1 });
  });
  it('is null for unknown ids but works for hostile names', () => {
    expect(hoverCardInfo(model(), 'nope')).toBeNull();
    expect(hoverCardInfo(model(), 'toString')).toBeNull();
    expect(hoverCardInfo(model(), 'constructor')).toMatchObject({ connections: 0 });
  });
});
