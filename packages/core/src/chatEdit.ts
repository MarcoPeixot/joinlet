import { readWorkspaceOps } from './workspaceEdit';
import type { WorkspaceOp } from './workspaceEdit';
import type { DiagramOp } from './model';

export interface DiagramPart { title: string; elements: string[] }

/** Edits are bound to the item and workspace captured when the request started. */
export interface ChatTarget { kind: 'diagram' | 'doc' | 'sketch' | 'workspace'; slug: string; content: string; workspace?: string }
export interface SketchShape {
  id: string;
  type: 'rectangle' | 'ellipse' | 'diamond' | 'text' | 'line' | 'arrow';
  x: number; y: number; width: number; height: number;
  text?: string; strokeColor?: string; backgroundColor?: string; fontSize?: number;
  points?: [number, number][];
  /** Semantic endpoints; the renderer binds and routes the arrow. */
  from?: string; to?: string;
}
export type ChatWorkspaceItem = { title: string; folder?: string } & (
  | { kind: 'diagram'; ops: DiagramOp[] }
  | { kind: 'doc'; markdown: string }
  | { kind: 'sketch'; upsert: SketchShape[]; layout?: 'horizontal' | 'vertical' }
);
export type ChatEdit =
  | { kind: 'create_workspace_items'; summary: string; items: ChatWorkspaceItem[] }
  | { kind: 'workspace'; summary: string; ops: WorkspaceOp[] }
  | { kind: 'diagram'; summary: string; ops: DiagramOp[] }
  | { kind: 'split_diagram'; summary: string; parts: DiagramPart[]; destination?: 'canvas' | 'files' }
  | { kind: 'add_canvas_diagram'; summary: string; title: string; ops: DiagramOp[] }
  | { kind: 'doc'; summary: string; markdown: string }
  | { kind: 'sketch'; summary: string; clear: boolean; remove: string[]; upsert: SketchShape[]; layout?: 'horizontal' | 'vertical' };

