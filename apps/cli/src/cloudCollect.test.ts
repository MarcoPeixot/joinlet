import { describe, expect, it } from 'vitest';
import { CloudCommandRefused } from './cloudAllowlist';
import { collectAws, collectAzure, collectCloud, collectGcp } from './cloudCollect';
import { fixtureCloudRunner } from './cloudTesting';
import type { CommandRunner } from '@strukt/git';

const graphOf = (result: Awaited<ReturnType<typeof collectAws>>) => {
  if ('error' in result) throw new Error(result.error);
  return result.graph;
};

describe('collectAws', () => {
  it('runs only allowlisted read commands, each with --output json and the region and profile asked for', async () => {
    const calls: string[] = [];
    const graph = graphOf(await collectAws(fixtureCloudRunner({ calls }), { region: 'us-east-1', profile: 'prod' }, { env: {} }));
    expect(graph.resources.length).toBeGreaterThan(30);
    expect(calls.length).toBeGreaterThan(25);
    for (const call of calls) {
      expect(call).toMatch(/^aws \S+ \S+ /);
      expect(call).toContain('--output json');
      expect(call).toContain('--region us-east-1');
      expect(call).toContain('--profile prod');
      expect(call).not.toMatch(/get-secret|get-function|describe-task-definition|get-parameter|userData|endpoint-url/);
    }
    expect(calls[0]).toContain('sts get-caller-identity');
  });

  it('follows load balancers, API integrations, ECS services and EKS clusters one call per item', async () => {
    const calls: string[] = [];
    await collectAws(fixtureCloudRunner({ calls }), { region: 'us-east-1' }, { env: {} });
    expect(calls.filter((c) => c.includes('describe-target-health'))).toHaveLength(2);
    expect(calls.filter((c) => c.includes('get-integrations --api-id abc123xyz'))).toHaveLength(1);
    expect(calls.filter((c) => c.includes('ecs list-services --cluster arn:aws:ecs'))).toHaveLength(1);
    expect(calls.filter((c) => c.includes('ecs describe-services'))).toHaveLength(1);
    expect(calls.filter((c) => c.includes('eks describe-cluster --name shop-eks'))).toHaveLength(1);
  });

  it('produces the resources, relations and account of the fixture account', async () => {
    const graph = graphOf(await collectAws(fixtureCloudRunner(), { region: 'us-east-1' }, { env: {} }));
    const names = graph.resources.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['shop-web-1', 'shop-alb', 'shop-db', 'shop-orders-worker', 'shop-checkout', 'shop-eks']));
    expect(graph.resources.find((r) => r.name === 'shop-web-1')!.id).toBe('arn:aws:ec2:us-east-1:123456789012:instance/i-0123456789abcdef0');
    expect(graph.scope).toEqual({ region: 'us-east-1' });
    expect(graph.resources.find((r) => r.name === 'shop-web-tg')!.links.length).toBeGreaterThan(2);
  });

  it('takes the region from AWS_REGION or AWS_DEFAULT_REGION when --region is absent, and asks for one when neither exists', async () => {
    expect('graph' in (await collectAws(fixtureCloudRunner(), {}, { env: { AWS_DEFAULT_REGION: 'us-east-1' } }))).toBe(true);
    const missing = await collectAws(fixtureCloudRunner(), {}, { env: {} });
    expect('error' in missing && missing.error).toMatch(/--region/);
  });

  it('refuses a malformed region before running anything', async () => {
    const calls: string[] = [];
    await expect(collectAws(fixtureCloudRunner({ calls }), { region: 'us-east-1; id' }, { env: {} })).rejects.toBeInstanceOf(CloudCommandRefused);
    expect(calls).toEqual([]);
  });

  it('keeps going when a service denies access, and says which one', async () => {
    const graph = graphOf(await collectAws(fixtureCloudRunner({ denied: ['rds', 'ecs'] }), { region: 'us-east-1' }, { env: {} }));
    const messages = graph.diagnostics.map((d) => d.message);
    expect(messages).toContain('aws rds describe-db-instances: sem permissão de leitura; omitido.');
    expect(messages).toContain('aws ecs list-clusters: sem permissão de leitura; omitido.');
    expect(graph.resources.some((r) => r.type === 'aws:rds:instance')).toBe(false);
    expect(graph.resources.some((r) => r.type === 'aws:ec2:instance')).toBe(true);
  });

  it('treats an empty answer (a CLI prints nothing when there are no queues) as an empty list', async () => {
    const runner = fixtureCloudRunner();
    const quiet: CommandRunner = async (cmd, args) => (args[0] === 'sqs' ? { code: 0, stdout: '', stderr: '' } : runner(cmd, args));
    const graph = graphOf(await collectAws(quiet, { region: 'us-east-1' }, { env: {} }));
    expect(graph.resources.some((r) => r.type === 'aws:sqs:queue')).toBe(false);
    expect(graph.diagnostics.some((d) => d.message.includes('sqs'))).toBe(false);
  });

  it('explains a missing CLI and missing credentials in pt-BR, without echoing CLI output', async () => {
    const missing = await collectAws(fixtureCloudRunner({ fail: 'spawn aws ENOENT' }), { region: 'us-east-1' }, { env: {} });
    expect('error' in missing && missing.error).toMatch(/AWS CLI não encontrado/);
    const login = await collectAws(fixtureCloudRunner({ fail: 'Unable to locate credentials. You can configure credentials by running "aws configure".' }), { region: 'us-east-1' }, { env: {} });
    expect('error' in login && login.error).toMatch(/não lê nem guarda credenciais/);
    const expired = await collectAws(fixtureCloudRunner({ fail: 'Error when retrieving token from sso: Token has expired and refresh failed' }), { region: 'us-east-1' }, { env: {} });
    expect('error' in expired && expired.error).toMatch(/aws sso login/);
  });

  it('does not repeat a stderr line that looks like a credential', async () => {
    const result = await collectAws(fixtureCloudRunner({ fail: 'weird failure AKIAIOSFODNN7EXAMPLE secret=abc' }), { region: 'us-east-1' }, { env: {} });
    expect('error' in result && result.error).not.toMatch(/AKIA|secret=abc/);
  });

  it('bounds the work: no more than 100 target groups are probed', async () => {
    const calls: string[] = [];
    const groups = { TargetGroups: Array.from({ length: 150 }, (_, i) => ({ TargetGroupArn: `arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/t${i}/abcdef0123456789`, TargetGroupName: `t${i}` })) };
    await collectAws(fixtureCloudRunner({ calls, override: { 'aws elbv2 describe-target-groups': groups } }), { region: 'us-east-1' }, { env: {} });
    expect(calls.filter((c) => c.includes('describe-target-health'))).toHaveLength(100);
  });

  it('batches describe-services by 10', async () => {
    const calls: string[] = [];
    const arns = Array.from({ length: 25 }, (_, i) => `arn:aws:ecs:us-east-1:123456789012:service/shop-cluster/s${i}`);
    await collectAws(fixtureCloudRunner({ calls, override: { 'aws ecs list-services': { serviceArns: arns } } }), { region: 'us-east-1' }, { env: {} });
    expect(calls.filter((c) => c.includes('ecs describe-services'))).toHaveLength(3);
  });
});

