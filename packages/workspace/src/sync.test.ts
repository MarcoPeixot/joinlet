import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyOps, own } from '@strukt/core';
import type { DiagramOp } from '@strukt/core';
import { printDiagramJson } from '@strukt/json';
import { createMemoryAdapter } from './storage';
import type { MemoryAdapter } from './storage';
import { addItem, loadWorkspace, newWorkspace, workspaceFiles } from './workspace';
import type { WorkspaceData } from './workspace';
import { SOURCES_PATH, printSources } from './sources';
import type { Source } from './sources';
import { SYNC_PATH, planSync } from './sync';
import type { SyncPlan } from './sync';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const MAIN = 'resource "aws_instance" "web" {\n  ami = "x"\n  subnet_id = aws_subnet.a.id\n}\nresource "aws_subnet" "a" {\n  cidr_block = "10.0.1.0/24"\n}\n';
const DB = 'resource "aws_db_instance" "main" {\n  engine = "postgres"\n}\n';
const infra: Source = { id: 'infra', kind: 'terraform', include: ['infra/*.tf'], diagram: 'infra', mode: 'merge' };

interface Harness {
  root: string;
  adapter: MemoryAdapter;
  data: WorkspaceData;
  write(path: string, text: string): Promise<void>;
  setSources(sources: Source[]): Promise<void>;
  plan(): Promise<SyncPlan>;
  /** What `joinlet sync` does to the files (without layout): the model and `sync.json`. */
  sync(): Promise<SyncPlan>;
  edit(ops: DiagramOp[]): Promise<void>;
}

async function harness(repoFiles: Record<string, string>, sources: Source[] = [infra]): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'strukt-sync-'));
  dirs.push(root);
  const write = async (path: string, text: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, 'utf8');
  };
  for (const [path, text] of Object.entries(repoFiles)) await write(path, text);
  let data = newWorkspace('Loja');
  data = addItem(data, 'diagram', 'Infra').data;
  data = addItem(data, 'diagram', 'API').data;
  const adapter = createMemoryAdapter(workspaceFiles(data));
  adapter.files.set(SOURCES_PATH, printSources(sources));
  const h: Harness = {
    root, adapter, data, write,
    async setSources(next) { adapter.files.set(SOURCES_PATH, printSources(next)); },
    async plan() { return planSync({ root, adapter, data: h.data }); },
    async sync() {
      const plan = await h.plan();
      for (const diagram of plan.diagrams) if (!diagram.blocked) h.data = { ...h.data, diagrams: { ...h.data.diagrams, [diagram.slug]: { ...own(h.data.diagrams, diagram.slug)!, model: diagram.model } } };
      if (plan.state.text) adapter.files.set(SYNC_PATH, plan.state.text);
      else adapter.files.delete(SYNC_PATH);
      return plan;
    },
    async edit(ops) {
      const slug = 'infra';
      const result = applyOps(own(h.data.diagrams, slug)!.model, ops);
      if (!result.ok) throw new Error(result.error.message);
      h.data = { ...h.data, diagrams: { ...h.data.diagrams, [slug]: { ...own(h.data.diagrams, slug)!, model: result.model } } };
    },
  };
  return h;
}

const idsOf = (h: Harness, slug = 'infra') => [...own(h.data.diagrams, slug)!.model.order];