/** Validate the wire format again in the browser, before any mutation. Diagram ops are also tried against the live model. */
export function readChatEdit(raw: unknown): ChatEdit | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.summary !== 'string' || !v.summary.trim() || v.summary.length > 2000) return null;
  if (v.kind === 'create_workspace_items') {
    if (!Array.isArray(v.items) || !v.items.length || v.items.length > 8) return null;
    const items: ChatWorkspaceItem[] = [];
    for (const rawItem of v.items) {
      if (!rawItem || typeof rawItem !== 'object') return null;
      const item = rawItem as Record<string, unknown>;
      if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 120 || /[\x00-\x1f]/.test(item.title)) return null;
      if (item.folder !== undefined && (typeof item.folder !== 'string' || !item.folder.trim() || item.folder.length > 244 || /[\x00-\x1f]/.test(item.folder))) return null;
      const common = { title: item.title.trim(), ...(item.folder ? { folder: item.folder as string } : {}) };
      if (item.kind === 'diagram' && Array.isArray(item.ops) && item.ops.length <= 1000) items.push({ ...common, kind: 'diagram', ops: item.ops });
      else if (item.kind === 'doc' && typeof item.markdown === 'string' && item.markdown.length <= 250000) items.push({ ...common, kind: 'doc', markdown: item.markdown });
      else if (item.kind === 'sketch') {
        const sketch = readChatEdit({ ...item, kind: 'sketch', summary: v.summary, clear: true, remove: [] });
        if (!sketch || sketch.kind !== 'sketch') return null;
        items.push({ ...common, kind: 'sketch', upsert: sketch.upsert, ...(sketch.layout ? { layout: sketch.layout } : {}) });
      } else return null;
    }
    if (JSON.stringify(items).length > 300000) return null;
    return { kind: 'create_workspace_items', summary: v.summary, items };
  }
  if (v.kind === 'workspace') { const ops = readWorkspaceOps(v.ops); return ops ? { kind: 'workspace', summary: v.summary, ops } : null; }
  if (v.kind === 'add_canvas_diagram') return typeof v.title === 'string' && v.title.trim() && v.title.length <= 120 && Array.isArray(v.ops) && v.ops.length > 0 && v.ops.length <= 1000 ? { kind: 'add_canvas_diagram', summary: v.summary, title: v.title.trim(), ops: v.ops } as ChatEdit : null;
  if (v.kind === 'split_diagram') {
    if (v.destination !== undefined && !['canvas', 'files'].includes(String(v.destination))) return null;
    if (!Array.isArray(v.parts) || v.parts.length < 2 || v.parts.length > 6) return null;
    const titles = new Set<string>();
    for (const part of v.parts) {
      if (!part || typeof part !== 'object' || typeof part.title !== 'string' || !part.title.trim() || part.title.length > 120 || titles.has(part.title.trim().toLocaleLowerCase()) || !Array.isArray(part.elements) || !part.elements.length || part.elements.length > 1000 || !part.elements.every((id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 500) || new Set(part.elements).size !== part.elements.length) return null;
      titles.add(part.title.trim().toLocaleLowerCase());
    }
    return { kind: 'split_diagram', summary: v.summary, ...(v.destination ? { destination: v.destination as 'canvas' | 'files' } : {}), parts: v.parts.map(p => ({ title: p.title.trim(), elements: p.elements })) };
  }
  if (v.kind === 'diagram' && Array.isArray(v.ops) && v.ops.length <= 1000) return v as unknown as ChatEdit;
  if (v.kind === 'doc' && typeof v.markdown === 'string' && v.markdown.length <= 250000) return v as unknown as ChatEdit;
  if (v.kind !== 'sketch' || typeof v.clear !== 'boolean' || !Array.isArray(v.remove) || !v.remove.every((id) => typeof id === 'string') || !Array.isArray(v.upsert) || v.upsert.length > 500) return null;
  if (v.layout !== undefined && !['horizontal', 'vertical'].includes(String(v.layout))) return null;
  const ids = new Set<string>();
  for (const rawShape of v.upsert) {
    if (!rawShape || typeof rawShape !== 'object') return null;
    const s = rawShape as Record<string, unknown>;
    if (typeof s.id !== 'string' || !s.id || ids.has(s.id) || !['rectangle','ellipse','diamond','text','line','arrow'].includes(String(s.type))) return null;
    ids.add(s.id);
    if (!['x','y','width','height'].every((key) => typeof s[key] === 'number' && Number.isFinite(s[key]) && Math.abs(s[key] as number) <= 100000) || (s.width as number) < 0 || (s.height as number) < 0) return null;
    for (const key of ['text','strokeColor','backgroundColor']) if (s[key] !== undefined && (typeof s[key] !== 'string' || (s[key] as string).length > 10000)) return null;
    if (s.fontSize !== undefined && (typeof s.fontSize !== 'number' || !Number.isFinite(s.fontSize) || s.fontSize < 1 || s.fontSize > 200)) return null;
    if (s.type === 'text' && typeof s.text !== 'string') return null;
    if (s.points !== undefined && (!Array.isArray(s.points) || s.points.length < 2 || s.points.length > 1000 || !s.points.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 100000)))) return null;
    if (s.from !== undefined || s.to !== undefined) {
      if (s.type !== 'arrow' || typeof s.from !== 'string' || !s.from || typeof s.to !== 'string' || !s.to) return null;
    }
    if (Object.keys(s).some((key) => !['id','type','x','y','width','height','text','strokeColor','backgroundColor','fontSize','points','from','to'].includes(key))) return null;
  }
  return v as unknown as ChatEdit;
}

/** Validate references against the final scene, before spending work on rendering. */
export function sketchEditError(edit: Extract<ChatEdit, { kind: 'sketch' }>, elements: readonly { id: string; type: string; isDeleted?: boolean; containerId?: string | null; text?: string }[]): string | null {
  const original = new Map(elements.filter((el) => !el.isDeleted).map((el) => [el.id, el.type]));
  for (const id of edit.remove) if (!original.has(id)) return `O elemento “${id}” não existe no sketch.`;
  const next = edit.clear ? new Map<string, string>() : new Map(original);
  for (const id of edit.remove) next.delete(id);
  for (const shape of edit.upsert) next.set(shape.id, shape.type);
  for (const shape of edit.upsert) {
    if (edit.layout && ['rectangle', 'ellipse', 'diamond'].includes(shape.type)) {
      const label = shape.text ?? elements.find((el) => !el.isDeleted && el.containerId === shape.id && !edit.remove.includes(el.id))?.text;
      if (!label?.trim()) return `O componente “${shape.id}” está sem nome. Inclua text na própria forma para criar um rótulo visível.`;
    }
    for (const id of [shape.from, shape.to]) if (id !== undefined && !['rectangle', 'ellipse', 'diamond'].includes(next.get(id) ?? '')) return `A seta “${shape.id}” aponta para uma forma inexistente ou incompatível: “${id}”. Use ids de retângulos, elipses ou losangos da cena final.`;
    if (shape.from === shape.id || shape.to === shape.id) return `A seta “${shape.id}” não pode se conectar a si mesma.`;
  }
  return null;
}

/** Transient search progress; sources remain in the final Markdown answer. */
export interface ChatSearchActivity { query: string; status: 'searching' | 'complete' | 'error'; count?: number }
