import { expect, it } from 'vitest';
import { inspectContext, writeGeneratedContext, refreshGeneratedContext } from './contextStorage';
import { createMemoryAdapter } from './storage';
import { newWorkspace, addItem, workspaceFiles } from './workspace';

it('fails on missing/obsolete context, removes only generated files, and is idempotent', async () => {
  const data = addItem(newWorkspace('Knowledge'), 'diagram', 'API').data;
  const adapter = createMemoryAdapter(workspaceFiles(data));
  expect((await inspectContext(adapter, data)).missing).toContain('context/ARCHITECTURE.md');
  await writeGeneratedContext(adapter, data);
  await adapter.write('context/diagrams/deleted.md', 'obsolete');
  await adapter.write('context/team-notes.md', 'keep me');
  expect((await inspectContext(adapter, data)).obsolete).toEqual(['context/diagrams/deleted.md']);
  expect(await writeGeneratedContext(adapter, data)).toEqual(['context/diagrams/deleted.md']);
  expect(await adapter.read('context/team-notes.md')).toBe('keep me');
  expect(await writeGeneratedContext(adapter, data)).toEqual([]);
});

it('refreshes persisted document edits and never publishes incomplete manifests as fresh context', async () => {
  let data = addItem(newWorkspace('Knowledge'), 'doc', 'Decisions').data;
    data = addItem(data, 'diagram', 'API').data;
    data.diagrams.api!.model.elements.API = { kind: 'node', id: 'API', link: 'doc:decisions' };
    data.diagrams.api!.model.order = ['API'];
  const adapter = createMemoryAdapter(workspaceFiles(data));
  expect(await refreshGeneratedContext(adapter)).toEqual([]);
  await refreshGeneratedContext(adapter, true);
  await adapter.write('docs/decisions.md', '# Decisions\n\nUse a queue for asynchronous notifications.');
  await Promise.all([refreshGeneratedContext(adapter), refreshGeneratedContext(adapter)]);
  expect(await adapter.read('context/ARCHITECTURE.md')).toContain('asynchronous notifications');
  const last = await adapter.read('context/ARCHITECTURE.md');
  await adapter.remove('docs/decisions.md');
  expect(await refreshGeneratedContext(adapter)).toEqual([]);
  expect(await adapter.read('context/ARCHITECTURE.md')).toBe(last);
});

it('checks custom context output without deleting outside it', async () => {
  const data = newWorkspace('Custom');
  const adapter = createMemoryAdapter({ 'context/diagrams/keep.md': 'keep', 'agent-context/diagrams/old.md': 'old' });
  await writeGeneratedContext(adapter, data, 'agent-context');
  expect((await inspectContext(adapter, data, 'agent-context')).stale).toBe(false);
  expect(await adapter.read('context/diagrams/keep.md')).toBe('keep');
  expect(await adapter.read('agent-context/diagrams/old.md')).toBeNull();
});
