import { mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDiagramJson } from '@strukt/json';
import { parseLayout } from '@strukt/workspace';
import { run } from '../main';
import { argsOf, cleanupDirs, diagramJson, fakeIo, manifestOf, tempDir, writeArch } from '../testing';
import { runSync } from './sync';

afterEach(cleanupDirs);

const MAIN_TF = 'resource "aws_instance" "web" {\n  ami = "x"\n  subnet_id = aws_subnet.a.id\n}\nresource "aws_subnet" "a" {\n  cidr_block = "10.0.1.0/24"\n}\n';
const SOURCES = JSON.stringify({ version: 1, sources: [{ id: 'infra', kind: 'terraform', include: ['infra/*.tf'], diagram: 'infra', mode: 'merge' }] });

async function writeRepo(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, 'utf8');
  }
}

/** A repository with a workspace (diagrams "infra" and "outro"), Terraform in infra/ and one source. */
async function repo(extra: Record<string, string> = {}, sources = SOURCES): Promise<string> {
  const root = await tempDir();
  await writeArch(root, {
    'strukt.json': manifestOf('Loja', [{ slug: 'infra', title: 'Infra' }, { slug: 'outro', title: 'Outro' }]),
    'diagrams/infra.strukt.json': diagramJson(),
    'diagrams/outro.strukt.json': diagramJson('Fica', 'Quieto'),
    'sources.json': sources,
  });
  await writeRepo(root, { 'infra/main.tf': MAIN_TF, 'README.md': '# repo\n', ...extra });
  return root;
}

const arch = (root: string, path: string) => readFile(join(root, '.arch', path), 'utf8');
const model = async (root: string, slug = 'infra') => parseDiagramJson(await arch(root, `diagrams/${slug}.strukt.json`)).model;

