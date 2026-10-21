import { GROUP_PADDING, applyOps, computeRects, emptyModel, intersects, own, visualBox } from '@strukt/core';
import type { DiagramModel, DiagramOp } from '@strukt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { autoLayout } from './elk';

function build(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

const aws = build([
  { op: 'add_node', id: 'API gateway', icon: 'aws-api-gateway' },
  { op: 'add_node', id: 'Lambda', icon: 'aws-lambda' },
  { op: 'add_group', id: 'VPC Subnet' },
  { op: 'add_group', id: 'Main Server', parentId: 'VPC Subnet' },
  { op: 'add_node', id: 'Server', parentId: 'Main Server', icon: 'aws-ec2' },
  { op: 'add_node', id: 'Data', parentId: 'Main Server', shape: 'cylinder' },
  { op: 'add_node', id: 'Queue', parentId: 'VPC Subnet' },
  { op: 'add_group', id: 'Vazio' },
  { op: 'connect', from: 'API gateway', to: 'Lambda' },
  { op: 'connect', from: 'Lambda', to: 'Server' },
  { op: 'connect', from: 'Server', to: 'Data' },
  { op: 'connect', from: 'Server', to: 'Queue' },
  { op: 'connect', from: 'Queue', to: 'Vazio' },
]);

describe('autoLayout', () => {
  it('positions every node and empty group, but not derived groups', async () => {
    const positions = await autoLayout(aws);
    expect(Object.keys(positions).sort()).toEqual(['API gateway', 'Data', 'Lambda', 'Queue', 'Server', 'Vazio']);
  });

  it('follows the diagram direction', async () => {
    const chain = build([
      { op: 'add_node', id: 'A' },
      { op: 'add_node', id: 'B' },
      { op: 'add_node', id: 'C' },
      { op: 'connect', from: 'A', to: 'B' },
      { op: 'connect', from: 'B', to: 'C' },
    ]);
    const right = await autoLayout(chain, {}, 'right');
    expect(right.A!.x).toBeLessThan(right.B!.x);
    expect(right.B!.x).toBeLessThan(right.C!.x);
    const down = await autoLayout(chain, {}, 'down');
    expect(down.A!.y).toBeLessThan(down.B!.y);
    expect(down.B!.y).toBeLessThan(down.C!.y);
  });

  it('keeps siblings apart and children inside their groups', async () => {
    const positions = await autoLayout(aws);
    const rects = computeRects(aws, { nodes: positions, edges: {} });
    const box = (id: string) => visualBox(aws.elements[id]!, rects[id]!);
    const siblings = (parent: string | undefined) => aws.order.filter((id) => aws.elements[id]!.parentId === parent);
    for (const parent of [undefined, 'VPC Subnet', 'Main Server']) {
      const ids = siblings(parent);
      for (const a of ids) for (const b of ids) if (a < b) expect(intersects(box(a), box(b)), `${a} × ${b}`).toBe(false);
    }
  });

  it('pads groups exactly like the canvas (GROUP_PADDING, 44px on top for the title chip)', async () => {
    const m = build([{ op: 'add_group', id: 'G' }, { op: 'add_node', id: 'A', parentId: 'G' }]);
    expect(await autoLayout(m)).toEqual({ A: { x: GROUP_PADDING.left, y: GROUP_PADDING.top } });
  });

  it('starts the drawing at the origin, measuring icon captions', async () => {
    const m = build([{ op: 'add_node', id: 'Solo', icon: 'redis' }]);
    // Icon nodes are 56px wide with a 140px caption: the node box sits 42px inside the visual box.
    expect(await autoLayout(m, {}, 'right', { x: 100, y: 50 })).toEqual({ Solo: { x: 142, y: 50 } });
  });

  it('uses stored sizes and handles an empty diagram', async () => {
    const m = build([{ op: 'add_node', id: 'Big' }, { op: 'add_node', id: 'Next' }, { op: 'connect', from: 'Big', to: 'Next' }]);
    const positions = await autoLayout(m, { Big: { w: 400, h: 64 } }, 'right');
    expect(positions.Next!.x - positions.Big!.x).toBeGreaterThanOrEqual(400);
    expect(await autoLayout(emptyModel())).toEqual({});
  });

  it('lays out elements named like Object.prototype members', async () => {
    const m = build([{ op: 'add_node', id: 'constructor' }, { op: 'add_node', id: 'toString' }, { op: 'connect', from: 'constructor', to: 'toString' }]);
    const positions = await autoLayout(m);
    expect(Object.keys(positions).sort()).toEqual(['constructor', 'toString']);
    expect(Object.values(positions).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(own(positions, 'constructor')!.x).toBeLessThan(own(positions, 'toString')!.x);
  });
});

describe('autoLayout when the ELK worker cannot run', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A Worker whose script "fails to load" (blocked by CSP, 404): it never answers and fires `error` after the first message. */
  function stubFailingWorker() {
    const created: FailingWorker[] = [];
    class FailingWorker {
      onmessage: ((event: unknown) => void) | null = null;
      private listeners: Array<(event: unknown) => void> = [];
      terminated = false;
      constructor() {
        created.push(this);
      }
      addEventListener(type: string, listener: (event: unknown) => void) {
        if (type === 'error') this.listeners.push(listener);
      }
      postMessage() {
        setTimeout(() => this.listeners.forEach((listener) => listener({ message: 'script blocked' })), 0);
      }
      terminate() {
        this.terminated = true;
      }
    }
    vi.stubGlobal('Worker', FailingWorker);
    return created;
  }

  const pair = build([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }, { op: 'connect', from: 'A', to: 'B' }]);

  it('falls back to the bundled ELK instead of hanging, and does not keep retrying the broken worker', async () => {
    const workers = stubFailingWorker();
    const first = await autoLayout(pair);
    expect(Object.keys(first).sort()).toEqual(['A', 'B']);
    expect(workers).toHaveLength(1);
    expect(workers[0]!.terminated).toBe(true);
    const second = await autoLayout(pair);
    expect(second).toEqual(first);
    expect(workers).toHaveLength(1);
  });
});
