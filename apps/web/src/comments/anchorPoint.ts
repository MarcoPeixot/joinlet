import { own } from '@strukt/core';
import type { DiagramModel } from '@strukt/core';
import type { CommentAnchor, CommentThread } from '@strukt/workspace';

export interface Box { x: number; y: number; width: number; height: number }
export type BoxOf = (id: string) => Box | null;

/**
 * Where a conversation's marker sits on the canvas, in flow coordinates: the top-right corner of its node, the middle
 * of its connection, or the point itself. `null` when the node or connection is gone (the marker is not drawn; the
 * panel still lists the conversation).
 */
export function anchorPoint(anchor: CommentAnchor, model: DiagramModel, boxOf: BoxOf): { x: number; y: number } | null {
  switch (anchor.type) {
    case 'point': return { x: anchor.x, y: anchor.y };
    case 'node': {
      if (!own(model.elements, anchor.id)) return null;
      const box = boxOf(anchor.id);
      return box ? { x: box.x + box.width, y: box.y } : null;
    }
    case 'edge': {
      const edge = model.edges.find((item) => item.id === anchor.id);
      const from = edge && boxOf(edge.from);
      const to = edge && boxOf(edge.to);
      return from && to ? { x: (from.x + from.width / 2 + to.x + to.width / 2) / 2, y: (from.y + from.height / 2 + to.y + to.height / 2) / 2 } : null;
    }
    case 'text': return null;
  }
}

/** Markers that would sit on one spot are lined up side by side: the key says which share one. */
export function stackKey(anchor: CommentAnchor): string {
  return anchor.type === 'point' ? `point:${Math.round(anchor.x)}:${Math.round(anchor.y)}` : `${anchor.type}:${'id' in anchor ? anchor.id : ''}`;
}

/** The threads laid out for drawing: each with its position, shifted along its stack. Threads without a spot are left out. */
export function placeMarkers(threads: readonly CommentThread[], model: DiagramModel, boxOf: BoxOf, step: number): Array<{ thread: CommentThread; x: number; y: number }> {
  const stacks = new Map<string, number>();
  const placed: Array<{ thread: CommentThread; x: number; y: number }> = [];
  for (const thread of threads) {
    const at = anchorPoint(thread.anchor, model, boxOf);
    if (!at) continue;
    const key = stackKey(thread.anchor);
    const index = stacks.get(key) ?? 0;
    stacks.set(key, index + 1);
    placed.push({ thread, x: at.x + index * step, y: at.y });
  }
  return placed;
}
