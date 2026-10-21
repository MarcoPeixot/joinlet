import { applyOps, emptyModel } from '@strukt/core';
import type { DiagramModel, DiagramOp } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { routeOrthogonal } from './route';
import { cachedRoute, orthogonalRouter, routeKey } from './router';

function build(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

const pair = build([
  { op: 'add_node', id: 'A' },
  { op: 'add_node', id: 'B' },
  { op: 'connect', from: 'A', to: 'B' },
]);
const rects = { A: { x: 0, y: 0, w: 100, h: 50 }, B: { x: 300, y: 200, w: 100, h: 50 } };

describe('router seam', () => {
  it('routeKey encodes both endpoint rects', () => {
    expect(routeKey({ x: 1, y: 2, w: 3, h: 4 }, { x: 5, y: 6, w: 7, h: 8 })).toBe('1,2,3,4|5,6,7,8');
  });

  it('orthogonalRouter matches routeOrthogonal and skips unpositioned endpoints', () => {
    expect(orthogonalRouter.route(pair, rects)).toEqual({ 'A→B': routeOrthogonal(rects.A, rects.B).points });
    expect(orthogonalRouter.route(pair, { A: rects.A })).toEqual({});
  });

  it('cachedRoute uses the cache only while both endpoints stay put', () => {
    const edge = pair.edges[0]!;
    const points: [number, number][] = [[1, 1], [2, 2]];
    const cache = { 'A→B': { points, key: routeKey(rects.A, rects.B) } };
    expect(cachedRoute(cache, edge, rects.A, rects.B)).toEqual(points);
    const moved = { ...rects.B, x: 320 };
    expect(cachedRoute(cache, edge, rects.A, moved)).toEqual(routeOrthogonal(rects.A, moved).points);
    expect(cachedRoute({}, edge, rects.A, rects.B)).toEqual(routeOrthogonal(rects.A, rects.B).points);
  });
});

it('attaches distributed ports to the circular outline instead of leaving a bounding-box gap',()=>{
 const model=build([{op:'add_node',id:'A',shape:'circle'},{op:'add_node',id:'B',shape:'circle'},{op:'connect',from:'A',to:'B'}]);
 const a={x:0,y:0,w:100,h:100},b={x:300,y:0,w:100,h:100};
 const points:[number,number][]=[[100,25],[200,25],[300,25]];
 const result=cachedRoute({'A→B':{key:routeKey(a,b),points}},model.edges[0]!,a,b,model);
 expect(Math.hypot(result[0]![0]-50,result[0]![1]-50)).toBeCloseTo(50);
 expect(Math.hypot(result[2]![0]-350,result[2]![1]-50)).toBeCloseTo(50);
 expect(result[1]).toEqual([200,25]);expect(points[0]).toEqual([100,25]);
});
