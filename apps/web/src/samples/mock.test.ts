import { computeRects, visualBox } from '@strukt/core';
import type { DiagramModel, ID, Rect } from '@strukt/core';
import { createMemoryAdapter, loadWorkspace, workspaceFiles, writeFiles } from '@strukt/workspace';
import { describe, expect, it } from 'vitest';
import { MOCK_DIAGRAMS, mockWorkspace } from './mock';

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function inside(model: DiagramModel, id: ID, group: ID): boolean {
  for (let parent = model.elements[id]?.parentId; parent; parent = model.elements[parent]?.parentId) if (parent === group) return true;
  return false;
}

describe('mock workspace', () => {
  it('survives the trip through the workspace files', async () => {
    const adapter = createMemoryAdapter();
    await writeFiles(adapter, workspaceFiles(mockWorkspace()));
    const loaded = await loadWorkspace(adapter);
    expect(loaded?.warnings).toEqual([]);
    expect(loaded?.data.manifest.diagrams.map((d) => d.title)).toEqual(MOCK_DIAGRAMS.map((d) => d.title));
    expect(loaded?.data.manifest.docs).toHaveLength(1);
  });

  it.each(MOCK_DIAGRAMS)('$title: every node is placed and nothing overlaps', ({ build }) => {
    const { model, layout } = build();
    expect(model.diagnostics).toEqual([]);
    const ids = model.order;
    const rects = computeRects(model, layout);
    const box = (id: ID) => visualBox(model.elements[id]!, rects[id]!);
    for (const id of ids) if (model.elements[id]!.kind === 'node') expect(layout.nodes[id], id).toBeDefined();
    for (const [i, a] of ids.entries()) {
      for (const b of ids.slice(i + 1)) {
        if (inside(model, a, b) || inside(model, b, a)) continue;
        expect(overlaps(box(a), box(b)), `${a} × ${b}`).toBe(false);
      }
    }
  });
});
