import { GROUP_PADDING, defaultSize, own, visualBox } from '@strukt/core';
import type { DiagramModel, Direction, ID, NodeBox, Size } from '@strukt/core';
import type { ELK as ElkEngine, ElkNode } from 'elkjs/lib/elk-api.js';
import { edgeLabelSize } from './labels';

const ELK_DIRECTION: Record<Direction, string> = { right: 'RIGHT', down: 'DOWN', left: 'LEFT', up: 'UP' };
const GROUP_ELK_PADDING = `[top=${GROUP_PADDING.top},left=${GROUP_PADDING.left},bottom=${GROUP_PADDING.bottom},right=${GROUP_PADDING.right}]`;
// Element ids are user text; prefixing keeps them clear of the root id.
const toElk = (id: ID) => `e:${id}`;
const fromElk = (id: string) => id.slice(2);

/** ELK in a Web Worker, plus a promise that rejects if the worker fails at runtime (elkjs itself never does: a dead worker hangs). */
class WorkerFailure extends Error {}

interface WorkerEngine {
  elk: ElkEngine;
  failed: Promise<never>;
}

let workerEngine: WorkerEngine | undefined;
let workerStarting: Promise<WorkerEngine> | undefined;
/** Set once the worker failed to run: later layouts go straight to the bundled build instead of failing again. */
let workerBroken = false;

async function createWorkerEngine(): Promise<WorkerEngine> {
  const { default: ELK } = await import('elkjs/lib/elk-api.js');
  let fail: (reason: Error) => void = () => {};
  const failed = new Promise<never>((_, reject) => {
    fail = reject;
  });
  failed.catch(() => {}); // only observed while a layout is racing it
  const elk = new ELK({
    workerFactory: () => {
      const executable = (globalThis as { process?: { execPath?: string } }).process?.execPath;
      const worker = new Worker(import.meta.url.includes('/$bunfs/') && executable ? executable.replace(/[^\\/]+$/, 'elk-worker.js') : new URL('../node_modules/elkjs/lib/elk-worker.min.js', import.meta.url));
      // Bun workers otherwise keep short-lived CLI commands alive after layout completes.
      (worker as Worker & { unref?: () => void }).unref?.();
      worker.addEventListener('error', (event) => fail(new WorkerFailure(`ELK worker failed: ${(event as ErrorEvent).message ?? 'unknown error'}`)));
      return worker;
    },
  });
  return { elk, failed };
}

async function bundledElk(): Promise<ElkEngine> {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  return new ELK();
}

/**
 * In the browser ELK runs in a Web Worker (a 2000-node layout would freeze the UI for seconds); without `Worker`
 * (Node tests, SSR) or if the worker cannot start or later fails (script blocked by CSP, failed to load), the
 * bundled build runs on the calling thread.
 */
export async function runElk(graph: ElkNode): Promise<ElkNode> {
  if (typeof Worker !== 'undefined' && !workerBroken) {
    try {
      workerEngine ??= await (workerStarting ??= createWorkerEngine());
      const engine = workerEngine;
      return await Promise.race([engine.elk.layout(graph), engine.failed]);
    } catch (err) {
      // A layout error of the graph itself is the caller's; only a dead worker moves the work to this thread.
      if (!(err instanceof WorkerFailure) && workerEngine) throw err;
      workerBroken = true;
      console.warn('ELK worker unavailable; falling back to the main-thread layout for this session.', err);
      workerEngine?.elk.terminateWorker();
      workerEngine = undefined;
      workerStarting = undefined;
    }
  }
  return (await bundledElk()).layout(graph);
}

/**
 * Layered layout of the whole diagram (spec §7: "Reorganizar" and diagrams without positions).
 * Returns absolute top-left positions for nodes and empty groups; groups with children stay derived.
 * `origin` is where the top-left of the laid-out drawing lands.
 */
