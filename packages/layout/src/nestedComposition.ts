import { cardSize, computeRects, defaultSize, GROUP_PADDING, intersects, nodeVariant, own, visualBox } from '@strukt/core';
import type { DiagramModel, Direction, ID, NodeBox, Size } from '@strukt/core';
import type { ElkNode } from 'elkjs/lib/elk-api.js';
import { edgeLabelSize } from './labels';

interface Block { w: number; h: number; nodes: Record<ID, NodeBox> }
const directions: Record<Direction, string> = { right: 'RIGHT', left: 'LEFT', down: 'DOWN', up: 'UP' };

/** A single outer boundary must not hide the dependency layers inside it. */
export async function nestedCompositionLayout(model: DiagramModel, sizes: Readonly<Record<ID, Size>>, direction: Direction, origin: { x: number; y: number }, runLayout: (graph: ElkNode) => Promise<ElkNode>): Promise<Record<ID, NodeBox> | undefined> {
  const roots = model.order.filter(id => !model.elements[id]?.parentId);
  const groups = roots.filter(id => model.elements[id]?.kind === 'group');
  const nodes = model.order.filter(id => model.elements[id]?.kind === 'node');
  if (groups.length !== 1 || !nodes.length || nodes.length > 160 || nodes.some(id => { const el = model.elements[id]!; return el.kind !== 'node' || !['card', 'icon'].includes(nodeVariant(el)); })) return undefined;
  const children = new Map<ID | undefined, ID[]>();
  for (const id of model.order) {
    const parent = model.elements[id]!.parentId;
    children.set(parent, [...(children.get(parent) ?? []), id]);
  }
  if (!children.get(groups[0])?.length || model.order.filter(id => model.elements[id]?.kind === 'group').length > 40) return undefined;
  const offset = (target: Record<ID, NodeBox>, block: Block, x: number, y: number) => {
    for (const [id, box] of Object.entries(block.nodes)) target[id] = { ...box, x: Math.round(box.x + x), y: Math.round(box.y + y) };
  };
  const scope = async (parent?: ID): Promise<Block> => {
    const ids = children.get(parent) ?? [];
    const blocks = await Promise.all(ids.map(async id => {
      const element = model.elements[id]!;
      if (element.kind === 'group' && children.get(id)?.length) return scope(id);
      const stored = own(sizes, id);
      const natural = element.kind === 'node' && nodeVariant(element) === 'card' ? cardSize(element, stored?.w) : defaultSize(element);
      const size = stored ? { w: stored.w, h: Math.max(stored.h, natural.h) } : natural;
      const footprint = visualBox(element, { x: 0, y: 0, ...size });
      return { w: footprint.w, h: footprint.h, nodes: { [id]: { x: -footprint.x, y: -footprint.y, ...size } } };
    }));
    // Project descendant endpoints onto their immediate siblings at this boundary.
    // Repeat at every depth instead of collapsing all descendants into the Cloud root.
    const owners = new Map<ID, number>();
    for (let i = 0; i < ids.length; i++) {
      owners.set(ids[i]!, i);
      for (const id of Object.keys(blocks[i]!.nodes)) owners.set(id, i);
      const descendants = [...(children.get(ids[i]) ?? [])];
      for (let at = 0; at < descendants.length; at++) { owners.set(descendants[at]!, i); descendants.push(...(children.get(descendants[at]) ?? [])); }
    }
    const edges = model.edges.flatMap((edge, index) => {
      const reverse = edge.connector === '<';
      const a = owners.get(reverse ? edge.to : edge.from), b = owners.get(reverse ? edge.from : edge.to);
      if (a === undefined || b === undefined || a === b) return [];
      return [{ id: `edge-${index}`, sources: [`node-${a}`], targets: [`node-${b}`],
        layoutOptions: { 'elk.layered.priority.direction': edge.connector === '>' || edge.connector === '<' ? '10' : '1' },
      }];
    });
    // The renderer places labels on the final routes. ELK label dummy layers otherwise
    // double every gap at each nested boundary; reserve a corridor instead.
    const corridor = Math.max(90, ...model.edges.filter(edge => edge.label && owners.has(edge.from) && owners.has(edge.to) && owners.get(edge.from) !== owners.get(edge.to)).map(edge => edgeLabelSize(edge.label!).w + 32));
    const padding = parent ? GROUP_PADDING : { top: 0, right: 0, bottom: 0, left: 0 };
    const layout = await runLayout({ id: 'scope', layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': directions[direction],
      'elk.padding': `[top=${padding.top},left=${padding.left},bottom=${padding.bottom},right=${padding.right}]`,
      'elk.spacing.nodeNode': '48', 'elk.layered.spacing.nodeNodeBetweenLayers': String(corridor),
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    }, children: blocks.map((block, i) => ({ id: `node-${i}`, width: block.w, height: block.h })), edges });
    const result: Record<ID, NodeBox> = {};
    for (const child of layout.children ?? []) offset(result, blocks[Number(child.id.slice(5))]!, child.x ?? 0, child.y ?? 0);
    return { w: layout.width ?? 0, h: layout.height ?? 0, nodes: result };
  };
  const result = await scope();
  // Align external sources with their actual first component, not the centre of a tall Cloud.
  if (direction === 'right' || direction === 'left') {
    let bottom = -Infinity;
    for (const id of roots.filter(id => model.elements[id]?.kind === 'node')) {
      const incoming = model.edges.some(edge => (['>', '-->', '<>'].includes(edge.connector) && edge.to === id) || (['<', '<>'].includes(edge.connector) && edge.from === id));
      const targets = model.edges.filter(edge => ['>', '-->'].includes(edge.connector) && edge.from === id).map(edge => result.nodes[edge.to]).filter((box): box is NodeBox => !!box);
      if (incoming || !targets.length) continue;
      const box = result.nodes[id]!;
      box.y = Math.max(bottom, Math.round(targets.reduce((sum, target) => sum + target.y + (target.h ?? 0) / 2, 0) / targets.length - (box.h ?? 0) / 2));
      bottom = box.y + (box.h ?? 0) + 48;
    }
  }
  const minY = Math.min(0, ...Object.values(result.nodes).map(box => box.y));
  const placed: Record<ID, NodeBox> = {};
  offset(placed, result, origin.x, origin.y - minY);
  // Reject invalid geometry before it reaches the editor; the caller retains the generic fallback.
  if (Object.values(placed).some(box => ![box.x, box.y, box.w, box.h].every(Number.isFinite))) return undefined;
  const rects = computeRects(model, { nodes: placed, edges: {} });
  for (const siblings of children.values()) for (let i = 0; i < siblings.length; i++) for (let j = i + 1; j < siblings.length; j++) {
    const a = siblings[i]!, b = siblings[j]!;
    if (intersects(visualBox(model.elements[a]!, rects[a]!), visualBox(model.elements[b]!, rects[b]!))) return undefined;
  }
  return placed;
}
