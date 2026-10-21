import { SEQUENCE_MESSAGE_GAP, participantSize } from '@strukt/core';
import type { DiagramModel, ID, NodeEl, Rect } from '@strukt/core';
import type { Point } from './route';

export interface SequenceMessage {
  points: Point[];
  label: Point;
  order: number;
}

export function sequenceMessages(model: DiagramModel, rects: Readonly<Record<ID, Rect>>): Record<ID, SequenceMessage> {
  const participants = new Set(model.order.filter(id => model.elements[id]?.kind === 'node' && model.elements[id]?.presentation === 'participant' && rects[id]));
  const messages = model.edges.filter(edge => participants.has(edge.from) && participants.has(edge.to));
  const top = Math.max(0, ...[...participants].map(id => rects[id]!.y + participantSize(model.elements[id] as NodeEl, rects[id]!.w).h)) + 48;
  return Object.fromEntries(messages.map((edge, index) => {
    const a = rects[edge.from]!, b = rects[edge.to]!;
    const from = a.x + a.w / 2, to = b.x + b.w / 2;
    const y = top + index * SEQUENCE_MESSAGE_GAP;
    return [edge.id, { points: [[from, y], [to, y]], label: [(from + to) / 2, y - 14], order: index + 1 } satisfies SequenceMessage];
  }));
}