describe('planSync', () => {
  it('does nothing without .arch/sources.json', async () => {
    const h = await harness({});
    h.adapter.files.delete(SOURCES_PATH);
    const plan = await h.plan();
    expect(plan).toMatchObject({ configured: false, stale: false, diagrams: [], errors: [] });
  });

  it('reports a broken sources file and plans nothing', async () => {
    const h = await harness({});
    h.adapter.files.set(SOURCES_PATH, '{"version":1,"sources":[{"id":"x"}]}');
    const plan = await h.plan();
    expect(plan.diagrams).toEqual([]);
    expect(plan.errors.join('\n')).toContain('sources.json: sources[0]');
  });

  it('reports a source that points to a missing diagram', async () => {
    const h = await harness({ 'infra/main.tf': MAIN }, [{ ...infra, diagram: 'nao-existe' }]);
    const plan = await h.plan();
    expect(plan.errors[0]).toContain('"nao-existe" não existe');
  });

  it('plans the first sync: elements, connections and the new sync.json', async () => {
    const h = await harness({ 'infra/main.tf': MAIN });
    const plan = await h.plan();
    expect(plan.errors).toEqual([]);
    expect(plan.stale).toBe(true);
    expect(plan.state.changed).toBe(true);
    const diagram = plan.diagrams[0]!;
    expect(diagram).toMatchObject({ slug: 'infra', mode: 'merge', blocked: false, sources: ['infra'] });
    expect(diagram.model.order).toEqual(['aws_instance.web', 'aws_subnet.a']);
    expect(diagram.model.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['aws_instance.web>aws_subnet.a']);
    expect(plan.sources[0]).toMatchObject({ id: 'infra', files: ['infra/main.tf'] });
    expect(plan.state.text).toContain('aws_instance.web');
  });

  it('is up to date right after a sync (check passes)', async () => {
    const h = await harness({ 'infra/main.tf': MAIN });
    await h.sync();
    const again = await h.plan();
    expect(again.stale).toBe(false);
    expect(again.diagrams[0]!.ops).toEqual([]);
    expect(again.state.changed).toBe(false);
  });

  it('detects drift when the source changes, and merges it keeping human edits', async () => {
    const h = await harness({ 'infra/main.tf': MAIN });
    await h.sync();
    await h.edit([
      { op: 'update', id: 'aws_instance.web', set: { description: 'Serve o site', color: 'red' } },
      { op: 'add_node', id: 'Cliente' },
      { op: 'connect', from: 'Cliente', to: 'aws_instance.web', label: 'HTTPS' },
    ]);
    await h.write('infra/db.tf', DB);
    const plan = await h.plan();
    expect(plan.stale).toBe(true);
    const model = plan.diagrams[0]!.model;
    expect(model.order).toEqual(['aws_instance.web', 'aws_subnet.a', 'Cliente', 'aws_db_instance.main']);
    expect(model.elements['aws_instance.web']).toMatchObject({ description: 'Serve o site', color: 'red' });
    expect(model.edges.some((e) => e.from === 'Cliente')).toBe(true);
    await h.sync();
    expect((await h.plan()).stale).toBe(false);
  });

  it('removes what disappeared from the files, unless people edited it', async () => {
    const h = await harness({ 'infra/main.tf': MAIN, 'infra/db.tf': DB });
    await h.sync();
    await h.edit([{ op: 'update', id: 'aws_subnet.a', set: { description: 'Rede privada' } }]);
    await h.write('infra/main.tf', 'resource "aws_instance" "web" {\n  ami = "x"\n}\n');
    const plan = await h.sync();
    expect(idsOf(h)).toContain('aws_subnet.a');
    expect(plan.diagrams[0]!.notes.map((n) => n.kind)).toContain('kept-edited');
    expect(idsOf(h)).toContain('aws_db_instance.main');
    // The kept node is people's now: a new sync is quiet.
    expect((await h.plan()).stale).toBe(false);
  });

  it('blocks only the diagram whose source failed and keeps its previous base', async () => {
    const h = await harness({ 'infra/main.tf': MAIN, 'api/a.d2': 'web -> api\n' }, [infra, { id: 'api', kind: 'd2', include: ['api/*.d2'], diagram: 'api', mode: 'merge' }]);
    await h.sync();
    const before = h.adapter.files.get(SYNC_PATH);
    await rm(join(h.root, 'api/a.d2'));
    await h.write('infra/db.tf', DB);
    const plan = await h.plan();
    expect(plan.errors.join('\n')).toContain('Fonte "api"');
    const byslug = Object.fromEntries(plan.diagrams.map((d) => [d.slug, d]));
    expect(byslug.api!.blocked).toBe(true);
    expect(byslug.infra!.blocked).toBe(false);
    expect(plan.state.text).toContain('"api"');
    expect(plan.state.text).not.toBe(before);
  });

  it('refuses to wipe a diagram when the sources suddenly produce nothing', async () => {
    const h = await harness({ 'infra/main.tf': MAIN });
    await h.sync();
    await h.write('infra/main.tf', 'variable "x" {}\n');
    const plan = await h.plan();
    expect(plan.errors.join('\n')).toMatch(/não produziram nenhum elemento/);
    expect(plan.diagrams[0]!.blocked).toBe(true);
    expect(plan.diagrams[0]!.ops).toEqual([]);
  });

  it('treats a repointed source as new instead of deleting the old diagram content', async () => {
    const h = await harness({ 'infra/main.tf': MAIN });
    await h.sync();
    await h.setSources([{ ...infra, diagram: 'api' }]);
    const plan = await h.plan();
    expect(plan.errors).toEqual([]);
    const byslug = Object.fromEntries(plan.diagrams.map((d) => [d.slug, d]));
    expect(byslug.api!.model.order).toEqual(['aws_instance.web', 'aws_subnet.a']);
    expect(byslug.infra).toBeUndefined();
  });

  it('keeps the elements of a source that was removed from sources.json', async () => {
    const main: Source = { ...infra, include: ['infra/main.tf'] };
    const h = await harness({ 'infra/main.tf': MAIN, 'infra/db.tf': DB }, [main, { id: 'db', kind: 'terraform', include: ['infra/db.tf'], diagram: 'infra', mode: 'merge' }]);
    await h.sync();
    expect(idsOf(h)).toContain('aws_db_instance.main');
    await h.setSources([main]);
    const plan = await h.sync();
    expect(plan.errors).toEqual([]);
    expect(idsOf(h)).toContain('aws_db_instance.main');
    expect(h.adapter.files.get(SYNC_PATH)).not.toContain('"db"');
    expect((await h.plan()).stale).toBe(false);
  });

  it('removes what no source provides any more when two sources overlapped', async () => {
    const h = await harness({ 'infra/main.tf': MAIN, 'infra/db.tf': DB }, [infra, { id: 'db', kind: 'terraform', include: ['infra/db.tf'], diagram: 'infra', mode: 'merge' }]);
    await h.sync();
    await h.setSources([{ ...infra, include: ['infra/main.tf'] }]);
    await h.sync();
    expect(idsOf(h)).not.toContain('aws_db_instance.main');
  });

  it('combines several sources into one diagram', async () => {
    const h = await harness(
      { 'infra/main.tf': MAIN, 'k8s/web.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n  namespace: shop\n' },
      [{ ...infra, include: ['infra/*.tf'] }, { id: 'k8s', kind: 'kubernetes', include: ['k8s/*.yaml'], diagram: 'infra', mode: 'merge' }],
    );
    const plan = await h.sync();
    expect(plan.errors).toEqual([]);
    expect(idsOf(h)).toEqual(expect.arrayContaining(['aws_instance.web', 'shop/Deployment/web']));
    expect(plan.diagrams).toHaveLength(1);
    expect((await h.plan()).stale).toBe(false);
  });

  it('replace mode mirrors the files and drops people-only elements', async () => {
    const h = await harness({ 'infra/main.tf': MAIN }, [{ ...infra, mode: 'replace' }]);
    await h.sync();
    await h.edit([{ op: 'add_node', id: 'Cliente' }, { op: 'update', id: 'aws_instance.web', set: { description: 'nota' } }]);
    const plan = await h.sync();
    expect(plan.stale).toBe(true);
    expect(idsOf(h)).toEqual(['aws_instance.web', 'aws_subnet.a']);
    expect(own(h.data.diagrams, 'infra')!.model.elements['aws_instance.web']!.description).toBe('nota');
    expect((await h.plan()).stale).toBe(false);
  });

  it('survives hostile names coming from the files', async () => {
    const h = await harness({ 'infra/main.tf': 'resource "constructor" "toString" {\n}\nresource "a" "b" {\n  x = constructor.toString.id\n}\nresource "__proto__" "x" {\n}\n' });
    const plan = await h.sync();
    expect(plan.errors).toEqual([]);
    expect(idsOf(h)).toEqual(['constructor.toString', 'a.b']);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it('produces a diagram that survives a save and reload through the workspace files', async () => {
    const h = await harness({ 'infra/main.tf': MAIN });
    await h.sync();
    const files = workspaceFiles(h.data);
    const reloaded = await loadWorkspace(createMemoryAdapter(files));
    expect(printDiagramJson(own(reloaded!.data.diagrams, 'infra')!.model)).toBe(printDiagramJson(own(h.data.diagrams, 'infra')!.model));
  });
});
