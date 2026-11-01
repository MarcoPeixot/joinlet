import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { newWorkspace, emptyDiagram, workspaceFiles } from '../workspace';
import { createMemoryAdapter } from '../storage';
import { createFsAdapter } from '../fs';
import { printSources, parseSources } from '../sources';
import { RepositoryEngine } from './engine';
import { command, localReader } from './reader';

const openapi = 'openapi: 3.0.0\ninfo:\n  title: Example\n  version: 1.0.0\npaths: {}\n';
const reader = (paths: string[]) => ({
  list: async () => paths.map(path => ({ path, revision: '1' })),
  revision: async () => 'fixed-revision',
  read: async () => openapi,
});

it('imports long, underscored and similarly normalized OpenAPI paths across restarts', async () => {
  const paths = ['open_api.yaml', 'open-api.yaml', 'api..yaml', 'api--.yaml', `services/${'nested/'.repeat(12)}openapi.yaml`];
  const adapter = createMemoryAdapter();
  const first = await new RepositoryEngine(reader(paths), adapter).run();
  const parsed = parseSources(first.files['sources.json']!);
  expect(parsed.diagnostics).toEqual([]);
  expect(new Set(parsed.sources.map(s => s.diagram)).size).toBe(paths.length);
  for (const source of parsed.sources) {
    expect(source.diagram).toMatch(/^[a-z0-9-]{1,60}$/);
    expect(first.data.diagrams[source.diagram]).toBeTruthy();
    expect(first.data.board.cards.some(card => card.kind === 'diagram' && card.slug === source.diagram)).toBe(true);
  }
  const restarted = await new RepositoryEngine(reader(paths), createMemoryAdapter(Object.fromEntries(adapter.files))).run();
  expect(restarted.changed).toEqual([]);
});

it('creates a configured diagram with its exact portable slug rather than normalizing it as a title', async () => {
  const diagram = 'Shared_API_' + 'x'.repeat(60);
  const adapter = createMemoryAdapter({
    ...workspaceFiles(newWorkspace('Existing architecture')),
    'sources.json': printSources([{ id: 'api', kind: 'openapi', include: ['open_api.yaml'], diagram, mode: 'merge' }]),
  });
  const result = await new RepositoryEngine(reader(['open_api.yaml']), adapter).run();
  expect(result.data.diagrams[diagram]).toBeTruthy();
  expect(result.data.manifest.diagrams.some(d => d.slug === diagram)).toBe(true);
  expect(result.data.board.cards.some(card => card.kind === 'diagram' && card.slug === diagram)).toBe(true);
  expect((await new RepositoryEngine(reader(['open_api.yaml']), adapter).run()).changed).toEqual([]);
});

it('rediscovers missing source mappings without merging into an unrelated existing diagram', async () => {
  const existing = newWorkspace('Shared', { title: 'repository-openapi-openapi-yaml', snapshot: emptyDiagram() });
  existing.diagrams['repository-openapi-openapi-yaml']!.model.elements.Human = { id: 'Human', kind: 'node', label: 'Keep my architecture' };
  existing.diagrams['repository-openapi-openapi-yaml']!.model.order.push('Human');
  const adapter = createMemoryAdapter(workspaceFiles(existing));
  const result = await new RepositoryEngine(reader(['openapi.yaml']), adapter).run();
  const source = parseSources(result.files['sources.json']!).sources[0]!;
  expect(source.diagram).not.toBe('repository-openapi-openapi-yaml');
  expect(result.data.diagrams['repository-openapi-openapi-yaml']).toEqual(existing.diagrams['repository-openapi-openapi-yaml']);
  expect(result.status.pending.join(' ')).toContain('Existing diagram preserved');
});

it('recovers an automatic source target from its sync baseline when sources.json was not shared', async () => {
  const adapter = createMemoryAdapter();
  const first = await new RepositoryEngine(reader(['openapi.yaml']), adapter).run();
  await adapter.remove('sources.json');
  const recovered = await new RepositoryEngine(reader(['openapi.yaml']), adapter).run();
  expect(recovered.files['sources.json']).toBe(first.files['sources.json']);
  expect(recovered.data.manifest.diagrams).toEqual(first.data.manifest.diagrams);
});

it('synchronizes a complete .arch committed by one user and cloned by another without duplicate diagrams', async () => {
  const root = await mkdtemp(join(tmpdir(), 'joinlet-shared-arch-'));
  try {
    const first = join(root, 'first'), second = join(root, 'second');
    await mkdir(first);
    expect((await command('git', ['init', '-q'], first)).code).toBe(0);
    await writeFile(join(first, 'open_api.yaml'), openapi);
    await mkdir(join(first, '.arch'));
    const adapter = createFsAdapter(join(first, '.arch'));
    const initialized = await new RepositoryEngine(await localReader(first), adapter).run();
    expect((await command('git', ['add', '.'], first)).code).toBe(0);
    expect((await command('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'Share architecture'], first)).code).toBe(0);
    expect((await command('git', ['clone', '-q', first, second], root)).code).toBe(0);
    const manifestBefore = await readFile(join(second, '.arch/strukt.json'), 'utf8');
    const reopened = await new RepositoryEngine(await localReader(second), createFsAdapter(join(second, '.arch'))).run();
    expect(reopened.status.initialized).toBe(false);
    expect(reopened.data.manifest.diagrams).toEqual(initialized.data.manifest.diagrams);
    expect(await readFile(join(second, '.arch/strukt.json'), 'utf8')).toBe(manifestBefore);
    expect(reopened.changed).not.toContain('sources.json');
    expect(reopened.changed.filter(path => path.startsWith('diagrams/'))).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
