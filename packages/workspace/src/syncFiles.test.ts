import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectSourceFiles, importSource } from './syncFiles';
import type { Source } from './sources';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function repo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'strukt-sync-files-'));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, 'utf8');
  }
  return root;
}

const source = (kind: Source['kind'], include: string[], extra: Partial<Source> = {}): Source => ({ id: 's', kind, include, diagram: 'd', mode: 'merge', ...extra });

const MAIN_TF = 'resource "aws_instance" "web" {\n  ami = "x"\n  subnet_id = aws_subnet.a.id\n}\n';
const NET_TF = 'resource "aws_subnet" "a" {\n  cidr_block = "10.0.1.0/24"\n}\nresource "aws_lb" "front" {\n  subnets = [aws_subnet.a.id]\n}\n';

describe('collectSourceFiles', () => {
  it('selects by glob, sorted, and applies negations', async () => {
    const root = await repo({ 'infra/b.tf': '', 'infra/a.tf': '', 'infra/mod/c.tf': '', 'infra/legacy/old.tf': '', 'infra/readme.md': '', 'other/x.tf': '' });
    expect(await collectSourceFiles(root, ['infra/**/*.tf', '!infra/legacy/**'])).toEqual({ files: ['infra/a.tf', 'infra/b.tf', 'infra/mod/c.tf'] });
    expect(await collectSourceFiles(root, ['infra/*.tf'])).toEqual({ files: ['infra/a.tf', 'infra/b.tf'] });
    expect(await collectSourceFiles(root, ['infra/a.tf'])).toEqual({ files: ['infra/a.tf'] });
    expect(await collectSourceFiles(root, ['{infra,other}/**/*.tf', '!infra/**'])).toEqual({ files: ['other/x.tf'] });
  });

  it('never walks .git, node_modules, .terraform or .arch', async () => {
    const root = await repo({ 'a.tf': '', 'node_modules/p/x.tf': '', '.git/x.tf': '', '.terraform/x.tf': '', '.arch/x.tf': '', 'sub/node_modules/y.tf': '' });
    expect(await collectSourceFiles(root, ['**/*.tf'])).toEqual({ files: ['a.tf'] });
  });

  it('does not follow symlinks (files, directories or a linked start folder)', async () => {
    const outside = await repo({ 'secret/x.tf': 'resource "a" "b" {}' });
    const root = await repo({ 'real/ok.tf': '' });
    await symlink(join(outside, 'secret'), join(root, 'linked'));
    await symlink(join(outside, 'secret/x.tf'), join(root, 'real/link.tf'));
    await symlink(outside, join(root, 'real/dir'));
    expect(await collectSourceFiles(root, ['**/*.tf'])).toEqual({ files: ['real/ok.tf'] });
    expect(await collectSourceFiles(root, ['linked/*.tf'])).toEqual({ files: [] });
  });

  it('returns an empty list for a missing folder', async () => {
    const root = await repo({ 'a.tf': '' });
    expect(await collectSourceFiles(root, ['nope/**/*.tf'])).toEqual({ files: [] });
  });

  it('stops with an error past the file or entry limit instead of truncating', async () => {
    const root = await repo({ 'a.tf': '', 'b.tf': '', 'c.tf': '' });
    expect(await collectSourceFiles(root, ['*.tf'], { entries: 100, files: 2 })).toMatchObject({ error: expect.stringContaining('Mais de 2 arquivos') });
    expect(await collectSourceFiles(root, ['*.tf'], { entries: 2, files: 100 })).toMatchObject({ error: expect.stringContaining('entradas') });
  });
});

