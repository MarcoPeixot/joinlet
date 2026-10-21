import { readWorkspaceOps } from '@strukt/core';
import type { WorkspaceOp } from '@strukt/core';
import { createFolder, knownFolders, moveItem, normalizeFolder, renameFolder } from './folders';
import { ITEM_LIST } from './manifest';
import type { Manifest } from './manifest';

/** Validate the entire metadata batch without mutating content, paths on disk, or the incoming manifest. */
export function organizeWorkspace(manifest: Manifest, ops: WorkspaceOp[]): Manifest {
  if (!readWorkspaceOps(ops)) throw new Error('Organização inválida. Envie de 1 a 200 ações de pastas e itens.');
  let next = manifest;
  const folder = (path: string) => { const clean = normalizeFolder(path); if (!clean) throw new Error(`Pasta inválida: “${path}”. Use até quatro níveis e nomes de até 60 caracteres.`); return clean; };
  for (const op of ops) {
    const key = ITEM_LIST[op.kind];
    if (op.op === 'create_folder') next = createFolder(next, op.kind, folder(op.path));
    else if (op.op === 'rename_folder') {
      const from = folder(op.from), to = folder(op.to);
      const known = knownFolders(next[key], next.folders?.[key]);
      if (!known.includes(from)) throw new Error(`A pasta “${from}” não existe.`);
      if (to !== from && known.includes(to)) throw new Error(`A pasta “${to}” já existe.`);
      if (to.startsWith(`${from}/`)) throw new Error('Uma pasta não pode ser movida para dentro dela mesma.');
      next = renameFolder(next, op.kind, from, to);
      if (next[key].some(item => item.folder && !normalizeFolder(item.folder)) || next.folders?.[key]?.some(path => !normalizeFolder(path))) throw new Error('A mudança excederia os limites de profundidade das pastas.');
    } else {
      if (!next[key].some(item => item.slug === op.slug)) throw new Error(`O item “${op.slug}” não existe em ${key}.`);
      if (op.op === 'move_item') next = moveItem(next, op.kind, op.slug, op.folder === null ? null : folder(op.folder));
      else next = { ...next, [key]: next[key].map(item => item.slug === op.slug ? { ...item, title: op.title.trim() } : item) };
    }
  }
  return next;
}
