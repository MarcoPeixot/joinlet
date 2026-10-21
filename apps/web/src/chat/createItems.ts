import { applyOps, emptyLayout, emptyModel, sketchEditError } from '@strukt/core';
import type { ChatWorkspaceItem } from '@strukt/core';
import type { PreparedWorkspaceItem } from '../workspace/workspace';

/** Prepare every drawing before the workspace commits anything. Heavy renderers load only when needed. */
export async function prepareChatItems(items: ChatWorkspaceItem[], signal: AbortSignal): Promise<PreparedWorkspaceItem[]> {
  const prepared: PreparedWorkspaceItem[] = [];
  for (const item of items) {
    signal.throwIfAborted();
    const common = { title: item.title, ...(item.folder ? { folder: item.folder } : {}) };
    if (item.kind === 'doc') prepared.push({ ...common, kind: 'doc', content: item.markdown });
    else if (item.kind === 'diagram') {
      const result = applyOps(emptyModel(), item.ops);
      if (!result.ok) throw new Error(`${item.title}: ${result.error.message}`);
      const layout = emptyLayout();
      if (result.model.order.length) {
        const { autoLayout } = await import('@strukt/layout/elk');
        layout.nodes = await autoLayout(result.model);
      }
      prepared.push({ ...common, kind: 'diagram', content: { model: result.model, layout } });
    } else {
      const edit = { ...item, kind: 'sketch' as const, summary: item.title, clear: true, remove: [] };
      const error = sketchEditError(edit, []);
      if (error) throw new Error(`${item.title}: ${error}`);
      const { applySketchEdit } = await import('../sketch/applyEdit');
      const content = await applySketchEdit('', edit);
      prepared.push({ ...common, kind: 'sketch', content });
    }
    signal.throwIfAborted();
  }
  return prepared;
}