describe('importSource (real importers)', () => {
  it('joins Terraform files so references across files become connections, with the file name in warnings', async () => {
    const root = await repo({ 'infra/main.tf': MAIN_TF, 'infra/net.tf': `${NET_TF}\nmodule "vpc" {\n  source = "./vpc"\n}\n` });
    const result = await importSource(root, source('terraform', ['infra/*.tf']));
    expect(result.error).toBeUndefined();
    expect(result.files).toEqual(['infra/main.tf', 'infra/net.tf']);
    expect(Object.keys(result.model.elements)).toEqual(expect.arrayContaining(['aws_instance.web', 'aws_subnet.a', 'aws_lb.front']));
    expect(result.model.edges.map((e) => `${e.from}>${e.to}`)).toEqual(expect.arrayContaining(['aws_instance.web>aws_subnet.a', 'aws_lb.front>aws_subnet.a']));
    expect(result.warnings.some((w) => w.startsWith('infra/net.tf:') && w.includes('module'))).toBe(true);
  });

  it('imports a Kubernetes stream from several manifests', async () => {
    const root = await repo({
      'k8s/ns.yaml': 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: shop\n',
      'k8s/web.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n  namespace: shop\nspec:\n  template:\n    metadata:\n      labels:\n        app: web\n    spec:\n      containers:\n        - name: web\n          image: nginx\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: web-svc\n  namespace: shop\nspec:\n  selector:\n    app: web\n',
    });
    const result = await importSource(root, source('kubernetes', ['k8s/*.yaml']));
    expect(result.error).toBeUndefined();
    expect(result.model.elements['shop/Deployment/web']).toBeDefined();
    expect(result.model.edges.map((e) => `${e.from}>${e.to}`)).toContain('shop/Service/web-svc>shop/Deployment/web');
  });

  it('imports OpenAPI files one by one and unites the models', async () => {
    const root = await repo({
      'api/a.json': JSON.stringify({ openapi: '3.0.0', info: { title: 'Pedidos' }, paths: { '/pedidos': { get: { tags: ['p'] } } } }),
      'api/b.json': JSON.stringify({ openapi: '3.0.0', info: { title: 'Estoque' }, paths: { '/itens': { get: { tags: ['e'] } } } }),
    });
    const result = await importSource(root, source('openapi', ['api/*.json']));
    expect(result.error).toBeUndefined();
    expect(Object.keys(result.model.elements)).toEqual(expect.arrayContaining(['Pedidos', 'Estoque', 'GET /pedidos', 'GET /itens']));
  });

  it('imports D2 and Mermaid', async () => {
    const root = await repo({ 'docs/a.d2': 'web -> api: HTTPS\napi -> db\n', 'docs/g.mmd': 'flowchart LR\n  A[Web] --> B[API]\n' });
    const d2 = await importSource(root, source('d2', ['docs/*.d2']));
    expect(d2.model.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['web>api', 'api>db']);
    const mermaid = await importSource(root, source('mermaid', ['docs/*.mmd']));
    expect(Object.keys(mermaid.model.elements)).toEqual(['A', 'B']);
  });

  it('blocks with a clear error when nothing matches', async () => {
    const root = await repo({ 'a.txt': '' });
    const result = await importSource(root, source('terraform', ['infra/**/*.tf'], { id: 'infra' }));
    expect(result.error).toMatch(/Nenhum arquivo casa/);
    expect(result.error).toContain('joinlet sources remove infra');
  });

  it('blocks when the importer reads nothing but complains', async () => {
    const root = await repo({ 'main.tf': 'isto não é terraform' });
    const result = await importSource(root, source('openapi', ['main.tf']));
    expect(result.error).toMatch(/Não importei nada/);
    expect(result.model.order).toEqual([]);
  });

  it('keeps going when the importer only warns', async () => {
    const root = await repo({ 'main.tf': 'variable "x" {}\n' });
    const result = await importSource(root, source('terraform', ['main.tf']));
    expect(result.error).toBeUndefined();
    expect(result.model.order).toEqual([]);
  });

  it('refuses unreadable and oversized files', async () => {
    const root = await repo({ 'a.tf': MAIN_TF });
    expect((await importSource(root, source('terraform', ['a.tf']), { read: async () => null })).error).toMatch(/Não consegui ler "a.tf"/);
    expect((await importSource(root, source('terraform', ['a.tf']), { read: async () => 'x'.repeat(2 * 1024 * 1024 + 1) })).error).toMatch(/grande demais/);
    const big = await repo({ 'a.tf': '', 'b.tf': '', 'c.tf': '' });
    const half = 'x'.repeat(1_000_000);
    expect((await importSource(big, source('terraform', ['*.tf']), { read: async () => half })).error).toMatch(/somam mais de/);
  });

  it('turns a throwing importer into an error, not a crash', async () => {
    const root = await repo({ 'a.tf': MAIN_TF });
    const result = await importSource(root, source('terraform', ['a.tf']), { importer: () => { throw new Error('boom'); } });
    expect(result.error).toBe('O importador falhou: boom');
  });
});
