import { expect, it } from 'vitest';
import { createMemoryAdapter, newWorkspace, parseManifest } from '@strukt/workspace';
import { createDiagramStore } from '../state/diagramStore';
import { createWorkspace } from './workspace';

it('persists identity with the workspace, isolates projects and enforces read-only', async () => {
  const diagram = createDiagramStore();
  const workspace = createWorkspace(diagram);
  const first = createMemoryAdapter();
  const second = createMemoryAdapter();
  await workspace.open(first, () => newWorkspace('First'));
  const details = { name: ' Platform ', description: ' Our team ', logo: 'data:image/png;base64,AAAA' };
  workspace.setDetails(details); await workspace.flush();
  expect(parseManifest(first.files.get('strukt.json')!).manifest).toMatchObject({ name: 'Platform', description: 'Our team', logo: details.logo });
  await workspace.open(second, () => newWorkspace('Second'));
  expect(workspace.store.getState().data!.manifest.logo).toBeUndefined();
  await workspace.open(first, () => newWorkspace('Unused'));
  expect(workspace.store.getState().data!.manifest.logo).toBe(details.logo);
  diagram.getState().setReadOnly('Read only');
  expect(() => workspace.setDetails({ ...details, name: 'Blocked' })).toThrow('Read only');
  diagram.getState().setReadOnly(null);
  expect(() => workspace.setDetails({ ...details, name: ' ' })).toThrow();
  workspace.setDetails({ name: 'Platform', description: '', logo: null }); await workspace.flush();
  expect(parseManifest(first.files.get('strukt.json')!).manifest.logo).toBeUndefined();
  expect(parseManifest(first.files.get('strukt.json')!).manifest.description).toBeUndefined();
});
