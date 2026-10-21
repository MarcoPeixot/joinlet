export type WorkspaceItemKind = 'diagram' | 'doc' | 'sketch';
export type WorkspaceOp =
  | { op: 'create_folder'; kind: WorkspaceItemKind; path: string }
  | { op: 'move_item'; kind: WorkspaceItemKind; slug: string; folder: string | null }
  | { op: 'rename_item'; kind: WorkspaceItemKind; slug: string; title: string }
  | { op: 'rename_folder'; kind: WorkspaceItemKind; from: string; to: string };

export function readWorkspaceOps(raw: unknown): WorkspaceOp[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > 200) return null;
  const text = (v: unknown, max: number) => typeof v === 'string' && !!v.trim() && v.length <= max && !/[\x00-\x1f]/.test(v);
  for (const value of raw) {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    if (!['diagram', 'doc', 'sketch'].includes(String(v.kind))) return null;
    if (v.op === 'create_folder') { if (!text(v.path, 244)) return null; }
    else if (v.op === 'rename_folder') { if (!text(v.from, 244) || !text(v.to, 244)) return null; }
    else if (v.op === 'move_item' || v.op === 'rename_item') {
      if (typeof v.slug !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v.slug)) return null;
      if (v.op === 'move_item' ? v.folder !== null && !text(v.folder, 244) : !text(v.title, 120)) return null;
    } else return null;
  }
  return raw as WorkspaceOp[];
}
