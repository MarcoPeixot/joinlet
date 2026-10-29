import { own } from '@strukt/core';
import type { Board, DiagramSnapshot, WorkspaceData } from '@strukt/workspace';

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
