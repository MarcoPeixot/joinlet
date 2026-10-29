import { connectCards, emptyBoard, reconcileBoard } from '@strukt/workspace';
import { emptyManifest } from '@strukt/workspace';
import type { WorkspaceData } from '@strukt/workspace';
import { describe, expect, it } from 'vitest';
import { boardInFolder, diagramFor, docFor, sketchFor } from './boardFlow';

it('filters Overview by nested folders without changing hidden cards, positions or manual connections',()=>{
 const manifest={...emptyManifest('Project'),diagrams:[{slug:'api',title:'API',folder:'Architecture'}],docs:[{slug:'guide',title:'Guide',folder:'Repository/docs'},{slug:'readme',title:'README',folder:'Repository'}]};
 let board=reconcileBoard(emptyBoard(),manifest);board=connectCards(board,'link','doc:guide','doc:readme');const original=JSON.stringify(board);
 const selected=boardInFolder(board,manifest,'Repository');expect(selected.cards).toHaveLength(2);expect(selected.connections).toHaveLength(1);
 expect(boardInFolder(board,manifest,'Repository/docs').connections).toEqual([]);expect(boardInFolder(board,manifest,'__root__').cards).toEqual([]);expect(JSON.stringify(board)).toBe(original);expect(boardInFolder(board,manifest,'')).toBe(board);
});
it('keeps architectural references visible in the main view while source documents remain accessible through folders or all items',()=>{
 const manifest={...emptyManifest('Project'),diagrams:[{slug:'api',title:'API'}],docs:[{slug:'readme',title:'README',source:'README.md',folder:'Repository'},{slug:'guide',title:'Guide',source:'docs/guide.md',folder:'Repository/docs'}]};
 let board=reconcileBoard(emptyBoard(),manifest);board=connectCards(board,'reference','diagram:api','doc:readme');
 expect(boardInFolder(board,manifest,'__main__').cards.map(c=>c.id)).toEqual(['diagram:api','doc:readme']);expect(boardInFolder(board,manifest,'Repository').cards).toHaveLength(2);expect(board.cards).toHaveLength(3);
});

function emptyData(): WorkspaceData {
  return { manifest: emptyManifest('Loja'), diagrams: {}, docs: {}, sketches: {}, board: emptyBoard() };
}

describe('content selectors (own(), not map[slug])', () => {
  it('a slug shaped like an Object.prototype member reads as missing content, never a function', () => {
    const data = emptyData();
    expect(diagramFor(data, 'constructor')).toBeUndefined();
    expect(docFor(data, 'toString')).toBeUndefined();
    expect(sketchFor(data, 'valueOf')).toBeUndefined();
    expect(diagramFor(null, 'constructor')).toBeUndefined();
  });
});

