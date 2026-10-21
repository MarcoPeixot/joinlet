import * as Y from 'yjs';
import { printDiagramJson } from '@strukt/json';
import { applyCollaborativeDiagramDelta, inspectCollaborativeDiagram, seedCollaborativeDiagram, seedCollaborativeText } from './collaboration';
import { COLLAB_MAX_EDGES, COLLAB_MAX_ELEMENTS, CollaborationRefusal } from './collaborationSanitize';
import type { CollaborativeRepair } from './collaborationSanitize';
import { deserializeDiagram, printLayout } from './diagram';
import type { DiagramSnapshot } from './diagram';
import { diagramPath, docPath, layoutPath } from './manifest';
import type { StorageAdapter } from './storage';

export type CollaborationItem = { kind: 'doc' | 'diagram'; slug: string };

export { CollaborationRefusal } from './collaborationSanitize';

/**
 * The read caps (`COLLAB_MAX_ELEMENTS`/`COLLAB_MAX_EDGES`) exist against hostile peers; a diagram past them on disk is
 * legit but would be cut by the read and the host's repair, and the cut projected back to the file. So it is refused
 * whole instead: the room does not open and nothing is written.
 */
function assertFits(snapshot: DiagramSnapshot): void {
  const elements = Object.keys(snapshot.model.elements).length;
  const edges = snapshot.model.edges.length;
  if (elements > COLLAB_MAX_ELEMENTS) throw new CollaborationRefusal(`O diagrama passa do limite de ${COLLAB_MAX_ELEMENTS} elementos da colaboração (tem ${elements}); ele não pode ser editado nesta sessão.`);
  if (edges > COLLAB_MAX_EDGES) throw new CollaborationRefusal(`O diagrama passa do limite de ${COLLAB_MAX_EDGES} conexões da colaboração (tem ${edges}); ele não pode ser editado nesta sessão.`);
}

/** Throws a `CollaborationRefusal` when the diagram in `files` is past what a room keeps whole. */
export function assertCollaborationFilesFit(item: CollaborationItem, files: Record<string, string | null>): void {
  if (item.kind === 'diagram') assertFits(deserializeDiagram(files[diagramPath(item.slug)] ?? null, files[layoutPath(item.slug)] ?? null).snapshot);
}

export function parseCollaborationItem(raw: string): CollaborationItem | null {
  const match = /^(doc|diagram):([A-Za-z0-9][A-Za-z0-9_-]*)$/.exec(raw);
  return match ? { kind: match[1] as CollaborationItem['kind'], slug: match[2]! } : null;
}

export function collaborationPaths(item: CollaborationItem): string[] {
  return item.kind === 'doc' ? [docPath(item.slug)] : [diagramPath(item.slug), layoutPath(item.slug)];
}

export async function readCollaborationFiles(adapter: StorageAdapter, item: CollaborationItem): Promise<Record<string, string | null>> {
  return Object.fromEntries(await Promise.all(collaborationPaths(item).map(async (path) => [path, await adapter.read(path)] as const)));
}

export function seedCollaborationFiles(doc: Y.Doc, item: CollaborationItem, files: Record<string, string | null>): void {
  if (item.kind === 'doc') {
    seedCollaborativeText(doc, files[docPath(item.slug)] ?? '');
    return;
  }
  // A file with errors seeds what could be read, as a single-user load does (`brokenDiagramText` gets it backed up).
  seedCollaborativeDiagram(doc, deserializeDiagram(files[diagramPath(item.slug)] ?? null, files[layoutPath(item.slug)] ?? null).snapshot);
}

/** The text of the room's diagram file when it has errors (merge markers, a bad hand edit), else null. */
export function brokenDiagramText(item: CollaborationItem, files: Record<string, string | null>): string | null {
  const text = item.kind === 'diagram' ? files[diagramPath(item.slug)] ?? null : null;
  return text !== null && deserializeDiagram(text, null).diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? text : null;
}

/** The files a room writes: the diagram as every peer reads it (repaired, see `sanitizeCollaborativeDiagram`). */
export function projectedCollaborationFiles(
  doc: Y.Doc,
  item: CollaborationItem,
  onRepair?: (repairs: CollaborativeRepair[]) => void,
  /** The doc's `inspectCollaborativeDiagram`, when the caller already has it. */
  inspected = item.kind === 'diagram' ? inspectCollaborativeDiagram(doc) : null,
): Record<string, string> {
  if (item.kind === 'doc') return { [docPath(item.slug)]: doc.getText('content').toString() };
  const read = inspected;
  if (!read) throw new CollaborationRefusal('Diagrama colaborativo não inicializado.');
  if (read.repairs.length) onRepair?.(read.repairs);
  const { model, layout } = read.snapshot;
  const json = printDiagramJson(model);
  const positions = printLayout(model, layout);
  const parsed = deserializeDiagram(json, positions);
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) throw new CollaborationRefusal('Uma edição colaborativa tornou o diagrama inválido.');
  return { [diagramPath(item.slug)]: json, [layoutPath(item.slug)]: positions };
}

/** Import a file edit made by CLI/MCP; a competing text edit is reported as a conflict. */
export function importCollaborationFiles(doc: Y.Doc, item: CollaborationItem, before: Record<string, string | null>, after: Record<string, string | null>): void {
  if (item.kind === 'doc') {
    const old = before[docPath(item.slug)] ?? '';
    const next = after[docPath(item.slug)] ?? '';
    if (old === next) return;
    const text = doc.getText('content');
    if (text.toString() !== old) throw new CollaborationRefusal('Documento alterado simultaneamente fora da sessão. Resolva o conflito antes de publicar.');
    let prefix = 0;
    while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) prefix++;
    let suffix = 0;
    while (suffix < old.length - prefix && suffix < next.length - prefix && old[old.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
    // Insert before deleting: the new text keeps the removed text as its right neighbour, so a peer's concurrent
    // insert after that text stays after it (deleting first lets Yjs place both by client id).
    doc.transact(() => {
      const inserted = next.slice(prefix, next.length - suffix);
      text.insert(prefix, inserted);
      text.delete(prefix + inserted.length, old.length - prefix - suffix);
    });
    return;
  }
  const previous = deserializeDiagram(before[diagramPath(item.slug)] ?? null, before[layoutPath(item.slug)] ?? null);
  const current = deserializeDiagram(after[diagramPath(item.slug)] ?? null, after[layoutPath(item.slug)] ?? null);
  if (current.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) throw new CollaborationRefusal('Diagrama alterado fora do Joinlet contém erros.');
  assertFits(current.snapshot);
  applyCollaborativeDiagramDelta(doc, previous.snapshot, current.snapshot);
}
