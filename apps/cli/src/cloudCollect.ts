import { normalizeAws, normalizeAzure, normalizeGcp } from '@strukt/dsl/import';
import type { AwsInputs, CloudGraph, CloudProvider, CloudScope } from '@strukt/dsl/import';
import type { CommandRunner } from '@strukt/git';
import { readOnlyRunner } from './cloudAllowlist';

/** What narrows a listing. A profile is only a name for the user's own CLI to resolve: it is never stored. */
export interface CloudScopeArgs {
  profile?: string;
  region?: string;
  subscription?: string;
  project?: string;
  resourceGroup?: string;
}

export type CollectResult = { graph: CloudGraph } | { error: string };

const MAX_OUTPUT = 80_000_000;
const MAX_CALLS = 400;
const MAX_TARGET_GROUPS = 100;
const MAX_APIS = 50;
const MAX_ECS_CLUSTERS = 20;
const MAX_ECS_SERVICES = 100;
const MAX_EKS_CLUSTERS = 20;

const MISSING = /ENOENT|not found in \$PATH|command not found|Executable not found|não encontrado/i;
const DENIED = /AccessDenied|UnauthorizedOperation|not authorized|AuthorizationError|is not authorized|permission|forbidden|403/i;
const NO_CREDENTIALS = /Unable to locate credentials|ExpiredToken|InvalidClientTokenId|SignatureDoesNotMatch|NoCredentialProviders|Token has expired|SSO session|sso login|aws configure|config profile|az login|gcloud auth login|do not currently have an active account|refreshing your current auth tokens|Reauthentication failed|AADSTS|az account set/i;

const INSTALL: Record<CloudProvider, string> = {
  aws: 'AWS CLI não encontrado no PATH. Instale: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html',
  azure: 'Azure CLI (az) não encontrado no PATH. Instale: https://learn.microsoft.com/cli/azure/install-azure-cli',
  gcp: 'gcloud não encontrado no PATH. Instale: https://cloud.google.com/sdk/docs/install',
};
const LOGIN: Record<CloudProvider, string> = {
  aws: 'Sem credenciais válidas no AWS CLI. Entre com o seu CLI (por exemplo "aws sso login --profile <perfil>") e informe --profile. O Joinlet não lê nem guarda credenciais.',
  azure: 'Sem sessão no Azure CLI. Rode "az login" (o Joinlet não lê nem guarda credenciais).',
  gcp: 'Sem sessão no gcloud. Rode "gcloud auth login" (o Joinlet não lê nem guarda credenciais).',
};

/** The first line of a CLI's stderr, cleaned and short; anything that looks like a credential is dropped. */
function reason(stderr: string): string {
  const line = (stderr.split('\n').find((candidate) => candidate.trim()) ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 160);
  return /[A-Za-z0-9+/]{40,}|AKIA|secret|token/i.test(line) ? 'sem detalhes' : line || 'sem detalhes';
}

interface Call {
  /** `undefined` when the call failed in a way the import can live without (warning already recorded). */
  json?: unknown;
  fatal?: string;
}

class Collector {
  readonly warnings: string[] = [];
  private calls = 0;
  constructor(private readonly run: CommandRunner, private readonly provider: CloudProvider) {}

  async json(cmd: string, args: string[], label: string, options: { fatalOnAuth?: boolean; required?: boolean } = {}): Promise<Call> {
    if (this.calls >= MAX_CALLS) { this.warnOnce('calls', `Limite de ${MAX_CALLS} chamadas ao CLI atingido: o restante foi omitido.`); return {}; }
    this.calls += 1;
    const result = await this.run(cmd, args);
    if (result.code !== 0) {
      const text = `${result.stderr}\n${result.stdout}`;
      if (MISSING.test(text) && !/AccessDenied/i.test(text)) return { fatal: INSTALL[this.provider] };
      if (NO_CREDENTIALS.test(text) && !DENIED.test(text)) return { fatal: LOGIN[this.provider] };
      if (options.required) return { fatal: `${label}: ${reason(result.stderr)}` };
      this.warnings.push(DENIED.test(text) ? `${label}: sem permissão de leitura; omitido.` : `${label}: o CLI falhou (${reason(result.stderr)}); omitido.`);
      return {};
    }
    if (result.stdout.length > MAX_OUTPUT) { this.warnings.push(`${label}: resposta grande demais; omitida.`); return {}; }
    if (!result.stdout.trim()) return { json: {} };
    try { return { json: JSON.parse(result.stdout) as unknown }; }
    catch { this.warnings.push(`${label}: resposta que não é JSON; omitida.`); return {}; }
  }

  private readonly once = new Set<string>();
  private warnOnce(kind: string, message: string): void { if (!this.once.has(kind)) { this.once.add(kind); this.warnings.push(message); } }
}

const strings = (value: unknown, key: string, limit: number): string[] => {
  const list = typeof value === 'object' && value !== null && !Array.isArray(value) && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string').slice(0, limit) : [];
};
const field = (value: unknown, key: string): unknown => (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined);

