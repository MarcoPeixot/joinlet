import type { CommandRunner } from '@strukt/git';

/** A command the live-cloud import was not allowed to run. Always a bug or an attack, never a user mistake: it is thrown, not reported. */
export class CloudCommandRefused extends Error {
  constructor(detail: string) {
    super(`Comando recusado (o Joinlet só executa a lista de comandos permitidos, somente leitura, dos CLIs de nuvem): ${detail}`);
    this.name = 'CloudCommandRefused';
  }
}

type Bin = 'aws' | 'az' | 'gcloud';

/** How one flag is spelled and what its value may be. */
interface FlagSpec {
  /** `none` is a switch without value; `one` takes one value; `many` takes one or more (up to `max`). */
  arity: 'none' | 'one' | 'many';
  value?: RegExp;
  max?: number;
  required?: boolean;
}

interface Operation {
  bin: Bin;
  /** The command words, exactly, first on the command line. */
  path: readonly string[];
  flags: Record<string, FlagSpec>;
}

const AWS_REGION = /^[a-z]{2}(?:-[a-z]+)+-\d{1,2}$/;
const AWS_PROFILE = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$/;
const AWS_ARN = /^arn:aws[a-z-]*:[a-z0-9-]+:[a-z0-9-]*:\d{0,12}:[A-Za-z0-9:/_.+=,@-]{1,512}$/;
const ECS_NAME_OR_ARN = /^(?:[A-Za-z0-9_-]{1,255}|arn:aws[a-z-]*:ecs:[a-z0-9-]+:\d{12}:(?:cluster|service)\/[A-Za-z0-9_/-]{1,255})$/;
const EKS_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const API_ID = /^[a-z0-9]{6,20}$/;
const JSON_ONLY = /^json$/;
const GUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const AZ_SUBSCRIPTION = new RegExp(`^(?:${GUID}|[A-Za-z0-9][A-Za-z0-9 _.()-]{0,63})$`);
const AZ_GROUP = /^[A-Za-z0-9_.()-]{1,90}$/;
const GCP_SCOPE = /^projects\/(?:[a-z][a-z0-9-]{4,28}[a-z0-9]|\d{6,15})$/;
const GCP_PAGE_SIZE = /^\d{1,4}$/;
const GCP_ASSET_TYPES = /^[A-Za-z0-9._/-]{1,60}(?:,[A-Za-z0-9._/-]{1,60}){0,29}$/;

/** `--output json` is mandatory everywhere: the collectors parse JSON and nothing else (no `--query`, text or table). */
const awsBase = (extra: Record<string, FlagSpec> = {}): Record<string, FlagSpec> => ({
  '--output': { arity: 'one', value: JSON_ONLY, required: true },
  '--region': { arity: 'one', value: AWS_REGION },
  '--profile': { arity: 'one', value: AWS_PROFILE },
  '--no-cli-pager': { arity: 'none' },
  ...extra,
});

const aws = (service: string, operation: string, extra?: Record<string, FlagSpec>): Operation => ({ bin: 'aws', path: [service, operation], flags: awsBase(extra) });

const OPERATIONS: readonly Operation[] = [
  aws('sts', 'get-caller-identity'),
  aws('ec2', 'describe-instances'),
  aws('ec2', 'describe-vpcs'),
  aws('ec2', 'describe-subnets'),
  aws('ec2', 'describe-security-groups'),
  aws('ec2', 'describe-nat-gateways'),
  aws('ec2', 'describe-internet-gateways'),
  aws('elbv2', 'describe-load-balancers'),
  aws('elbv2', 'describe-target-groups'),
  aws('elbv2', 'describe-target-health', { '--target-group-arn': { arity: 'one', value: AWS_ARN, required: true } }),
  aws('rds', 'describe-db-instances'),
  aws('rds', 'describe-db-clusters'),
  aws('lambda', 'list-functions'),
  aws('lambda', 'list-event-source-mappings'),
  aws('s3api', 'list-buckets'),
  aws('sqs', 'list-queues'),
  aws('sns', 'list-topics'),
  aws('sns', 'list-subscriptions'),
  aws('dynamodb', 'list-tables'),
  aws('apigatewayv2', 'get-apis'),
  aws('apigatewayv2', 'get-integrations', { '--api-id': { arity: 'one', value: API_ID, required: true } }),
  aws('ecs', 'list-clusters'),
  aws('ecs', 'list-services', { '--cluster': { arity: 'one', value: ECS_NAME_OR_ARN, required: true } }),
  aws('ecs', 'describe-services', { '--cluster': { arity: 'one', value: ECS_NAME_OR_ARN, required: true }, '--services': { arity: 'many', value: ECS_NAME_OR_ARN, max: 10, required: true } }),
  aws('eks', 'list-clusters'),
  aws('eks', 'describe-cluster', { '--name': { arity: 'one', value: EKS_NAME, required: true } }),
  {
    bin: 'az',
    path: ['resource', 'list'],
    flags: {
      '--output': { arity: 'one', value: JSON_ONLY, required: true },
      '--subscription': { arity: 'one', value: AZ_SUBSCRIPTION },
      '--resource-group': { arity: 'one', value: AZ_GROUP },
      '--only-show-errors': { arity: 'none' },
    },
  },
  {
    bin: 'gcloud',
    path: ['asset', 'search-all-resources'],
    flags: {
      '--scope': { arity: 'one', value: GCP_SCOPE, required: true },
      '--format': { arity: 'one', value: JSON_ONLY, required: true },
      '--page-size': { arity: 'one', value: GCP_PAGE_SIZE },
      '--asset-types': { arity: 'one', value: GCP_ASSET_TYPES },
      '--quiet': { arity: 'none' },
    },
  },
];