export async function autoLayout(
  model: DiagramModel,
  sizes: Readonly<Record<ID, Size>> = {},
  direction: Direction = model.style.direction,
  origin: { x: number; y: number } = { x: 0, y: 0 },
): Promise<Record<ID, NodeBox>> {
  if (model.order.some(id => model.elements[id]?.kind === 'group' && model.elements[id]?.canvasFrame && !model.elements[id]?.parentId)) {
    const { layoutCanvasFrames } = await import('./canvasFrames');
    return layoutCanvasFrames(model, sizes, direction, origin);
  }
  const sequenceNodes = model.order.filter(id => model.elements[id]?.kind === 'node');
  if (sequenceNodes.length && sequenceNodes.every(id => model.elements[id]?.presentation === 'participant')) {
    let x = origin.x;
    return Object.fromEntries(sequenceNodes.map(id => {
      const size = own(sizes, id) ?? defaultSize(model.elements[id]!);
      const position = { x, y: origin.y };
      x += size.w + 120;
      return [id, position];
    }));
  }
  const directed = direction===model.style.direction?model:{...model,style:{...model.style,direction}};
  if (model.order.filter(id => model.elements[id]?.kind === 'group' && !model.elements[id]?.parentId).length === 1) {
    const { nestedCompositionLayout } = await import('./nestedComposition');
    const nested = await nestedCompositionLayout(directed, sizes, direction, origin, runElk);
    if (nested) return nested;
  }
  if (model.order.filter(id=>model.elements[id]?.kind==='group'&&!model.elements[id]?.parentId).length>=2) {
    const {groupCompositionLayout}=await import('./groupComposition');
    const grouped=groupCompositionLayout(directed,sizes,origin);
    if(grouped)return grouped;
  }
  const {compositionLayout}=await import('./composition');
  const composed = compositionLayout(directed, sizes, origin);
  if (composed) return composed;
  const children = new Map<ID | undefined, ID[]>();
  for (const id of model.order) {
    const el = model.elements[id];
    if (el) children.set(el.parentId, [...(children.get(el.parentId) ?? []), id]);
  }
  // ELK lays out visual boxes (icon + caption); we store the node box, so remember the offset.
  const offsets = new Map<ID, { dx: number; dy: number }>();
  const build = (id: ID): ElkNode => {
    const el = model.elements[id]!;
    const kids = children.get(id) ?? [];
    if (el.kind === 'group' && kids.length) {
      return { id: toElk(id), layoutOptions: { 'elk.padding': GROUP_ELK_PADDING }, children: kids.map(build) };
    }
    const size = own(sizes, id) ?? defaultSize(el);
    const box = visualBox(el, { x: 0, y: 0, w: size.w, h: size.h });
    offsets.set(id, { dx: -box.x, dy: -box.y });
    return { id: toElk(id), width: box.w, height: box.h };
  };
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': ELK_DIRECTION[direction],
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.padding': '[top=0,left=0,bottom=0,right=0]',
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: (children.get(undefined) ?? []).map(build),
    edges: model.edges
      .filter((edge) => model.elements[edge.from] && model.elements[edge.to])
      .map((edge, index) => ({ id: `x${index}`, sources: [toElk(edge.from)], targets: [toElk(edge.to)],
        ...(edge.label ? { labels: [{ text: edge.label, width: edgeLabelSize(edge.label).w, height: 20 }] } : {}),
      })),
  };
  const result = await runElk(graph);
  const out: Record<ID, { x: number; y: number }> = {};
  const walk = (node: ElkNode, ox: number, oy: number) => {
    for (const child of node.children ?? []) {
      const x = ox + (child.x ?? 0);
      const y = oy + (child.y ?? 0);
      const id = fromElk(child.id);
      const offset = offsets.get(id);
      if (offset) out[id] = { x: Math.round(x + offset.dx), y: Math.round(y + offset.dy) };
      walk(child, x, y);
    }
  };
  walk(result, origin.x, origin.y);
  return out;
}