export interface CollectEnv {
  /** Only region variables are read, never anything credential-like. */
  env?: Record<string, string | undefined>;
}

/** Region given, or the region the user's own environment names; credentials are never looked at. */
function awsRegion(scope: CloudScopeArgs, env: Record<string, string | undefined>): string | undefined {
  return scope.region ?? env.AWS_REGION ?? env.AWS_DEFAULT_REGION;
}

export async function collectAws(inner: CommandRunner, scope: CloudScopeArgs, options: CollectEnv = {}): Promise<CollectResult> {
  const region = awsRegion(scope, options.env ?? process.env);
  if (!region) return { error: 'Informe --region (ou defina AWS_REGION): o Joinlet importa uma região por vez.' };
  const c = new Collector(readOnlyRunner(inner), 'aws');
  const common = ['--output', 'json', '--region', region, '--no-cli-pager', ...(scope.profile ? ['--profile', scope.profile] : [])];
  const call = (path: string[], extra: string[] = [], label = path.join(' '), options2: { required?: boolean } = {}) => c.json('aws', [...path, ...extra, ...common], `aws ${label}`, options2);

  const identity = await call(['sts', 'get-caller-identity'], [], 'sts get-caller-identity', { required: true });
  if (identity.fatal) return { error: identity.fatal };
  const inputs: AwsInputs = { region };
  const account = field(identity.json, 'Account');
  if (typeof account === 'string' && /^\d{12}$/.test(account)) inputs.account = account;

  const unreadable = new Set<string>();
  const fetched: [keyof AwsInputs, string[], string[]][] = [
    ['instances', ['ec2', 'describe-instances'], ['aws:ec2:instance']], ['vpcs', ['ec2', 'describe-vpcs'], ['aws:ec2:vpc']], ['subnets', ['ec2', 'describe-subnets'], ['aws:ec2:subnet']],
    ['securityGroups', ['ec2', 'describe-security-groups'], ['aws:ec2:security-group']], ['natGateways', ['ec2', 'describe-nat-gateways'], ['aws:ec2:nat-gateway']], ['internetGateways', ['ec2', 'describe-internet-gateways'], ['aws:ec2:internet-gateway']],
    ['loadBalancers', ['elbv2', 'describe-load-balancers'], ['aws:elbv2:load-balancer']], ['targetGroups', ['elbv2', 'describe-target-groups'], ['aws:elbv2:target-group']],
    ['rdsInstances', ['rds', 'describe-db-instances'], ['aws:rds:instance']], ['rdsClusters', ['rds', 'describe-db-clusters'], ['aws:rds:cluster']],
    ['lambdaFunctions', ['lambda', 'list-functions'], ['aws:lambda:function']], ['eventSourceMappings', ['lambda', 'list-event-source-mappings'], ['aws:sqs:queue', 'aws:dynamodb:table']],
    ['buckets', ['s3api', 'list-buckets'], ['aws:s3:bucket']], ['queues', ['sqs', 'list-queues'], ['aws:sqs:queue']], ['topics', ['sns', 'list-topics'], ['aws:sns:topic']], ['subscriptions', ['sns', 'list-subscriptions'], ['aws:sns:topic']],
    ['dynamoTables', ['dynamodb', 'list-tables'], ['aws:dynamodb:table']], ['apis', ['apigatewayv2', 'get-apis'], ['aws:apigateway:api']], ['ecsClusters', ['ecs', 'list-clusters'], ['aws:ecs:cluster', 'aws:ecs:service']],
  ];
  for (const [key, path, types] of fetched) {
    const result = await call(path);
    if (result.fatal) return { error: result.fatal };
    if (result.json !== undefined) (inputs as unknown as Record<string, unknown>)[key] = result.json;
    else for (const type of types) unreadable.add(type);
  }


  const targetHealth: Record<string, unknown> = {};
  const groups = Array.isArray(field(inputs.targetGroups, 'TargetGroups')) ? (field(inputs.targetGroups, 'TargetGroups') as unknown[]) : [];
  if (groups.length > MAX_TARGET_GROUPS) unreadable.add('aws:elbv2:target-group');
  for (const group of groups.slice(0, MAX_TARGET_GROUPS)) {
    const arn = field(group, 'TargetGroupArn');
    if (typeof arn !== 'string') continue;
    const health = await call(['elbv2', 'describe-target-health'], ['--target-group-arn', arn], 'elbv2 describe-target-health');
    if (health.fatal) return { error: health.fatal };
    if (health.json !== undefined) targetHealth[arn] = health.json;
    else unreadable.add('aws:elbv2:target-group');
  }
  inputs.targetHealth = targetHealth;

  const integrations: Record<string, unknown> = {};
  for (const api of (Array.isArray(field(inputs.apis, 'Items')) ? (field(inputs.apis, 'Items') as unknown[]) : []).slice(0, MAX_APIS)) {
    const id = field(api, 'ApiId');
    if (typeof id !== 'string') continue;
    const result = await call(['apigatewayv2', 'get-integrations'], ['--api-id', id], 'apigatewayv2 get-integrations');
    if (result.fatal) return { error: result.fatal };
    if (result.json !== undefined) integrations[id] = result.json;
    else unreadable.add('aws:apigateway:api');
  }
  inputs.integrations = integrations;

  const ecsServices: Record<string, unknown> = {};
  for (const cluster of strings(inputs.ecsClusters, 'clusterArns', MAX_ECS_CLUSTERS)) {
    const listed = await call(['ecs', 'list-services'], ['--cluster', cluster], 'ecs list-services');
    if (listed.fatal) return { error: listed.fatal };
    if (listed.json === undefined) { unreadable.add('aws:ecs:service'); unreadable.add('aws:ecs:cluster'); }
    const arns = strings(listed.json, 'serviceArns', MAX_ECS_SERVICES);
    const merged: unknown[] = [];
    for (let at = 0; at < arns.length; at += 10) {
      const described = await call(['ecs', 'describe-services'], ['--cluster', cluster, '--services', ...arns.slice(at, at + 10)], 'ecs describe-services');
      if (described.fatal) return { error: described.fatal };
      if (described.json === undefined) { unreadable.add('aws:ecs:service'); unreadable.add('aws:ecs:cluster'); }
      const batch = field(described.json, 'services');
      if (Array.isArray(batch)) merged.push(...batch);
    }
    ecsServices[cluster] = { services: merged };
  }
  inputs.ecsServices = ecsServices;

  const eks: unknown[] = [];
  const names = await call(['eks', 'list-clusters']);
  if (names.fatal) return { error: names.fatal };
  if (names.json === undefined) unreadable.add('aws:eks:cluster');
  for (const name of strings(names.json, 'clusters', MAX_EKS_CLUSTERS)) {
    const described = await call(['eks', 'describe-cluster'], ['--name', name], 'eks describe-cluster');
    if (described.fatal) return { error: described.fatal };
    if (described.json !== undefined) eks.push(described.json);
    else unreadable.add('aws:eks:cluster');
  }
  inputs.eksClusters = eks;

  const graph = normalizeAws(inputs);
  return { graph: { ...graph, diagnostics: [...c.warnings.map((message) => ({ line: 1, message })), ...graph.diagnostics], ...(unreadable.size ? { unreadable: [...unreadable].sort() } : {}) } };
}