describe('collectAzure and collectGcp', () => {
  it('lists Azure resources with az resource list, scoped by subscription and resource group', async () => {
    const calls: string[] = [];
    const graph = graphOf(await collectAzure(fixtureCloudRunner({ calls }), { subscription: '00000000-1111-2222-3333-444444444444', resourceGroup: 'rg-shop-prod' }));
    expect(calls).toEqual(['az resource list --output json --only-show-errors --subscription 00000000-1111-2222-3333-444444444444 --resource-group rg-shop-prod']);
    expect(graph.resources.some((r) => r.name === 'vm-web-01')).toBe(true);
    expect(graph.scope).toEqual({ subscription: '00000000-1111-2222-3333-444444444444' });
  });

  it('searches one GCP project with the Cloud Asset inventory', async () => {
    const calls: string[] = [];
    const graph = graphOf(await collectGcp(fixtureCloudRunner({ calls }), { project: 'shop-prod-123456' }));
    expect(calls).toEqual(['gcloud asset search-all-resources --scope=projects/shop-prod-123456 --format=json --page-size=500 --quiet']);
    expect(graph.resources.some((r) => r.name === 'web-1')).toBe(true);
    expect(graph.scope).toEqual({ project: 'shop-prod-123456' });
  });

  it('asks for the project, and explains when the Cloud Asset API is off', async () => {
    const none = await collectGcp(fixtureCloudRunner(), {});
    expect('error' in none && none.error).toMatch(/--project/);
    const off = await collectGcp(fixtureCloudRunner({ fail: 'ERROR: (gcloud.asset.search-all-resources) PERMISSION_DENIED: Cloud Asset API has not been used in project 123 before or it is disabled.' }), { project: 'shop-prod-123456' });
    expect('error' in off && off.error).toMatch(/gcloud services enable cloudasset/);
  });

  it('explains missing CLIs and sessions', async () => {
    const az = await collectAzure(fixtureCloudRunner({ fail: "Please run 'az login' to setup account." }), {});
    expect('error' in az && az.error).toMatch(/az login/);
    const expiredGcloud = await collectGcp(fixtureCloudRunner({ fail: 'ERROR: (gcloud.asset.search-all-resources) There was a problem refreshing your current auth tokens: Reauthentication failed. cannot prompt during non-interactive execution.' }), { project: 'shop-prod-123456' });
    expect('error' in expiredGcloud && expiredGcloud.error).toMatch(/gcloud auth login/);
    const noProfile = await collectAws(fixtureCloudRunner({ fail: 'The config profile (staging) could not be found' }), { region: 'us-east-1', profile: 'staging' }, { env: {} });
    expect('error' in noProfile && noProfile.error).toMatch(/não lê nem guarda credenciais/);
    const noAz = await collectAzure(fixtureCloudRunner({ fail: 'Executable not found in $PATH: "az"' }), {});
    expect('error' in noAz && noAz.error).toMatch(/Azure CLI \(az\) não encontrado/);
    const noGcloud = await collectGcp(fixtureCloudRunner({ fail: 'spawn gcloud ENOENT' }), { project: 'shop-prod-123456' });
    expect('error' in noGcloud && noGcloud.error).toMatch(/gcloud não encontrado/);
  });

  it('refuses a malformed scope instead of running it', async () => {
    const calls: string[] = [];
    await expect(collectAzure(fixtureCloudRunner({ calls }), { subscription: 'a;b' })).rejects.toBeInstanceOf(CloudCommandRefused);
    await expect(collectGcp(fixtureCloudRunner({ calls }), { project: 'x/../y' })).rejects.toBeInstanceOf(CloudCommandRefused);
    expect(calls).toEqual([]);
  });

  it('collectCloud dispatches by provider', async () => {
    for (const [provider, scope] of [['aws', { region: 'us-east-1' }], ['azure', {}], ['gcp', { project: 'shop-prod-123456' }]] as const) {
      const result = await collectCloud(provider, fixtureCloudRunner(), scope, { env: {} });
      expect('graph' in result && result.graph.origin).toBe(provider);
    }
  });
});
