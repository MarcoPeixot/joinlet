import { emptyModel } from '@strukt/core';
import type { DiagramModel } from '@strukt/core';
import { newThread } from '@strukt/workspace';
import type { CommentAnchor } from '@strukt/workspace';
import { describe, expect, it } from 'vitest';
import { anchorPoint, placeMarkers, stackKey } from './anchorPoint';

const model: DiagramModel = { ...emptyModel(), elements: { A: { kind: 'node', id: 'A' } as never, B: { kind: 'node', id: 'B' } as never }, order: ['A', 'B'], edges: [{ id: 'e1', from: 'A', to: 'B', connector: 'arrow' } as never] };
const boxes: Record<string, { x: number; y: number; width: number; height: number }> = { A: { x: 0, y: 0, width: 100, height: 40 }, B: { x: 300, y: 200, width: 100, height: 40 } };
const boxOf = (id: string) => (Object.hasOwn(boxes, id) ? boxes[id]! : null);
const thread = (id: string, anchor: CommentAnchor) => newThread({ id, anchor, message: { id: `${id}m`, owner: 'i:a', author: { name: 'Ana', color: '#3972dc' }, text: 'oi', at: 1 } });

describe('anchorPoint', () => {
  it('puts a node\'s marker at its top-right corner, a connection\'s at its middle and a point where it is', () => {
    expect(anchorPoint({ type: 'node', id: 'A' }, model, boxOf)).toEqual({ x: 100, y: 0 });
    expect(anchorPoint({ type: 'edge', id: 'e1' }, model, boxOf)).toEqual({ x: 200, y: 120 });
    expect(anchorPoint({ type: 'point', x: -5, y: 7.5 }, model, boxOf)).toEqual({ x: -5, y: 7.5 });
  });
  it('has no spot for what is gone or not measured yet, nor for a passage of a doc', () => {
    expect(anchorPoint({ type: 'node', id: 'Fantasma' }, model, boxOf)).toBeNull();
    expect(anchorPoint({ type: 'node', id: 'constructor' }, model, boxOf)).toBeNull();
    expect(anchorPoint({ type: 'edge', id: 'nope' }, model, boxOf)).toBeNull();
    expect(anchorPoint({ type: 'node', id: 'A' }, model, () => null)).toBeNull();
    expect(anchorPoint({ type: 'text', quote: 'x', prefix: '', suffix: '', from: 0 }, model, boxOf)).toBeNull();
  });
});

describe('placeMarkers', () => {
  it('lines up the markers of one node side by side and drops the ones with no spot', () => {
    const placed = placeMarkers([thread('t1', { type: 'node', id: 'A' }), thread('t2', { type: 'node', id: 'A' }), thread('t3', { type: 'node', id: 'B' }), thread('t4', { type: 'node', id: 'X' })], model, boxOf, 26);
    expect(placed.map((entry) => [entry.thread.id, entry.x, entry.y])).toEqual([['t1', 100, 0], ['t2', 126, 0], ['t3', 400, 200]]);
  });
  it('stacks points that are the same to the pixel', () => {
    expect(stackKey({ type: 'point', x: 10.2, y: 5 })).toBe(stackKey({ type: 'point', x: 9.8, y: 5.4 }));
    expect(stackKey({ type: 'point', x: 10, y: 5 })).not.toBe(stackKey({ type: 'node', id: '10' }));
  });
});
