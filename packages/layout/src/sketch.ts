import type { SketchShape } from '@strukt/core';
import { runElk } from './elk';

/** Layer and route the supplied graph; unrelated hand-drawn elements keep their positions. */
export async function layoutSketch(shapes: readonly SketchShape[], direction: 'horizontal' | 'vertical'): Promise<SketchShape[]> {
  const nodes = shapes.filter((s) => ['rectangle', 'ellipse', 'diamond'].includes(s.type));
  if (!nodes.length) return [...shapes];
  const ids = new Set(nodes.map((s) => s.id));
  const edges = shapes.filter((s) => s.type === 'arrow' && s.from && s.to && ids.has(s.from) && ids.has(s.to));
  // Prefix model ids so user-supplied ids cannot collide with the layout root.
  const id = (value: string) => `node:${value}`;
  const graph = await runElk({
    id: 'sketch-root',
    layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': direction === 'horizontal' ? 'RIGHT' : 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL', 'elk.padding': '[top=0,left=0,bottom=0,right=0]',
      'elk.spacing.nodeNode': '64', 'elk.layered.spacing.nodeNodeBetweenLayers': String(Math.max(88, ...edges.map((s) => (s.text?.length ?? 0) * 8 + 24))),
      'elk.spacing.edgeNode': '28', 'elk.layered.spacing.edgeNodeBetweenLayers': '28',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: nodes.map((s) => ({ id: id(s.id), width: s.width, height: s.height })),
    // Labels are bound to arrows by Excalidraw. Separate ELK label nodes would double each
    // layer gap and shrink the whole diagram at fit-to-content zoom. Reserve room above.
    edges: edges.map((s) => ({ id: s.id, sources: [id(s.from!)], targets: [id(s.to!)] })),
  });
  const ox = Math.min(...nodes.map((s) => s.x)), oy = Math.min(...nodes.map((s) => s.y));
  const positioned = new Map((graph.children ?? []).map((n) => [n.id, n]));
  const routed = new Map((graph.edges ?? []).map((e) => [e.id, e]));
  return shapes.map((s) => {
    const n = positioned.get(id(s.id));
    if (n) return { ...s, x: ox + (n.x ?? 0), y: oy + (n.y ?? 0) };
    const section = routed.get(s.id)?.sections?.[0];
    if (!section) return { ...s };
    const path = [section.startPoint, ...section.bendPoints ?? [], section.endPoint];
    const start = path[0]!;
    const points: [number, number][] = path.map((p) => [p.x - start.x, p.y - start.y]);
    return { ...s, x: ox + start.x, y: oy + start.y, width: Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0])), height: Math.max(...points.map((p) => p[1])) - Math.min(...points.map((p) => p[1])), points };
  });
}
