import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { awsOutputs, terraformStateText } from '@strukt/dsl/cloud-fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import { runCheck } from './commands/check';
import { runImportCloud } from './commands/importCloud';
import { fixtureCloudRunner } from './cloudTesting';
import type { FixtureRunnerOptions } from './cloudTesting';
import { argsOf, cleanupDirs, fakeIo, manifestOf, tempDir, writeArch } from './testing';

afterEach(cleanupDirs);

const ENV = { env: {} };
async function imported(provider: 'aws' | 'azure' | 'gcp' = 'aws'): Promise<string> {
  const root = await tempDir();
  await writeArch(root, { 'strukt.json': manifestOf('Loja', []) });
  const flags = provider === 'aws' ? ['--region', 'us-east-1'] : provider === 'gcp' ? ['--project', 'shop-prod-123456'] : [];
  expect(await runImportCloud(argsOf('import', 'cloud', '--provider', provider, ...flags, '--dir', root), fakeIo(), fixtureCloudRunner(), ENV)).toBe(0);
  return root;
}
const check = async (root: string, argv: string[], options: FixtureRunnerOptions = {}) => {
  const io = fakeIo();
  const code = await runCheck(argsOf('check', '--dir', root, ...argv), io, fixtureCloudRunner(options));
  return { code, io };
};
const driftLines = (text: string) => text.split('\n').filter((line) => line.startsWith('cloud.json:'));

const t3xlarge = { 'aws ec2 describe-instances': { Reservations: awsOutputs.instances.Reservations.map((r) => ({ ...r, Instances: r.Instances.map((i) => (i.InstanceId === 'i-0123456789abcdef0' ? { ...i, InstanceType: 'm5.xlarge' } : i)) })) } };

