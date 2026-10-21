import { describe, expect, it } from 'vitest';
import { enterMarks, MAX_STAGGERED, STAGGER_MS } from './enter';

const ids = (n: number, prefix = 'n') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('enterMarks', () => {
  it('staggers added nodes 40 ms apart', () => {
    const marks = enterMarks({ nodes: ['a'], edges: [] }, { nodes: ['a', 'b', 'c', 'd'], edges: [] })!;
    expect(marks.nodes).toEqual({ b: 0, c: STAGGER_MS, d: 2 * STAGGER_MS });
  });
  it('caps the staggered ones: the rest appear together', () => {
    const marks = enterMarks({ nodes: ['a'], edges: [] }, { nodes: ['a', ...ids(30)], edges: [] })!;
    const delays = Object.values(marks.nodes);
    expect(delays).toHaveLength(30);
    expect(delays.filter((d) => d > 0)).toHaveLength(MAX_STAGGERED - 1);
    expect(Math.max(...delays)).toBe((MAX_STAGGERED - 1) * STAGGER_MS);
  });
  it('a single added node needs no stagger, but a new edge draws', () => {
    expect(enterMarks({ nodes: ['a'], edges: [] }, { nodes: ['a', 'b'], edges: [] })!.nodes).toEqual({});
    const marks = enterMarks({ nodes: ['a', 'b'], edges: [] }, { nodes: ['a', 'b'], edges: ['e1'] })!;
    expect([...marks.edges]).toEqual(['e1']);
  });
  it('only edges created in the commit draw', () => {
    const marks = enterMarks({ nodes: ['a', 'b'], edges: ['e1'] }, { nodes: ['a', 'b'], edges: ['e1', 'e2'] })!;
    expect([...marks.edges]).toEqual(['e2']);
  });
  it('is null when nothing entered, when things only left, or for a different document', () => {
    expect(enterMarks({ nodes: ['a'], edges: ['e'] }, { nodes: ['a'], edges: ['e'] })).toBeNull();
    expect(enterMarks({ nodes: ['a', 'b'], edges: ['e'] }, { nodes: ['a'], edges: [] })).toBeNull();
    expect(enterMarks({ nodes: ['a', 'b'], edges: [] }, { nodes: ['x', 'y', 'z'], edges: [] })).toBeNull();
  });
  it('hostile ids are plain keys', () => {
    const marks = enterMarks({ nodes: ['a'], edges: [] }, { nodes: ['a', 'constructor', 'toString'], edges: [] })!;
    expect(marks.nodes.constructor).toBe(0);
    expect(marks.nodes.toString).toBe(STAGGER_MS);
  });
});
