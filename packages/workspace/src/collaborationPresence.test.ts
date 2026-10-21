import { describe, expect, it } from 'vitest';
import { PRESENCE_MAX_BYTES, sanitizePresence, sanitizePresenceState } from './collaborationPresence';

const rel = { type: { client: 123, clock: 4 }, tname: null as string | null, item: null, assoc: 0 };

describe('sanitizePresenceState', () => {
  it('keeps a document selection (Yjs relative positions) and a diagram pointer and selection', () => {
    const state = { doc: { anchor: { item: { client: 7, clock: 2 }, assoc: 0 }, head: { tname: 'content', assoc: -1 } }, diagram: { pointer: { x: 10.5, y: -20 }, nodes: ['API', 'Web App'] } };
    expect(sanitizePresenceState(state)).toEqual(state);
  });

  it('drops unknown fields and non-finite or absurd numbers', () => {
    expect(sanitizePresenceState({ evil: 1, diagram: { pointer: { x: Infinity, y: 1 }, nodes: ['A'], extra: true } })).toEqual({ diagram: { nodes: ['A'] } });
    expect(sanitizePresenceState({ diagram: { pointer: { x: 1e12, y: 0 } } })).toEqual({});
  });

  it('caps the node list and the id length', () => {
    const many = Array.from({ length: 80 }, (_, index) => `n${index}`);
    expect(sanitizePresenceState({ diagram: { nodes: many } })!.diagram!.nodes).toHaveLength(50);
    expect(sanitizePresenceState({ diagram: { nodes: ['x'.repeat(200), 'ok'] } })!.diagram!.nodes).toEqual(['ok']);
  });

  it('refuses relative positions that are not Yjs-shaped', () => {
    expect(sanitizePresenceState({ doc: { anchor: 'x', head: rel } })).toEqual({});
    expect(sanitizePresenceState({ doc: { anchor: { item: { client: 'a', clock: 1 } }, head: rel } })).toEqual({});
    expect(sanitizePresenceState({ doc: { anchor: { junk: 1 }, head: { junk: 2 } } })).toEqual({});
  });

  it('returns null for something that is not an object and for oversized state', () => {
    expect(sanitizePresenceState('x')).toBeNull();
    expect(sanitizePresenceState(null)).toBeNull();
    expect(sanitizePresenceState({ diagram: { nodes: Array.from({ length: 50 }, () => 'y'.repeat(100)) } })).toBeNull();
    expect(PRESENCE_MAX_BYTES).toBe(2000);
  });
});

describe('sanitizePresence', () => {
  it('accepts a name, a color and an optional client id and state', () => {
    expect(sanitizePresence({ name: 'Ana', color: '#3972dc', cid: 'ana-123456', state: { diagram: { nodes: ['A'] } } })).toEqual({ name: 'Ana', color: '#3972dc', cid: 'ana-123456', state: { diagram: { nodes: ['A'] } } });
    expect(sanitizePresence({ name: 'Ana', color: '#3972dc' })).toEqual({ name: 'Ana', color: '#3972dc' });
  });

  it('rejects an invalid identity but only drops an invalid state or cid', () => {
    expect(sanitizePresence({ name: 'x'.repeat(61), color: '#3972dc' })).toBeNull();
    expect(sanitizePresence({ name: '', color: '#3972dc' })).toBeNull();
    expect(sanitizePresence({ name: 'Ana', color: 'red' })).toBeNull();
    expect(sanitizePresence(null)).toBeNull();
    expect(sanitizePresence({ name: 'Ana', color: '#3972dc', cid: '<script>', state: 7 })).toEqual({ name: 'Ana', color: '#3972dc' });
  });
});