describe('joinlet check --cloud', () => {
  it('reports no drift when the cloud is as it was imported', async () => {
    const root = await imported();
    const { code, io } = await check(root, ['--cloud', 'aws', '--region', 'us-east-1']);
    expect(code).toBe(0);
    expect(driftLines(io.outText)).toEqual([]);
    expect(io.outText).toContain('0 erros.');
  });

  it('warns about a changed resource (exit 0) and fails with --strict (exit 1)', async () => {
    const root = await imported();
    const warn = await check(root, ['--cloud', 'aws'], { override: t3xlarge });
    expect(warn.code).toBe(0);
    expect(driftLines(warn.io.outText)).toEqual([expect.stringContaining('aviso: alterado na nuvem: aws:ec2:instance shop-web-1')]);
    expect(driftLines(warn.io.outText)[0]).toContain('instanceType: t3.medium → m5.xlarge');
    expect(warn.io.outText).toContain('1 aviso, 0 erros.');
    const strict = await check(root, ['--cloud', 'aws', '--strict'], { override: t3xlarge });
    expect(strict.code).toBe(1);
    expect(driftLines(strict.io.outText)[0]).toContain('erro: alterado na nuvem');
    expect(strict.io.outText).toContain('0 avisos, 1 erro.');
  });

  it('lists added and removed resources', async () => {
    const root = await imported();
    const { io } = await check(root, ['--cloud', 'aws'], { override: {
      'aws sqs list-queues': { QueueUrls: ['https://sqs.us-east-1.amazonaws.com/123456789012/shop-orders', 'https://sqs.us-east-1.amazonaws.com/123456789012/surprise-queue'] },
      'aws dynamodb list-tables': { TableNames: ['shop-carts'] },
    } });
    const lines = driftLines(io.outText).join('\n');
    expect(lines).toContain('adicionado na nuvem e ausente do diagrama "aws-us-east-1": aws:sqs:queue surprise-queue');
    expect(lines).toContain('removido da nuvem, ainda no diagrama "aws-us-east-1": aws:dynamodb:table shop-sessions');
    expect(lines).toContain('removido da nuvem, ainda no diagrama "aws-us-east-1": aws:sqs:queue shop-events.fifo');
  });

  it('does not call a resource drift when a person removed it from the diagram', async () => {
    const root = await imported();
    const path = join(root, '.arch', 'diagrams', 'aws-us-east-1.strukt.json');
    const diagram = JSON.parse(await readFile(path, 'utf8'));
    const strip = (nodes: { id: string; children?: unknown[] }[]): unknown[] => nodes.filter((n) => n.id !== 'shop-db').map((n) => (n.children ? { ...n, children: strip(n.children as never) } : n));
    diagram.nodes = strip(diagram.nodes);
    diagram.connections = diagram.connections.filter((c: { from: string; to: string }) => c.from !== 'shop-db' && c.to !== 'shop-db');
    await writeFile(path, JSON.stringify(diagram, null, 2));
    const gone = { 'aws rds describe-db-instances': { DBInstances: [] } };
    const { io } = await check(root, ['--cloud', 'aws'], { override: gone });
    expect(driftLines(io.outText)).toEqual([]);
  });

  it('does not report as removed what it could not read (denied access is not deletion)', async () => {
    const root = await imported();
    const { code, io } = await check(root, ['--cloud', 'aws', '--strict'], { denied: ['rds', 'dynamodb'] });
    expect(code).toBe(0);
    expect(driftLines(io.outText)).toEqual([]);
    expect(io.errText).toContain('aws rds describe-db-instances: sem permissão de leitura; omitido.');
    expect(io.errText).toContain('Não foi possível ler: aws:dynamodb:table, aws:rds:cluster, aws:rds:instance. As diferenças desses tipos não foram avaliadas.');
  });

  it('scopes the listing to the region the diagram was imported with', async () => {
    const root = await imported();
    const calls: string[] = [];
    await check(root, ['--cloud', 'aws'], { calls });
    expect(calls.every((call) => call.includes('--region us-east-1'))).toBe(true);
  });

  it('compares Azure and GCP imports the same way', async () => {
    for (const provider of ['azure', 'gcp'] as const) {
      const root = await imported(provider);
      const { code, io } = await check(root, ['--cloud', provider, ...(provider === 'gcp' ? ['--project', 'shop-prod-123456'] : [])]);
      expect(code, io.errText).toBe(0);
      expect(driftLines(io.outText)).toEqual([]);
    }
  });

  it('compares against a terraform show -json file, on the kinds both sides know', async () => {
    const root = await imported();
    const file = join(await tempDir(), 'live.json');
    await writeFile(file, terraformStateText);
    const calls: string[] = [];
    const { code, io } = await check(root, ['--cloud', file], { calls });
    expect(calls).toEqual([]);
    expect(code).toBe(0);
    const lines = driftLines(io.outText).join('\n');
    expect(lines).toContain('alterado na nuvem: aws:ec2:instance shop-web-2');
    expect(lines).toContain('instanceType: t3.medium → t3.large');
    expect(lines).toContain('adicionado na nuvem e ausente do diagrama "aws-us-east-1": aws:ec2:instance shop-batch');
    expect((await check(root, ['--cloud', file, '--strict'])).code).toBe(1);
  });

  it('prints a machine-readable report with --json', async () => {
    const root = await imported();
    const { code, io } = await check(root, ['--cloud', 'aws', '--json'], { override: t3xlarge });
    expect(code).toBe(0);
    const report = JSON.parse(io.outText);
    expect(report.ok).toBe(true);
    expect(report.cloud).toEqual([expect.objectContaining({ kind: 'changed', diagram: 'aws-us-east-1', type: 'aws:ec2:instance' })]);
    expect(Array.isArray(report.cloudNotes)).toBe(true);
    expect(JSON.parse((await check(root, ['--cloud', 'aws', '--json', '--strict'], { override: t3xlarge })).io.outText).ok).toBe(false);
  });

  it('leaves the workspace exactly as it was', async () => {
    const root = await imported();
    const before = await readFile(join(root, '.arch', 'cloud.json'), 'utf8');
    await check(root, ['--cloud', 'aws'], { override: t3xlarge });
    expect(await readFile(join(root, '.arch', 'cloud.json'), 'utf8')).toBe(before);
  });

  describe('when the comparison cannot run it is an environment problem (exit 2), not drift', () => {
    it('no baseline, or none for that provider', async () => {
      const empty = await tempDir();
      await writeArch(empty, { 'strukt.json': manifestOf('Loja', []) });
      const none = await check(empty, ['--cloud', 'aws']);
      expect(none.code).toBe(2);
      expect(none.io.errText).toContain('Nenhum diagrama importado de aws em .arch/cloud.json');
      const root = await imported('aws');
      const other = await check(root, ['--cloud', 'gcp', '--project', 'shop-prod-123456']);
      expect(other.code).toBe(2);
      expect(other.io.errText).toContain('Nenhum diagrama importado de gcp');
    });

    it('CLI missing or signed out, and an unreadable file', async () => {
      const root = await imported();
      const missing = await check(root, ['--cloud', 'aws'], { fail: 'spawn aws ENOENT' });
      expect(missing.code).toBe(2);
      expect(missing.io.errText).toContain('AWS CLI não encontrado');
      const file = await check(root, ['--cloud', join(root, 'nope.json')]);
      expect(file.code).toBe(2);
      expect(file.io.errText).toContain('Arquivo não encontrado');
    });

    it('a malformed cloud.json is reported, not thrown', async () => {
      const root = await tempDir();
      await writeArch(root, { 'strukt.json': manifestOf('Loja', []), 'cloud.json': '{' });
      const { code, io } = await check(root, ['--cloud', 'aws']);
      expect(code).toBe(2);
      expect(io.errText).toContain('Nenhum diagrama importado de aws');
    });

    it('a flag value the allowlist refuses never reaches the CLI', async () => {
      const root = await imported();
      const calls: string[] = [];
      const { code, io } = await check(root, ['--cloud', 'aws', '--profile=--debug'], { calls });
      expect(code).toBe(2);
      expect(io.errText).toContain('Comando recusado');
      expect(calls).toEqual([]);
    });
  });

  it('warns about a source whose diagram was deleted, and compares the rest', async () => {
    const root = await imported();
    await writeArch(root, { 'strukt.json': manifestOf('Loja', []) });
    const { code, io } = await check(root, ['--cloud', 'aws']);
    expect(code).toBe(0);
    expect(io.errText).toContain('aponta para o diagrama "aws-us-east-1", que não existe mais');
  });
});
