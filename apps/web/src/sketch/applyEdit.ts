import { sketchEditError } from '@strukt/core';
import type { ChatEdit, SketchShape } from '@strukt/core';
import { convertToExcalidrawElements, restoreElements } from '@excalidraw/excalidraw';
import { layoutSketch } from '@strukt/layout';
import type { ExcalidrawElement, ExcalidrawTextElement } from '@excalidraw/excalidraw/element/types';

type Element = ExcalidrawElement;
type Skeleton = NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>[number];
type Edit = Extract<ChatEdit, { kind: 'sketch' }>;
const container = (type: string) => ['rectangle', 'ellipse', 'diamond', 'arrow'].includes(type);

/** Translate the chat's small drawing vocabulary to real, editable Excalidraw objects. */
export async function applySketchEdit(content: string, edit: Edit): Promise<string> {
  const scene = JSON.parse(content || '{"elements":[],"files":{},"appState":{}}');
  const error = sketchEditError(edit, scene.elements ?? []);
  if (error) throw new Error(error);
  const originals = new Map<string, Element>((scene.elements ?? []).map((e: Element) => [e.id, e]));
  const previous = edit.clear ? new Map<string, Element>() : originals;
  const removed = new Set(edit.remove);
  const changes = new Map(edit.upsert.map((s) => [s.id, s]));
  const labels = new Map<string, ExcalidrawTextElement>();
  for (const el of previous.values()) if (el.type === 'text' && el.containerId) labels.set(el.containerId, el);
  // A bound label belongs to its container. Rebuild it with the same id so renames never leave ghosts.
  for (const el of previous.values()) if (el.type === 'text' && el.containerId && (removed.has(el.containerId) || changes.has(el.containerId))) removed.add(el.id);

  const isModern = (id: string) => !previous.has(id) || !!edit.layout;
  const skeleton = (shape: SketchShape): Skeleton => {
    const old = previous.get(shape.id);
    const oldLabel = labels.get(shape.id);
    const labelRemoved = !!oldLabel && edit.remove.includes(oldLabel.id);
    const modern = isModern(shape.id);
    const { text, from, to, ...geometry } = shape;
    const linear = shape.type === 'arrow' || shape.type === 'line';
    const fontSize = shape.fontSize ?? (modern ? (linear ? 16 : 22) : oldLabel?.fontSize ?? (old?.type === 'text' ? old.fontSize : undefined) ?? (linear ? 16 : 22));
    const defaults = {
      // Excalidraw stores light-palette colors and adapts them to its dark canvas.
      strokeColor: linear ? '#64748b' : '#334155', backgroundColor: linear || shape.type === 'text' ? 'transparent' : '#f1f5f9',
      fillStyle: 'solid', strokeWidth: 1.5, roughness: 0, fontFamily: 2,
      roundness: shape.type === 'rectangle' ? { type: 3 } : null,
    };
    const value: Record<string, unknown> = { ...defaults, ...old, ...(modern ? defaults : {}), ...geometry, fontSize,
      boundElements: (old?.boundElements ?? []).filter((b) => b.type !== 'text' && !removed.has(b.id)),
    };
    // The font size on a container is not a label. Labels must be supplied using the skeleton API.
    if (shape.type === 'text') {
      value.text = text ?? (old?.type === 'text' ? old.originalText : '');
      value.originalText = value.text;
      value.autoResize = true;
      delete value.width; delete value.height;
    } else if (container(shape.type)) {
      const label = text ?? (labelRemoved ? undefined : oldLabel?.originalText ?? oldLabel?.text);
      if (label) value.label = {
        ...oldLabel, ...(oldLabel ? { id: oldLabel.id } : {}), text: label, originalText: label,
        fontSize, fontFamily: modern ? 2 : oldLabel?.fontFamily ?? 2,
        strokeColor: modern ? '#1e293b' : oldLabel?.strokeColor ?? '#1e293b', textAlign: 'center', verticalAlign: 'middle',
      };
      if (edit.layout && !linear) { value.width = Math.max(176, shape.width); value.height = Math.max(80, shape.height); }
    }
    if (shape.type === 'arrow' && from && to) {
      value.start = { id: from }; value.end = { id: to };
      if (!shape.points) {
        const a = changes.get(from) ?? previous.get(from), b = changes.get(to) ?? previous.get(to);
        if (a && b) {
          const dx = b.x - a.x, dy = b.y - a.y;
          const horizontal = Math.abs(dx) >= Math.abs(dy);
          const start = horizontal ? [a.x + (dx >= 0 ? a.width + 8 : -8), a.y + a.height / 2] : [a.x + a.width / 2, a.y + (dy >= 0 ? a.height + 8 : -8)];
          const end = horizontal ? [b.x + (dx >= 0 ? -8 : b.width + 8), b.y + b.height / 2] : [b.x + b.width / 2, b.y + (dy >= 0 ? -8 : b.height + 8)];
          value.x = start[0]; value.y = start[1];
          value.points = [[0, 0], [end[0]! - start[0]!, end[1]! - start[1]!]];
        }
      }
    }
    return value as Skeleton;
  };
  const references = new Set(edit.upsert.flatMap((s) => [s.from, s.to]).filter((id): id is string => !!id && !changes.has(id)));
  const build = (shapes: SketchShape[]) => convertToExcalidrawElements([
    ...[...references].map((id) => previous.get(id) as Skeleton),
    ...shapes.map(skeleton),
  ], { regenerateIds: false });

  let shapes = edit.upsert;
  if (edit.layout) {
    // Measure wrapped bound labels before the layout, so routing uses the final box sizes.
    const measured = new Map(build(shapes).map((el) => [el.id, el]));
    shapes = await layoutSketch(shapes.map((s) => {
      const el = measured.get(s.id);
      return el ? { ...s, width: el.width, height: el.height } : s;
    }), edit.layout);
  }
  const updates = new Map<string, Element>(build(shapes).map((el) => {
    const old = originals.get(el.id);
    return [el.id, { ...old, ...el, version: (old?.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2147483647) }];
  }));
  const ordered = edit.clear ? [] : [...originals.values()].filter((el) => !removed.has(el.id)).map((el) => updates.get(el.id) ?? el);
  const placed = new Set(ordered.map((el) => el.id));
  for (const [id, el] of updates) if (!placed.has(id)) ordered.push(el);
  const elements = restoreElements(ordered, null, { repairBindings: true });
  return JSON.stringify({ ...scene, type: 'excalidraw', version: 2, elements });
}
