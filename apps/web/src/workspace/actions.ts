import { uiText } from '../i18n';
import { own } from '@strukt/core';
import { diagramSlugOf, docSlugOf, removeComments, removeVersions, snapshotItem } from '@strukt/workspace';
import type { ItemKind, ItemSnapshot, StorageAdapter } from '@strukt/workspace';
import { diagramStore } from '../state/appStore';
import { closeSidebarOnMobile, focusToastAction, requestFit, showToast, uiStore } from '../ui/uiStore';
import { workspace } from './appWorkspace';
import { ITEM_LABELS } from './labels';

/** Whether the latest user input was the keyboard (a delete from a menu/button then hands focus to "Desfazer"). */
let lastInputWasKeyboard = false;
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('keydown', () => { lastInputWasKeyboard = true; }, true);
  window.addEventListener('pointerdown', () => { lastInputWasKeyboard = false; }, true);
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

// `workspace.openDiagram`/`create`/`remove` reject while an AI draft locks the diagram store
// (Task 6); every caller here toasts the reason instead of leaving an unhandled rejection.

export async function openItem(kind: ItemKind, slug: string): Promise<void> {
  try {
    if (kind === 'diagram') {
      await workspace.openDiagram(slug);
      uiStore.setState({ diagramTrail: [] });
      requestFit();
    } else {
      await workspace.show({ kind, slug });
    }
  } catch (err) {
    showToast(reason(err));
  }
}

export async function createItem(kind: ItemKind, title: string, folder?: string): Promise<void> {
  try {
    await workspace.create(kind, title, undefined, folder);
    closeSidebarOnMobile();
    if (kind === 'diagram') requestFit();
  } catch (err) {
    showToast(reason(err));
  }
}

/** How long "Desfazer" is offered; a diagram's versions are only dropped after it. */
export const UNDO_MS = 8000;

interface PendingDelete {
  kind: ItemKind;
  slug: string;
  snapshot: ItemSnapshot;
  /** The storage that owned the item: the snapshot only makes sense there. */
  storage: StorageAdapter | null;
}

/**
 * Pending deletes, oldest first. Design: one toast, one window. The toast always offers the LATEST delete
 * ("Desfazer", or "Desfazer (n)" when n are pending); undoing it re-offers the previous one with a fresh window,
 * so every delete stays undoable for as long as the toast is around. Nothing is finalized (a diagram's versions
 * removed) while the toast offers undo; when the offer ends without undo (timeout, explicit dismissal) ALL pending
 * deletes are finalized at once. Unrelated toasts never replace the offer: `showToast` queues them behind it.
 */
let pending: PendingDelete[] = [];
/** Identifies the toast currently offering undo: a toast it replaced expiring must not finalize anything. */
let offerId = 0;

// A slug still inside its undo window is not an orphan: `workspace.create` must not clear its versions.
workspace.keepVersionsWhile((slug) => pending.some((entry) => entry.kind === 'diagram' && entry.slug === slug));

/** Drops what a deleted item leaves outside the workspace data: a diagram's versions, and the comments of a diagram or doc. */
async function finalizeDelete(entry: PendingDelete): Promise<void> {
  if ((entry.kind !== 'diagram' && entry.kind !== 'doc') || !entry.storage) return;
  // Only the open workspace's manifest is readable; a different storage is left alone (versions are never lost
  // by accident, and creating a diagram over orphan versions clears them).
  if (workspace.storage() !== entry.storage) return;
  const data = workspace.store.getState().data;
  if (!data || (entry.kind === 'diagram' ? own(data.diagrams, entry.slug) : own(data.docs, entry.slug)) !== undefined) return;
  try {
    if (entry.kind === 'diagram') await removeVersions(entry.storage, entry.slug);
  } catch {
    showToast(uiText("Não foi possível apagar as versões do diagrama."));
  }
  try {
    await removeComments(entry.storage, entry.kind, entry.slug);
  } catch {
    showToast(uiText("Não foi possível apagar os comentários."));
  }
}

function finalizeAll(): void {
  const entries = pending;
  pending = [];
  for (const entry of entries) void finalizeDelete(entry);
}