/** Every file under `dir` with its content, for before/after comparisons. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else out[path.slice(dir.length)] = await readFile(path, 'utf8');
    }
  };
  await walk(dir);
  return out;
}

describe('runSync', () => {
  it('says nothing is configured and succeeds when there is no sources file', async () => {
    const root = await repo();
    await rm(join(root, '.arch', 'sources.json'));
    const io = fakeIo();
    expect(await runSync(argsOf('sync', '--dir', root), io)).toBe(0);
    expect(io.outText).toContain('Nenhuma fonte configurada');
    expect(await runSync(argsOf('sync', '--check', '--dir', root), fakeIo())).toBe(0);
  });

  it('fails with the problems of an invalid sources file', async () => {
    const root = await repo({}, JSON.stringify({ version: 1, sources: [{ id: 'x', kind: 'terraform', include: ['../fora/*.tf'], diagram: '../x' }] }));
    const io = fakeIo();
    expect(await runSync(argsOf('sync', '--dir', root), io)).toBe(1);
    expect(io.outText).toContain('sources[0].include[0]');
    expect(io.outText).toContain('sources[0].diagram');
  });

  it('exits 2 outside a workspace', async () => {
    const io = fakeIo();
    expect(await runSync(argsOf('sync', '--dir', await tempDir()), io)).toBe(2);
    expect(io.errText).toContain('Nenhum workspace');
  });

  it('first sync imports into the diagram, lays it out and records the base', async () => {
    const root = await repo();
    const io = fakeIo();
    expect(await runSync(argsOf('sync', '--dir', root), io)).toBe(0);
    const diagram = await model(root);
    expect(diagram.order).toEqual(['aws_instance.web', 'aws_subnet.a']);
    expect(diagram.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['aws_instance.web>aws_subnet.a']);
    const layout = parseLayout(await arch(root, 'diagrams/infra.layout.json'));
    expect(Object.keys(layout).sort()).toEqual(['aws_instance.web', 'aws_subnet.a']);
    expect(JSON.parse(await arch(root, 'sync.json')).sources.infra.diagram).toBe('infra');
    expect(io.outText).toContain('+ aws_instance.web');
    expect(io.outText).toContain('Gravado em .arch/');
    expect(io.outText).toContain('Sincronizado.');
    expect(io.outText).not.toContain('Desatualizado');
  });

  it('is idempotent: a second sync writes nothing and --check passes', async () => {
    const root = await repo();
    await runSync(argsOf('sync', '--dir', root), fakeIo());
    const before = await snapshot(root);
    const io = fakeIo();
    expect(await runSync(argsOf('sync', '--dir', root), io)).toBe(0);
    expect(io.outText).not.toContain('Gravado');
    expect(io.outText).toContain('Tudo em dia');
    expect(await snapshot(root)).toEqual(before);
    expect(await runSync(argsOf('sync', '--check', '--dir', root), fakeIo())).toBe(0);
  });

  it('--check fails on drift, explains it and writes nothing', async () => {
    const root = await repo();
    expect(await runSync(argsOf('sync', '--check', '--dir', root), fakeIo())).toBe(1);
    await runSync(argsOf('sync', '--dir', root), fakeIo());
    await writeRepo(root, { 'infra/db.tf': 'resource "aws_db_instance" "main" {\n}\n' });
    const before = await snapshot(root);
    const io = fakeIo();
    expect(await runSync(argsOf('sync', '--check', '--dir', root), io)).toBe(1);
    expect(io.errText).toContain('desatualizado');
    expect(io.errText).toContain('infra');
    expect(io.outText).toContain('+ aws_db_instance.main');
    expect(await snapshot(root)).toEqual(before);
  });

  it('keeps ids, positions and human annotations when the source changes', async () => {
    const root = await repo();
    await runSync(argsOf('sync', '--dir', root), fakeIo());
    // People: annotate, add a node and an edge, drag a node.
    const doc = JSON.parse(await arch(root, 'diagrams/infra.strukt.json'));
    doc.nodes.find((n: { id: string }) => n.id === 'aws_instance.web').description = 'Serve o site';
    doc.nodes.push({ id: 'Cliente', shape: 'ellipse' });
    doc.connections.push({ from: 'Cliente', to: 'aws_instance.web', label: 'HTTPS' });
    await writeFile(join(root, '.arch', 'diagrams/infra.strukt.json'), `${JSON.stringify(doc, null, 2)}\n`);
    const layout = JSON.parse(await arch(root, 'diagrams/infra.layout.json'));
    layout.nodes['aws_instance.web'] = { x: 777, y: 333 };
    layout.nodes.Cliente = { x: -400, y: 12 };
    await writeFile(join(root, '.arch', 'diagrams/infra.layout.json'), `${JSON.stringify(layout, null, 2)}\n`);
    // Source: a new resource that the web server depends on.
    await writeRepo(root, { 'infra/main.tf': `${MAIN_TF}resource "aws_sqs_queue" "jobs" {\n}\nresource "aws_lambda_function" "worker" {\n  queue = aws_sqs_queue.jobs.id\n}\n` });
    expect(await runSync(argsOf('sync', '--dir', root), fakeIo())).toBe(0);
    const after = await model(root);
    expect(after.order).toEqual(['aws_instance.web', 'aws_subnet.a', 'Cliente', 'aws_sqs_queue.jobs', 'aws_lambda_function.worker']);
    expect(after.elements['aws_instance.web']!.description).toBe('Serve o site');
    expect(after.edges.some((e) => e.from === 'Cliente' && e.label === 'HTTPS')).toBe(true);
    expect(after.edges.some((e) => e.from === 'aws_lambda_function.worker' && e.to === 'aws_sqs_queue.jobs')).toBe(true);
    const placed = parseLayout(await arch(root, 'diagrams/infra.layout.json'));
    expect(placed['aws_instance.web']).toEqual({ x: 777, y: 333 });
    expect(placed.Cliente).toEqual({ x: -400, y: 12 });
    expect(placed['aws_sqs_queue.jobs']).toBeDefined();
    expect(placed['aws_lambda_function.worker']).toBeDefined();
    expect(await runSync(argsOf('sync', '--check', '--dir', root), fakeIo())).toBe(0);
  });

  it('removes what left the source, keeps what people edited and reports it', async () => {
    const root = await repo();
    await runSync(argsOf('sync', '--dir', root), fakeIo());
    const doc = JSON.parse(await arch(root, 'diagrams/infra.strukt.json'));
    doc.nodes.find((n: { id: string }) => n.id === 'aws_subnet.a').description = 'Rede privada';
    await writeFile(join(root, '.arch', 'diagrams/infra.strukt.json'), `${JSON.stringify(doc, null, 2)}\n`);
    await writeRepo(root, { 'infra/main.tf': 'resource "aws_instance" "web" {\n  ami = "x"\n}\n' });
    const io = fakeIo();
    expect(await runSync(argsOf('sync', '--dir', root), io)).toBe(0);
    const after = await model(root);
    expect(after.order).toEqual(['aws_instance.web', 'aws_subnet.a']);
    expect(after.edges).toEqual([]);
    expect(io.outText).toContain('Preservado do trabalho manual');
    expect(io.outText).toContain('aws_subnet.a');
    expect(parseLayout(await arch(root, 'diagrams/infra.layout.json'))['aws_subnet.a']).toBeDefined();
  });

  it('replace mode mirrors the source', async () => {
    const root = await repo({}, JSON.stringify({ version: 1, sources: [{ id: 'infra', kind: 'terraform', include: ['infra/*.tf'], diagram: 'infra', mode: 'replace' }] }));
    await runSync(argsOf('sync', '--dir', root), fakeIo());
    const doc = JSON.parse(await arch(root, 'diagrams/infra.strukt.json'));
    doc.nodes.push({ id: 'Cliente' });
    await writeFile(join(root, '.arch', 'diagrams/infra.strukt.json'), `${JSON.stringify(doc, null, 2)}\n`);
    expect(await runSync(argsOf('sync', '--dir', root), fakeIo())).toBe(0);
    expect((await model(root)).order).toEqual(['aws_instance.web', 'aws_subnet.a']);
  });

  it('only writes inside .arch and never touches other diagrams', async () => {
    const root = await repo();
    const before = await snapshot(root);
    await runSync(argsOf('sync', '--dir', root), fakeIo());
    const after = await snapshot(root);
    const changed = Object.keys(after).filter((path) => before[path] !== after[path]);
    expect(changed.length).toBeGreaterThan(0);
    for (const path of changed) {
      expect(path.startsWith('/.arch/'), path).toBe(true);
      expect(path).not.toContain('diagrams/outro');
    }
    expect(after['/README.md']).toBe(before['/README.md']);
    expect(await arch(root, 'diagrams/outro.strukt.json')).toBe(diagramJson('Fica', 'Quieto'));
  });

  it('does not follow symlinks out of the repository', async () => {
    const outside = await tempDir();
    await writeRepo(outside, { 'secret.tf': 'resource "aws_s3_bucket" "vazado" {\n}\n' });
    const root = await repo();
    await symlink(join(outside, 'secret.tf'), join(root, 'infra', 'link.tf'));
    await symlink(outside, join(root, 'infra', 'dir'));
    await runSync(argsOf('sync', '--dir', root), fakeIo());
    expect((await model(root)).order).not.toContain('aws_s3_bucket.vazado');
  });

  it('a failing source blocks only its diagram and exits 1', async () => {
    const sources = JSON.stringify({ version: 1, sources: [
      { id: 'infra', kind: 'terraform', include: ['infra/*.tf'], diagram: 'infra', mode: 'merge' },
      { id: 'api', kind: 'openapi', include: ['api/*.yaml'], diagram: 'outro', mode: 'merge' },
    ] });
    const root = await repo({}, sources);
    const io = fakeIo();
    expect(await runSync(argsOf('sync', '--dir', root), io)).toBe(1);
    expect(io.outText).toContain('Nenhum arquivo casa');
    expect((await model(root)).order).toEqual(['aws_instance.web', 'aws_subnet.a']);
    expect(await arch(root, 'diagrams/outro.strukt.json')).toBe(diagramJson('Fica', 'Quieto'));
    expect(JSON.parse(await arch(root, 'sync.json')).sources.api).toBeUndefined();
  });

  it('refreshes .arch/context only when it already existed', async () => {
    const root = await repo();
    await runSync(argsOf('sync', '--dir', root), fakeIo());
    await expect(readFile(join(root, '.arch', 'context', 'ARCHITECTURE.md'), 'utf8')).rejects.toThrow();
    await writeArch(root, { 'context/ARCHITECTURE.md': 'velho\n' });
    await writeRepo(root, { 'infra/db.tf': 'resource "aws_db_instance" "main" {\n}\n' });
    expect(await runSync(argsOf('sync', '--dir', root), fakeIo())).toBe(0);
    expect(await arch(root, 'context/ARCHITECTURE.md')).toContain('aws_db_instance.main');
  });

  it('prints JSON and Markdown reports', async () => {
    const root = await repo();
    const json = fakeIo();
    expect(await runSync(argsOf('sync', '--check', '--json', '--dir', root), json)).toBe(1);
    const report = JSON.parse(json.outText);
    expect(report).toMatchObject({ ok: true, stale: true, configured: true, diagrams: [{ slug: 'infra', added: ['aws_instance.web', 'aws_subnet.a'] }] });
    const md = fakeIo();
    await runSync(argsOf('sync', '--markdown', '--dir', root), md);
    expect(md.outText).toContain('## Sincronização de fontes');
    expect(md.outText).toContain('- + `aws_instance.web`');
  });

  it('works end to end through the CLI entry point with other importers', async () => {
    const sources = JSON.stringify({ version: 1, sources: [
      { id: 'k8s', kind: 'kubernetes', include: ['k8s/*.yaml'], diagram: 'infra', mode: 'merge' },
      { id: 'api', kind: 'openapi', include: ['api/openapi.json'], diagram: 'outro', mode: 'merge' },
    ] });
    const root = await repo({
      'k8s/web.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n  namespace: shop\nspec:\n  template:\n    metadata:\n      labels:\n        app: web\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: web-svc\n  namespace: shop\nspec:\n  selector:\n    app: web\n',
      'api/openapi.json': JSON.stringify({ openapi: '3.0.0', info: { title: 'Pedidos' }, paths: { '/pedidos': { get: { tags: ['p'], summary: 'Lista' } } } }),
    }, sources);
    const io = fakeIo();
    expect(await run(['sync', '--dir', root], io)).toBe(0);
    expect((await model(root)).order).toEqual(expect.arrayContaining(['shop/Deployment/web', 'shop/Service/web-svc']));
    expect((await model(root, 'outro')).order).toEqual(expect.arrayContaining(['Fica', 'Quieto', 'Pedidos', 'GET /pedidos']));
    expect(await run(['sync', '--check', '--dir', root], fakeIo())).toBe(0);
  });
});