export async function collectAzure(inner: CommandRunner, scope: CloudScopeArgs): Promise<CollectResult> {
  const c = new Collector(readOnlyRunner(inner), 'azure');
  const args = ['resource', 'list', '--output', 'json', '--only-show-errors', ...(scope.subscription ? ['--subscription', scope.subscription] : []), ...(scope.resourceGroup ? ['--resource-group', scope.resourceGroup] : [])];
  const listing = await c.json('az', args, 'az resource list', { required: true });
  if (listing.fatal) return { error: listing.fatal };
  const graphScope: CloudScope = scope.subscription ? { subscription: scope.subscription } : {};
  const graph = normalizeAzure(listing.json, graphScope);
  return { graph: { ...graph, diagnostics: [...c.warnings.map((message) => ({ line: 1, message })), ...graph.diagnostics] } };
}

export async function collectGcp(inner: CommandRunner, scope: CloudScopeArgs): Promise<CollectResult> {
  if (!scope.project) return { error: 'Informe --project <id-do-projeto>: o Joinlet importa um projeto por vez.' };
  const c = new Collector(readOnlyRunner(inner), 'gcp');
  const listing = await c.json('gcloud', ['asset', 'search-all-resources', `--scope=projects/${scope.project}`, '--format=json', '--page-size=500', '--quiet'], 'gcloud asset search-all-resources', { required: true });
  if (listing.fatal) {
    return { error: /cloudasset\.googleapis\.com|API .* not enabled|has not been used/i.test(listing.fatal) ? 'A API Cloud Asset está desativada neste projeto. Ative com "gcloud services enable cloudasset.googleapis.com" e tente de novo.' : listing.fatal };
  }
  const graph = normalizeGcp(listing.json, { project: scope.project });
  return { graph: { ...graph, diagnostics: [...c.warnings.map((message) => ({ line: 1, message })), ...graph.diagnostics] } };
}

/** Reads one provider's live state through the user's own CLI; `inner` is the process runner, wrapped here so no caller can skip the allowlist. */
export function collectCloud(provider: CloudProvider, inner: CommandRunner, scope: CloudScopeArgs, options: CollectEnv = {}): Promise<CollectResult> {
  if (provider === 'aws') return collectAws(inner, scope, options);
  if (provider === 'azure') return collectAzure(inner, scope);
  return collectGcp(inner, scope);
}