function offerUndo(): void {
  const top = pending[pending.length - 1];
  if (!top) return;
  const id = ++offerId;
  const label = pending.length > 1 ? uiText("Desfazer ({0})", [pending.length]) : uiText("Desfazer");
  showToast(uiText("{0} “{1}” excluído", [capitalize(ITEM_LABELS[top.kind].one), top.snapshot.title]), {
    label,
    run: () => undoDelete(),
    onExpire: () => { if (id === offerId) finalizeAll(); },
  });
}

function undoDelete(): void {
  const entry = pending.pop();
  if (!entry) return;
  if (workspace.storage() !== entry.storage) {
    showToast(uiText("O workspace mudou; não dá para desfazer a exclusão."));
    finalizeAll();
    void finalizeDelete(entry);
    return;
  }
  workspace.restore(entry.snapshot).then(
    () => {
      if (entry.kind === 'diagram') requestFit();
      offerUndo();
      if (lastInputWasKeyboard && pending.length > 0) focusToastAction();
    },
    (err) => {
      showToast(reason(err));
      finalizeAll();
      void finalizeDelete(entry); // slug taken again: the guard keeps the live diagram's versions
    },
  );
}

/**
 * Soft delete: the item leaves the workspace (and disk, through autosave) at once, and an in-memory snapshot
 * lets "Desfazer" write everything back (see `pending`). A diagram's versions are the only thing not restorable
 * from the snapshot (they live outside the workspace data), so they are dropped after the window, only if the slug
 * is still absent. The snapshot belongs to the workspace storage that owned it: undoing after a switch is refused.
 * Closing the app inside the window leaves the versions on disk; `workspace.create` clears such orphans.
 * When the delete came from the keyboard, focus moves to "Desfazer" so it is reachable (WCAG 2.2.1/2.1.1).
 */
export async function deleteItem(kind: ItemKind, slug: string): Promise<void> {
  const data = workspace.store.getState().data;
  const snapshot = data ? snapshotItem(data, kind, slug) : null;
  if (!snapshot) return;
  const storage = workspace.storage();
  const fromKeyboard = lastInputWasKeyboard;
  try {
    await workspace.remove(kind, slug);
  } catch (err) {
    showToast(reason(err));
    return;
  }
  pending.push({ kind, slug, snapshot, storage });
  offerUndo();
  if (fromKeyboard) focusToastAction();
}

export function renameItem(kind: ItemKind, slug: string, title: string): void {
  workspace.rename(kind, slug, title);
}

/** Follows a `link: "doc:<slug>"` from a diagram element. */
export async function openDocLink(link: string | undefined): Promise<void> {
  const slug = docSlugOf(link);
  if (!slug) return;
  const data = workspace.store.getState().data;
  if (!data || own(data.docs, slug) === undefined) {
    showToast(uiText("Documento não encontrado no workspace."));
    return;
  }
  try {
    await workspace.show({ kind: 'doc', slug });
  } catch (err) {
    showToast(reason(err));
  }
}

export async function openDiagramLink(link: string | undefined): Promise<void> {
  const slug = diagramSlugOf(link);
  if (!slug) return;
  const current = workspace.store.getState();
  if (!current.data || own(current.data.diagrams, slug) === undefined) { showToast(uiText("Diagrama não encontrado no workspace.")); return; }
  try {
    await workspace.openDiagram(slug);
    const trail = uiStore.getState().diagramTrail;
    uiStore.setState({ diagramTrail: [...(trail.length ? trail : current.diagram ? [current.diagram] : []), slug] });
    requestFit();
  } catch (err) { showToast(reason(err)); }
}

export async function openTrailDiagram(slug: string, index: number): Promise<void> {
  try {
    await workspace.openDiagram(slug);
    uiStore.setState({ diagramTrail: uiStore.getState().diagramTrail.slice(0, index + 1) });
    requestFit();
  } catch (err) { showToast(reason(err)); }
}

/** Opens a diagram with one element selected ("Referenciado por"). */
export async function revealElement(diagram: string, id: string): Promise<void> {
  try {
    await workspace.openDiagram(diagram);
  } catch (err) {
    showToast(reason(err));
    return;
  }
  diagramStore.getState().select({ nodes: [id], edges: [] });
  requestFit();
}

/** For the M3 "Gerar documentação" modal: keeps the generated Markdown as a workspace doc. */
export async function saveMarkdownAsDoc(title: string, markdown: string): Promise<void> {
  try {
    await workspace.create('doc', title, markdown);
  } catch (err) {
    showToast(reason(err));
  }
}