const BINARIES: readonly string[] = ['aws', 'az', 'gcloud'];
const MAX_ARG = 600;
const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f]/;

function fail(detail: string): never {
  throw new CloudCommandRefused(detail);
}

const shown = (cmd: string, args: readonly string[]): string => `${cmd} ${args.join(' ')}`.replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 200);

/**
 * Throws `CloudCommandRefused` unless `cmd args` is exactly one of the listed read operations with only its listed flags
 * and well-formed values. The match is positive and exact: the operation words come first, every flag is declared, no
 * flag repeats, values are validated against a pattern (never starting with `-`), and nothing else is accepted. Prefix
 * rules such as "describe-*" are deliberately not used: `get-secret-value`, `get-function` (a code download link) and
 * `describe-instance-attribute --attribute userData` all look read-only and are not.
 */
export function assertReadOnly(cmd: string, args: readonly string[]): void {
  const where = shown(cmd, args);
  if (!BINARIES.includes(cmd)) fail(`"${cmd}" não é um dos CLIs de nuvem (${BINARIES.join(', ')}).`);
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.length > MAX_ARG || FORBIDDEN_CHARS.test(arg)) fail(`argumento inválido em "${where}".`);
  }
  const operation = OPERATIONS.find((op) => op.bin === cmd && op.path.every((word, index) => args[index] === word));
  if (!operation) fail(`"${where}" não está na lista.`);
  const seen = new Set<string>();
  let index = operation.path.length;
  while (index < args.length) {
    const token = args[index]!;
    if (!token.startsWith('--')) fail(`argumento solto "${token.slice(0, 40)}" em "${where}".`);
    const equals = token.indexOf('=');
    const name = equals < 0 ? token : token.slice(0, equals);
    const spec = Object.hasOwn(operation.flags, name) ? operation.flags[name] : undefined;
    if (!spec) fail(`a opção "${name.slice(0, 40)}" não é permitida em "${operation.path.join(' ')}".`);
    if (seen.has(name)) fail(`a opção ${name} aparece duas vezes.`);
    seen.add(name);
    index += 1;
    if (spec.arity === 'none') {
      if (equals >= 0) fail(`a opção ${name} não leva valor.`);
      continue;
    }
    const values: string[] = [];
    if (equals >= 0) values.push(token.slice(equals + 1));
    else {
      const limit = spec.arity === 'many' ? (spec.max ?? 1) : 1;
      while (index < args.length && !args[index]!.startsWith('-') && values.length < limit) { values.push(args[index]!); index += 1; }
      if (index < args.length && !args[index]!.startsWith('-')) fail(`a opção ${name} aceita no máximo ${limit} valor${limit === 1 ? '' : 'es'}.`);
    }
    if (values.length === 0) fail(`a opção ${name} precisa de um valor.`);
    for (const value of values) if (!spec.value || !spec.value.test(value)) fail(`valor inválido para ${name}.`);
  }
  for (const [name, spec] of Object.entries(operation.flags)) if (spec.required && !seen.has(name)) fail(`falta a opção ${name} em "${operation.path.join(' ')}".`);
}

/**
 * Wraps a runner so that nothing but allowlisted read commands reaches it. The inner runner is the user's own process
 * runner: the CLIs find their credentials the way they always do (profile, SSO cache, `az login`, application default
 * credentials). The Joinlet passes no environment and no working directory, so it cannot redirect a CLI (endpoint,
 * credentials file) and never reads or stores a credential.
 */
export function readOnlyRunner(inner: CommandRunner): CommandRunner {
  return async (cmd, args, opts) => {
    if (opts !== undefined && (opts.env !== undefined || opts.cwd !== undefined)) fail('ambiente e diretório de trabalho não são aceitos.');
    assertReadOnly(cmd, args);
    return inner(cmd, args);
  };
}
