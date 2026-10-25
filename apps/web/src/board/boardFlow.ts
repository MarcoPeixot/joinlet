import { own } from '@strukt/core';
import { cardsInSection } from '@strukt/workspace';
import type { Board, BoardCard, BoardConnection, BoardSection, DiagramSnapshot, WorkspaceData } from '@strukt/workspace';
import type { Edge, Node } from '@xyflow/react';

/** `autoFocus`: the card was just created on the Overview (a new note takes the keyboard). */
export type CardNode = Node<{ card: BoardCard; autoFocus: boolean }, 'card'>;
export type SectionNode = Node<{ section: BoardSection }, 'section'>;
export type BoardNode = CardNode | SectionNode;
export type BoardEdge = Edge<{ connection: BoardConnection }, 'float'>;

/** A reading filter only: hidden items, positions and manual connections stay in the workspace. */
export function boardInFolder(board:Board,manifest:WorkspaceData['manifest'],folder:string):Board{
  if(!folder)return board;
  if(folder==='__main__'){
    const sourceDocs=new Set(manifest.docs.filter(d=>d.source).map(d=>'doc:'+d.slug));
    const visible=new Set(board.cards.filter(c=>!sourceDocs.has(c.id)).map(c=>c.id));
    for(const edge of board.connections){if(edge.from.startsWith('diagram:'))visible.add(edge.to);if(edge.to.startsWith('diagram:'))visible.add(edge.from);}
    const sections=board.sections.filter(section=>{const members=board.cards.filter(c=>c.x>=section.x&&c.y>=section.y&&c.x+c.w<=section.x+section.w&&c.y+c.h<=section.y+section.h);return members.length>0&&members.every(c=>visible.has(c.id));});
    return {...board,cards:board.cards.filter(c=>visible.has(c.id)),sections,connections:board.connections.filter(c=>visible.has(c.from)&&visible.has(c.to))};
  }
  const visible=new Set(['diagram','doc','sketch'].flatMap(kind=>manifest[kind==='diagram'?'diagrams':kind==='doc'?'docs':'sketches'].filter(item=>folder==='__root__'?!item.folder:item.folder===folder||item.folder?.startsWith(folder+'/')).map(item=>kind+':'+item.slug)));
  return {...board,cards:board.cards.filter(card=>visible.has(card.id)),sections:[],connections:board.connections.filter(c=>visible.has(c.from)&&visible.has(c.to))};
}

/**
 * The Overview as React Flow nodes: sections behind cards, sizes fixed by `board.json`. `measured` is set
 * too, so nodes rebuilt on every board change never count as "not initialized" mid-drag.
 */
export function boardToFlow(board: Board, selected: ReadonlySet<string>, focusId?: string | null): { nodes: BoardNode[]; edges: BoardEdge[] } {
  const sections: SectionNode[] = board.sections.map((section) => ({
    id: section.id,
    type: 'section',
    position: { x: section.x, y: section.y },
    width: section.w,
    height: section.h,
    measured: { width: section.w, height: section.h },
    zIndex: 0,
    selected: selected.has(section.id),
    dragHandle: '.strukt-section__head',
    data: { section },
  }));
  const cards: CardNode[] = board.cards.map((card) => ({
    id: card.id,
    type: 'card',
    position: { x: card.x, y: card.y },
    width: card.w,
    height: card.h,
    measured: { width: card.w, height: card.h },
    zIndex: 1,
    selected: selected.has(card.id),
    data: { card, autoFocus: card.id === focusId },
  }));
  const edges: BoardEdge[] = board.connections.map((c) => ({
    id: c.id,
    type: 'float',
    source: c.from,
    target: c.to,
    selected: selected.has(c.id),
    data: { connection: c },
  }));
  return { nodes: [...sections, ...cards], edges };
}

/** Notes, sections and connections can be deleted on the Overview; item cards go with their item (sidebar). */
export function deletableIds(board: Board, ids: readonly string[]): string[] {
  const allowed = new Set([
    ...board.cards.filter((card) => card.kind === 'note').map((card) => card.id),
    ...board.sections.map((section) => section.id),
    ...board.connections.map((c) => c.id),
  ]);
  return ids.filter((id) => allowed.has(id));
}

export interface DeletePlan {
  ids: string[];
  refused: boolean;
}

/**
 * What `onBeforeDelete` should do with a selection of nodes and edges: which ids can actually be
 * removed, and whether anything asked for was refused. Comparing the deletable count against the
 * node count alone (instead of everything asked, nodes and edges together) would miss a refusal
 * when the selection mixes an undeletable item card with an otherwise-deletable connection.
 */
export function deletePlan(board: Board, nodeIds: readonly string[], edgeIds: readonly string[]): DeletePlan {
  const asked = [...nodeIds, ...edgeIds];
  const ids = deletableIds(board, asked);
  return { ids, refused: ids.length < asked.length };
}

/**
 * Diagram/doc/sketch content for a card's slug, read with `own()`: a slug shaped like an
 * Object.prototype member (`constructor`, `toString`, …) is a valid item name (only `__proto__` is
 * refused when a workspace loads), and `data.diagrams[slug]` would silently resolve to that
 * inherited function instead of `undefined`, crashing the card instead of showing it as missing.
 */
export function diagramFor(data: WorkspaceData | null | undefined, slug: string): DiagramSnapshot | undefined {
  return data ? own(data.diagrams, slug) : undefined;
}

export function docFor(data: WorkspaceData | null | undefined, slug: string): string | undefined {
  return data ? own(data.docs, slug) : undefined;
}

export function sketchFor(data: WorkspaceData | null | undefined, slug: string): string | undefined {
  return data ? own(data.sketches, slug) : undefined;
}

export interface SectionDrag {
  id: string;
  origin: { x: number; y: number };
  cards: Record<string, { x: number; y: number }>;
}

/** Remembers which cards sit in the section when its drag starts (they move along with it). */
export function startSectionDrag(board: Board, sectionId: string): SectionDrag | null {
  const section = board.sections.find((s) => s.id === sectionId);
  if (!section) return null;
  const inside = new Set(cardsInSection(board, sectionId));
  const cards: SectionDrag['cards'] = {};
  for (const card of board.cards) if (inside.has(card.id)) cards[card.id] = { x: card.x, y: card.y };
  return { id: sectionId, origin: { x: section.x, y: section.y }, cards };
}

export function followSection(drag: SectionDrag, position: { x: number; y: number }): Record<string, { x: number; y: number }> {
  const dx = position.x - drag.origin.x;
  const dy = position.y - drag.origin.y;
  const moved: Record<string, { x: number; y: number }> = { [drag.id]: position };
  for (const [id, start] of Object.entries(drag.cards)) moved[id] = { x: start.x + dx, y: start.y + dy };
  return moved;
}
