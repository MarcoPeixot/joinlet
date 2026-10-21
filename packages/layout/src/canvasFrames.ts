import { canvasFrameModel, canvasFrames, computeRects, copyElements, unionRect, visualBox } from '@strukt/core';
import type { DiagramModel, Direction, NodeBox, Size } from '@strukt/core';
import { autoLayout } from './elk';

/** Each named frame keeps its own flow; layout packs whole diagrams, never interleaving their nodes. */
export async function layoutCanvasFrames(model: DiagramModel, sizes: Readonly<Record<string, Size>>, direction: Direction, origin: { x: number; y: number }): Promise<Record<string, NodeBox>> {
  const frames = canvasFrames(model);
  const covered = new Set<string>();
  const scenes = frames.map(id => {
    const local = canvasFrameModel(model, { nodes: {}, edges: {} }, id);
    local.order.forEach(node => covered.add(node));
    return local;
  });
  const roots = model.order.filter(id => !model.elements[id]?.parentId && !covered.has(id));
  if (roots.length) {
    const clip = copyElements(model, { nodes: {}, edges: {} }, roots);
    scenes.push({ ...model, order: clip.elements.map(el => el.id), elements: Object.fromEntries(clip.elements.map(el => [el.id, el])), edges: clip.edges });
  }
  const out: Record<string, NodeBox> = {};
  let x = origin.x, y = origin.y;
  for (const scene of scenes) {
    const nodes = await autoLayout(scene, sizes, direction);
    const rects = computeRects(scene, { nodes, edges: {} });
    const bounds = unionRect(scene.order.map(id => visualBox(scene.elements[id]!, rects[id]!)));
    if (!bounds) continue;
    for (const [id, box] of Object.entries(nodes)) out[id] = { ...box, x: Math.round(box.x + x - bounds.x), y: Math.round(box.y + y - bounds.y) };
    if (direction === 'down' || direction === 'up') y += bounds.h + 160;
    else x += bounds.w + 160;
  }
  return out;
}
