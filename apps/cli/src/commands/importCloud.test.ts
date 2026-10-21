import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SECRET_SENTINELS, terraformStateText } from '@strukt/dsl/cloud-fixtures';
import { parseDiagramJson } from '@strukt/json';
import { afterEach, describe, expect, it } from 'vitest';
import { fixtureCloudRunner } from '../cloudTesting';
import { argsOf, cleanupDirs, diagramJson, fakeIo, manifestOf, tempDir, writeArch } from '../testing';
import { runImportCloud } from './importCloud';

afterEach(cleanupDirs);

async function workspace(files: Record<string, string> = {}): Promise<string> {
  const root = await tempDir();
  await writeArch(root, { 'strukt.json': manifestOf('Loja', []), ...files });
  return root;
}

async function archFiles(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(dir, entry.name), `${prefix}${entry.name}/`);
      else out[`${prefix}${entry.name}`] = await readFile(join(dir, entry.name), 'utf8');
    }
  };
  await walk(join(root, '.arch'), '');
  return out;
}

const awsArgs = (root: string, ...extra: string[]) => argsOf('import', 'cloud', '--provider', 'aws', '--region', 'us-east-1', '--dir', root, ...extra);

describe('joinlet import cloud', () => {
  it('draws the AWS account as a new diagram with positions, and records every resource in cloud.json', async () => {
    const root = await workspace();
    const io = fakeIo();
    expect(await runImportCloud(awsArgs(root), io, fixtureCloudRunner(), { env: {} })).toBe(0);
    expect(io.outText).toMatch(/Diagrama "aws-us-east-1" criado a partir de AWS: \d+ componentes, \d+ conexões; \d+ recursos registrados em \.arch\/cloud\.json\./);
    expect(io.outText).toContain('joinlet check --cloud aws');

    const files = await archFiles(root);
    expect(JSON.parse(files['strukt.json']!).diagrams).toEqual([{ slug: 'aws-us-east-1', title: 'AWS us-east-1' }]);
    const parsed = parseDiagramJson(files['diagrams/aws-us-east-1.strukt.json']!);
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(parsed.model.elements['shop-web-1']).toMatchObject({ icon: 'aws:resource-amazon-ec2-instance', parentId: 'shop-private-a' });
    const layout = JSON.parse(files['diagrams/aws-us-east-1.layout.json']!) as { nodes: Record<string, { x: number; y: number }> };
    expect(Object.keys(layout.nodes).length).toBeGreaterThan(20);
    expect(layout.nodes['shop-web-1']).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });

    const state = JSON.parse(files['cloud.json']!);
    expect(state.version).toBe(1);
    expect(state.sources).toHaveLength(1);
    expect(state.sources[0]).toMatchObject({ diagram: 'aws-us-east-1', origin: 'aws', scope: { region: 'us-east-1' } });
    const web = state.sources[0].resources.find((r: { name: string }) => r.name === 'shop-web-1');
    expect(web).toMatchObject({ id: 'arn:aws:ec2:us-east-1:123456789012:instance/i-0123456789abcdef0', type: 'aws:ec2:instance', node: 'shop-web-1', attrs: { instanceType: 't3.medium' } });
    expect(state.sources[0].resources.find((r: { name: string }) => r.name === 'shop-web-sg').node).toBeUndefined();
  });

  it('writes nothing but .arch/, and no secret, profile or personal address anywhere in it', async () => {
    const root = await workspace();
    await writeFile(join(root, 'README.md'), 'keep');
    expect(await runImportCloud(awsArgs(root, '--profile', 'prod-admin'), fakeIo(), fixtureCloudRunner(), { env: {} })).toBe(0);
    expect(await readdir(root)).toEqual(['.arch', 'README.md']);
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('keep');
    const everything = Object.values(await archFiles(root)).join('\n');
    for (const sentinel of SECRET_SENTINELS) expect(everything, sentinel).not.toContain(sentinel);
    expect(everything).not.toContain('prod-admin');
  });

  it('sends only allowlisted read commands to the CLI, with the profile it was given', async () => {
    const root = await workspace();
    const calls: string[] = [];
    await runImportCloud(awsArgs(root, '--profile', 'prod'), fakeIo(), fixtureCloudRunner({ calls }), { env: {} });
    expect(calls.length).toBeGreaterThan(25);
    expect(calls.every((call) => call.startsWith('aws ') && call.includes('--profile prod') && call.includes('--output json'))).toBe(true);
  });

  it('imports Azure by subscription and resource group, and GCP by project', async () => {
    const root = await workspace();
    const io = fakeIo();
    expect(await runImportCloud(argsOf('import', 'cloud', '--provider', 'azure', '--subscription', '00000000-1111-2222-3333-444444444444', '--dir', root), io, fixtureCloudRunner())).toBe(0);
    expect(await runImportCloud(argsOf('import', 'cloud', '--provider', 'gcp', '--project', 'shop-prod-123456', '--dir', root, '--title', 'Plataforma GCP'), io, fixtureCloudRunner())).toBe(0);
    const files = await archFiles(root);
    expect(JSON.parse(files['strukt.json']!).diagrams.map((d: { slug: string }) => d.slug)).toEqual(['azure-00000000-1111-2222-3333-444444444444', 'plataforma-gcp']);
    expect(parseDiagramJson(files['diagrams/plataforma-gcp.strukt.json']!).model.elements['web-1']).toMatchObject({ parentId: 'shop-prod-123456' });
    expect(JSON.parse(files['cloud.json']!).sources.map((s: { origin: string }) => s.origin)).toEqual(['azure', 'gcp']);
  });

  it('imports a terraform show -json file without calling any CLI', async () => {
    const root = await workspace();
    const file = join(await tempDir(), 'state.json');
    await writeFile(file, terraformStateText);
    const calls: string[] = [];
    const io = fakeIo();
    expect(await runImportCloud(argsOf('import', 'cloud', '--file', file, '--dir', root), io, fixtureCloudRunner({ calls }))).toBe(0);
    expect(calls).toEqual([]);
    const files = await archFiles(root);
    expect(JSON.parse(files['cloud.json']!).sources[0]).toMatchObject({ origin: 'terraform', diagram: 'terraform-estado' });
    expect(Object.values(files).join('\n')).not.toContain('SENTINEL');
  });

  it('keeps earlier diagrams and sources when it imports again, and never overwrites a diagram', async () => {
    const root = await workspace({ 'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }]), 'diagrams/a.strukt.json': diagramJson('API') });
    await runImportCloud(awsArgs(root), fakeIo(), fixtureCloudRunner(), { env: {} });
    await runImportCloud(awsArgs(root), fakeIo(), fixtureCloudRunner(), { env: {} });
    const files = await archFiles(root);
    expect(JSON.parse(files['strukt.json']!).diagrams.map((d: { slug: string }) => d.slug)).toEqual(['a', 'aws-us-east-1', 'aws-us-east-1-2']);
    expect(JSON.parse(files['cloud.json']!).sources.map((s: { diagram: string }) => s.diagram)).toEqual(['aws-us-east-1', 'aws-us-east-1-2']);
    expect(files['diagrams/a.strukt.json']).toContain('"API"');
  });

  it('refreshes .arch/context/ only when it already existed', async () => {
    const plain = await workspace();
    await runImportCloud(awsArgs(plain), fakeIo(), fixtureCloudRunner(), { env: {} });
    expect(Object.keys(await archFiles(plain)).some((path) => path.startsWith('context/'))).toBe(false);
    const withContext = await workspace({ 'context/ARCHITECTURE.md': 'old' });
    await runImportCloud(awsArgs(withContext), fakeIo(), fixtureCloudRunner(), { env: {} });
    expect((await archFiles(withContext))['context/ARCHITECTURE.md']).toContain('AWS us-east-1');
  });

  it('prints each distinct warning once', async () => {
    const root = await workspace();
    const io = fakeIo();
    await runImportCloud(awsArgs(root), io, fixtureCloudRunner({ denied: ['rds'] }), { env: {} });
    expect(io.errText).toContain('aviso: aws rds describe-db-instances: sem permissão de leitura; omitido.');
  });

  describe('failures leave the workspace untouched', () => {
    const untouched = async (root: string) => expect(await archFiles(root)).toEqual({ 'strukt.json': manifestOf('Loja', []) });

    it('no workspace', async () => {
      const io = fakeIo();
      expect(await runImportCloud(awsArgs(await tempDir()), io, fixtureCloudRunner(), { env: {} })).toBe(2);
      expect(io.errText).toContain('Nenhum workspace do Joinlet');
    });

    it('CLI missing, not signed in, or no region', async () => {
      const root = await workspace();
      const missing = fakeIo();
      expect(await runImportCloud(awsArgs(root), missing, fixtureCloudRunner({ fail: 'spawn aws ENOENT' }), { env: {} })).toBe(2);
      expect(missing.errText).toContain('AWS CLI não encontrado');
      const login = fakeIo();
      expect(await runImportCloud(awsArgs(root), login, fixtureCloudRunner({ fail: 'Unable to locate credentials' }), { env: {} })).toBe(2);
      expect(login.errText).toContain('não lê nem guarda credenciais');
      const region = fakeIo();
      expect(await runImportCloud(argsOf('import', 'cloud', '--provider', 'aws', '--dir', root), region, fixtureCloudRunner(), { env: {} })).toBe(2);
      expect(region.errText).toContain('--region');
      await untouched(root);
    });

    it('a flag value the allowlist refuses', async () => {
      const root = await workspace();
      const io = fakeIo();
      const calls: string[] = [];
      expect(await runImportCloud(awsArgs(root, '--profile=--debug'), io, fixtureCloudRunner({ calls }), { env: {} })).toBe(2);
      expect(await runImportCloud(argsOf('import', 'cloud', '--provider', 'aws', '--region', 'us-east-1', '--profile', 'a b', '--dir', root), io, fixtureCloudRunner({ calls }), { env: {} })).toBe(2);
      expect(io.errText).toContain('Comando recusado');
      expect(calls).toEqual([]);
      await untouched(root);
    });

    it('an empty account', async () => {
      const root = await workspace();
      const io = fakeIo();
      const empty = fixtureCloudRunner({ override: Object.fromEntries(['ec2 describe-instances', 'ec2 describe-vpcs', 'ec2 describe-subnets', 'ec2 describe-security-groups', 'ec2 describe-nat-gateways', 'ec2 describe-internet-gateways', 'elbv2 describe-load-balancers', 'elbv2 describe-target-groups', 'rds describe-db-instances', 'rds describe-db-clusters', 'lambda list-functions', 'lambda list-event-source-mappings', 's3api list-buckets', 'sqs list-queues', 'sns list-topics', 'sns list-subscriptions', 'dynamodb list-tables', 'apigatewayv2 get-apis', 'ecs list-clusters', 'eks list-clusters'].map((path) => [`aws ${path}`, {}])) });
      expect(await runImportCloud(awsArgs(root), io, empty, { env: {} })).toBe(1);
      expect(io.errText).toContain('Nada para importar');
      await untouched(root);
    });

    it('a file that is not a terraform show -json', async () => {
      const root = await workspace();
      const file = join(await tempDir(), 'main.tf');
      await writeFile(file, 'resource "aws_instance" "a" {}');
      const io = fakeIo();
      expect(await runImportCloud(argsOf('import', 'cloud', '--file', file, '--dir', root), io, fixtureCloudRunner())).toBe(2);
      expect(io.errText).toContain('JSON válido');
      expect(await runImportCloud(argsOf('import', 'cloud', '--file', join(root, 'nope.json'), '--dir', root), io, fixtureCloudRunner())).toBe(2);
      expect(io.errText).toContain('Arquivo não encontrado');
      await untouched(root);
    });
  });
});
