import { assertBetaGrowth } from './beta';
import { own } from '@strukt/core';
import type { BoardCard, BoardConnection } from './board';
import { reconcileBoard } from './board';
import type { DiagramSnapshot } from './diagram';
import type { Evidence } from './evidence';
import type { Flow } from './flows';
import type { Perspective } from './perspectives';
import { ITEM_LIST } from './manifest';
import type { ItemKind } from './manifest';
import type { WorkspaceData } from './workspace';

/**
 * Everything `removeItem` drops for one item, kept in memory so a delete can be undone. The values are the
 * (immutable) objects the workspace held, so taking a snapshot copies nothing.
 */
export interface ItemSnapshot {
  kind: ItemKind;
  slug: string;
  title: string;
  /** Position in its manifest list. */
  index: number;
  /** Sidebar folder it was in. */
  folder?: string;
  content: DiagramSnapshot | string;
  flows?: Flow[];
  perspectives?: Perspective[];
  evidence?: Record<string, Evidence[]>;
  sharedView?: Record<string, string>;
  sharedViewRelations?: Record<string, string>;
  concerns?: NonNullable<WorkspaceData['concerns']>;
  card?: BoardCard;
  cardIndex?: number;
  connections?: BoardConnection[];
}

const CONTENT = { diagram: 'diagrams', doc: 'docs', sketch: 'sketches' } as const;

/** `null` when the item does not exist. */
export function snapshotItem(data: WorkspaceData, kind: ItemKind, slug: string): ItemSnapshot | null {
  const list = data.manifest[ITEM_LIST[kind]];
  const index = list.findIndex((entry) => entry.slug === slug);
  const content = own<DiagramSnapshot | string>(data[CONTENT[kind]], slug);
  if (index < 0 || content === undefined) return null;
  const card = data.board.cards.find((c) => c.kind === kind && c.slug === slug);
  const snap: ItemSnapshot = { kind, slug, title: list[index]!.title, index, content };
  const folder = list[index]!.folder;
  if (folder) snap.folder = folder;
  if (card) {
    snap.card = card;
    snap.cardIndex = data.board.cards.indexOf(card);
    snap.connections = data.board.connections.filter((c) => c.from === card.id || c.to === card.id);
  }
  if (kind === 'diagram') {
    const flows = own(data.flows ?? {}, slug);
    if (flows) snap.flows = flows;
    const perspectives = own(data.perspectives ?? {}, slug);
    if (perspectives) snap.perspectives = perspectives;
    const evidence = own(data.evidence ?? {}, slug);
    if (evidence) snap.evidence = evidence;
    const view = own(data.shared?.views ?? {}, slug);
    if (view) snap.sharedView = view;
    const viewRelations = own(data.shared?.viewRelations ?? {}, slug);
    if (viewRelations) snap.sharedViewRelations = viewRelations;
    const concerns = data.concerns?.filter((c) => c.diagram === slug);
    if (concerns?.length) snap.concerns = concerns;
  }
  return snap;
}

/** Puts a snapshotted item back where it was. `null` when its slug is taken again (nothing is overwritten). */
export function restoreItem(data: WorkspaceData, snap: ItemSnapshot): WorkspaceData | null {
  if (snap.kind === 'diagram' && !data.manifest.diagrams.some(item => item.slug === snap.slug)) assertBetaGrowth('diagrams', data.manifest.diagrams.length, data.manifest.diagrams.length + 1);
  const key = ITEM_LIST[snap.kind];
  if (data.manifest[key].some((entry) => entry.slug === snap.slug)) return null;
  const list = [...data.manifest[key]];
  list.splice(Math.min(snap.index, list.length), 0, snap.folder ? { slug: snap.slug, title: snap.title, folder: snap.folder } : { slug: snap.slug, title: snap.title });
  const manifest = { ...data.manifest, [key]: list };
  const next: WorkspaceData = { ...data, manifest };
  const bucket = CONTENT[snap.kind];
  (next as unknown as Record<string, unknown>)[bucket] = { ...data[bucket], [snap.slug]: snap.content };
  let board = data.board;
  if (snap.card) {
    const card = snap.card;
    const cards = board.cards.filter((c) => c.id !== card.id);
    cards.splice(Math.min(snap.cardIndex ?? cards.length, cards.length), 0, card);
    const ids = new Set(cards.map((c) => c.id));
    const known = new Set(board.connections.map((c) => c.id));
    const connections = [...board.connections, ...(snap.connections ?? []).filter((c) => !known.has(c.id) && ids.has(c.from) && ids.has(c.to))];
    board = { ...board, cards, connections };
  }
  board = reconcileBoard(board, manifest);
  next.board = board;
  if (snap.kind === 'diagram') {
    if (snap.flows) next.flows = { ...data.flows, [snap.slug]: snap.flows };
    if (snap.perspectives) next.perspectives = { ...data.perspectives, [snap.slug]: snap.perspectives };
    if (snap.evidence) next.evidence = { ...data.evidence, [snap.slug]: snap.evidence };
    if (data.shared && (snap.sharedView || snap.sharedViewRelations)) {
      next.shared = {
        ...data.shared,
        views: snap.sharedView ? { ...data.shared.views, [snap.slug]: snap.sharedView } : data.shared.views,
        ...(snap.sharedViewRelations ? { viewRelations: { ...data.shared.viewRelations, [snap.slug]: snap.sharedViewRelations } } : {}),
      };
    }
    if (snap.concerns) next.concerns = [...(data.concerns ?? []), ...snap.concerns];
  }
  return next;
}
