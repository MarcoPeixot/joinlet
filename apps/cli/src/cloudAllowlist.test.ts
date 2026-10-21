import { describe, expect, it } from 'vitest';
import { CloudCommandRefused, assertReadOnly, readOnlyRunner } from './cloudAllowlist';
import type { CommandRunner } from '@strukt/git';

const ARN = 'arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/shop-web-tg/73e2d6bc24d8a067';
const CLUSTER = 'arn:aws:ecs:us-east-1:123456789012:cluster/shop-cluster';

const allowed: [string, string[]][] = [
  ['aws', ['sts', 'get-caller-identity', '--output', 'json']],
  ['aws', ['ec2', 'describe-instances', '--output', 'json', '--region', 'us-east-1', '--profile', 'prod']],
  ['aws', ['ec2', 'describe-vpcs', '--output', 'json', '--region', 'sa-east-1']],
  ['aws', ['ec2', 'describe-subnets', '--output', 'json', '--region', 'us-gov-west-1']],
  ['aws', ['ec2', 'describe-security-groups', '--output', 'json', '--region', 'eu-west-1']],
  ['aws', ['ec2', 'describe-nat-gateways', '--output', 'json', '--region', 'ap-southeast-2']],
  ['aws', ['ec2', 'describe-internet-gateways', '--output', 'json', '--region', 'us-east-1']],
  ['aws', ['elbv2', 'describe-load-balancers', '--output', 'json', '--region', 'us-east-1']],
  ['aws', ['elbv2', 'describe-target-groups', '--output', 'json', '--region', 'us-east-1']],
  ['aws', ['elbv2', 'describe-target-health', '--target-group-arn', ARN, '--output', 'json', '--region', 'us-east-1']],
  ['aws', ['rds', 'describe-db-instances', '--output', 'json', '--region', 'us-east-1']],
  ['aws', ['rds', 'describe-db-clusters', '--output', 'json', '--region', 'us-east-1']],
  ['aws', ['lambda', 'list-functions', '--output', 'json', '--region', 'us-east-1']],
  ['aws', ['lambda', 'list-event-source-mappings', '--output', 'json', '--region', 'us-east-1']],
  ['aws', ['s3api', 'list-buckets', '--output', 'json', '--region', 'us-east-1']],
  ['aws', ['sqs', 'list-queues', '--output', 'json', '--region', 'us-east-1']],
  ['aws', ['sns', 'list-topics', '--output', 'json', '--region', 'us-east-1']],
  ['aws', ['sns', 'list-subscriptions', '--output', 'json', '--region', 'us-east-1']],
  ['aws', ['dynamodb', 'list-tables', '--output', 'json', '--region', 'us-east-1']],
  ['aws', ['apigatewayv2', 'get-apis', '--output', 'json', '--region', 'us-east-1']],
  ['aws', ['apigatewayv2', 'get-integrations', '--api-id', 'abc123xyz', '--output', 'json', '--region', 'us-east-1']],
  ['aws', ['ecs', 'list-clusters', '--output', 'json', '--region', 'us-east-1']],
  ['aws', ['ecs', 'list-services', '--cluster', CLUSTER, '--output', 'json', '--region', 'us-east-1']],
  ['aws', ['ecs', 'describe-services', '--cluster', CLUSTER, '--services', 'a', 'b', '--output', 'json', '--region', 'us-east-1']],
  ['aws', ['eks', 'list-clusters', '--output', 'json', '--region', 'us-east-1']],
  ['aws', ['eks', 'describe-cluster', '--name', 'shop-eks', '--output', 'json', '--region', 'us-east-1']],
  ['aws', ['ec2', 'describe-instances', '--output', 'json', '--no-cli-pager']],
  ['az', ['resource', 'list', '--output', 'json', '--only-show-errors']],
  ['az', ['resource', 'list', '--output', 'json', '--subscription', '00000000-1111-2222-3333-444444444444', '--resource-group', 'rg-shop-prod']],
  ['az', ['resource', 'list', '--output', 'json', '--subscription', 'Visual Studio Enterprise']],
  ['gcloud', ['asset', 'search-all-resources', '--scope=projects/shop-prod-123456', '--format=json', '--page-size=500', '--quiet']],
  ['gcloud', ['asset', 'search-all-resources', '--scope', 'projects/123456789012', '--format', 'json']],
  ['gcloud', ['asset', 'search-all-resources', '--scope=projects/shop-prod-123456', '--format=json', '--asset-types=compute.googleapis.com/Instance,storage.googleapis.com/Bucket']],
];

const refused: [string, string, string[]][] = [
  // Names that look read-only to a prefix rule but hand out secrets, tokens or code.
  ['secrets', 'aws', ['secretsmanager', 'get-secret-value', '--secret-id', 'prod/db']],
  ['secrets list', 'aws', ['secretsmanager', 'list-secrets', '--output', 'json']],
  ['ssm parameter', 'aws', ['ssm', 'get-parameter', '--name', '/prod/db', '--with-decryption']],
  ['ssm parameters by path', 'aws', ['ssm', 'get-parameters-by-path', '--path', '/prod']],
  ['lambda code url', 'aws', ['lambda', 'get-function', '--function-name', 'f']],
  ['lambda env vars', 'aws', ['lambda', 'get-function-configuration', '--function-name', 'f']],
  ['password data', 'aws', ['ec2', 'get-password-data', '--instance-id', 'i-0123456789abcdef0']],
  ['user data', 'aws', ['ec2', 'describe-instance-attribute', '--instance-id', 'i-0123456789abcdef0', '--attribute', 'userData']],
  ['session token', 'aws', ['sts', 'get-session-token']],
  ['role assumption', 'aws', ['sts', 'assume-role', '--role-arn', 'arn:aws:iam::123456789012:role/x', '--role-session-name', 'x']],
  ['login password', 'aws', ['ecr', 'get-login-password']],
  ['kubeconfig token', 'aws', ['eks', 'get-token', '--cluster-name', 'shop-eks']],
  ['db auth token', 'aws', ['rds', 'generate-db-auth-token', '--hostname', 'h', '--port', '5432', '--username', 'u']],
  ['task definition env', 'aws', ['ecs', 'describe-task-definition', '--task-definition', 'x']],
  ['s3 object', 'aws', ['s3api', 'get-object', '--bucket', 'b', '--key', 'k', 'out']],
  ['s3 copy', 'aws', ['s3', 'cp', 's3://b/k', '.']],
  ['kms', 'aws', ['kms', 'decrypt', '--ciphertext-blob', 'x']],
  ['iam keys', 'aws', ['iam', 'list-access-keys']],
  ['iam credential report', 'aws', ['iam', 'get-credential-report']],
  ['config get', 'aws', ['configure', 'get', 'aws_secret_access_key']],
  ['config list', 'aws', ['configure', 'list']],
  ['sso token', 'aws', ['sso', 'get-role-credentials', '--role-name', 'r', '--account-id', '123456789012', '--access-token', 't']],
  // Mutations.
  ['terminate', 'aws', ['ec2', 'terminate-instances', '--instance-ids', 'i-0123456789abcdef0']],
  ['delete', 'aws', ['s3api', 'delete-bucket', '--bucket', 'b']],
  ['create', 'aws', ['sqs', 'create-queue', '--queue-name', 'q']],
  ['put', 'aws', ['dynamodb', 'put-item', '--table-name', 't', '--item', '{}']],
  ['invoke', 'aws', ['lambda', 'invoke', '--function-name', 'f', 'out']],
  ['run', 'aws', ['ec2', 'run-instances', '--image-id', 'ami-1']],
  ['wait', 'aws', ['ec2', 'wait', 'instance-running']],
  ['az mutate', 'az', ['vm', 'delete', '--name', 'x', '--yes']],
  ['az token', 'az', ['account', 'get-access-token']],
  ['az login', 'az', ['login']],
  ['az keys', 'az', ['storage', 'account', 'keys', 'list', '--account-name', 'x']],
  ['az keyvault', 'az', ['keyvault', 'secret', 'show', '--vault-name', 'v', '--name', 'n']],
  ['az resource delete', 'az', ['resource', 'delete', '--ids', 'x']],
  ['az resource show', 'az', ['resource', 'show', '--ids', 'x']],
  ['az rest', 'az', ['rest', '--method', 'delete', '--url', 'https://management.azure.com/x']],
  ['gcloud auth token', 'gcloud', ['auth', 'print-access-token']],
  ['gcloud secrets', 'gcloud', ['secrets', 'versions', 'access', 'latest', '--secret=x']],
  ['gcloud delete', 'gcloud', ['compute', 'instances', 'delete', 'x']],
  ['gcloud ssh', 'gcloud', ['compute', 'ssh', 'x']],
  ['gcloud list (not the asset search)', 'gcloud', ['compute', 'instances', 'list']],
  ['gcloud asset export', 'gcloud', ['asset', 'export', '--content-type=resource', '--output-path=gs://b/x']],
  ['gcloud asset feeds', 'gcloud', ['asset', 'feeds', 'create', 'f']],
  // Binaries.
  ['shell', 'sh', ['-c', 'aws ec2 describe-instances']],
  ['path to binary', '/usr/local/bin/aws', ['ec2', 'describe-instances', '--output', 'json']],
  ['relative binary', './aws', ['ec2', 'describe-instances', '--output', 'json']],
  ['env', 'env', ['aws', 'ec2', 'describe-instances']],
  ['curl', 'curl', ['https://example.com']],
  ['git', 'git', ['status']],
  ['capital', 'AWS', ['ec2', 'describe-instances', '--output', 'json']],
  ['empty', '', []],
];

describe('read-only cloud command allowlist', () => {
  it.each(allowed)('allows %s %j', (cmd, args) => {
    expect(() => assertReadOnly(cmd, args)).not.toThrow();
  });

  it.each(refused)('refuses %s', (_name, cmd, args) => {
    expect(() => assertReadOnly(cmd, args)).toThrow(CloudCommandRefused);
  });

  describe('flags are as strict as commands', () => {
    const base = ['ec2', 'describe-instances', '--output', 'json'];
    const bad: [string, string[]][] = [
      ['endpoint redirect (credentials would go to the attacker)', ['--endpoint-url', 'https://evil.example']],
      ['endpoint redirect, inline', ['--endpoint-url=https://evil.example']],
      ['debug log (prints signed requests)', ['--debug']],
      ['custom CA bundle', ['--ca-bundle', '/tmp/ca.pem']],
      ['no TLS verification', ['--no-verify-ssl']],
      ['input from json (can swap the operation)', ['--cli-input-json', '{}']],
      ['input from yaml file', ['--cli-input-yaml', 'file://x']],
      ['JMESPath query', ['--query', 'Reservations[].Instances[].UserData']],
      ['yaml/text output', ['--output', 'text']],
      ['table output', ['--output', 'table']],
      ['output given twice', ['--output', 'json']],
      ['profile that is a flag', ['--profile', '--debug']],
      ['profile with a path', ['--profile', '../../etc/passwd']],
      ['profile with a space and shell syntax', ['--profile', 'a; rm -rf /']],
      ['profile too long', ['--profile', 'a'.repeat(65)]],
      ['region that is not a region', ['--region', 'us-east-1; id']],
      ['region as a URL', ['--region', 'https://evil.example']],
      ['value-less region', ['--region']],
      ['flag value with a newline', ['--profile', 'a\nb']],
      ['flag value with NUL', ['--profile', 'a\0b']],
      ['unknown flag', ['--force']],
      ['stray positional', ['extra']],
      ['short flag', ['-o', 'text']],
      ['pager (can run a program)', ['--cli-pager', 'sh']],
      ['read timeout flag is not needed', ['--cli-read-timeout', '0']],
      ['--no-sign-request', ['--no-sign-request']],
      ['--color', ['--color', 'on']],
    ];
    it.each(bad)('refuses %s', (_name, extra) => {
      expect(() => assertReadOnly('aws', [...base, ...extra])).toThrow(CloudCommandRefused);
    });

    it('requires --output json: the collector parses JSON and nothing else', () => {
      expect(() => assertReadOnly('aws', ['ec2', 'describe-instances'])).toThrow(CloudCommandRefused);
    });

    it('refuses the operation path anywhere but first, and extra path words', () => {
      expect(() => assertReadOnly('aws', ['--output', 'json', 'ec2', 'describe-instances'])).toThrow(CloudCommandRefused);
      expect(() => assertReadOnly('aws', ['ec2', 'describe-instances', 'describe-vpcs', '--output', 'json'])).toThrow(CloudCommandRefused);
      expect(() => assertReadOnly('aws', ['ec2', '--output', 'json'])).toThrow(CloudCommandRefused);
    });

    it('requires and validates the flags an operation needs', () => {
      expect(() => assertReadOnly('aws', ['elbv2', 'describe-target-health', '--output', 'json'])).toThrow(CloudCommandRefused);
      expect(() => assertReadOnly('aws', ['elbv2', 'describe-target-health', '--target-group-arn', 'not-an-arn', '--output', 'json'])).toThrow(CloudCommandRefused);
      expect(() => assertReadOnly('aws', ['apigatewayv2', 'get-integrations', '--api-id', '../x', '--output', 'json'])).toThrow(CloudCommandRefused);
      expect(() => assertReadOnly('aws', ['eks', 'describe-cluster', '--name', '--debug', '--output', 'json'])).toThrow(CloudCommandRefused);
      expect(() => assertReadOnly('aws', ['ecs', 'describe-services', '--cluster', CLUSTER, '--services', '--output', 'json'])).toThrow(CloudCommandRefused);
    });

    it('caps how many services one describe-services call may name (the API takes 10)', () => {
      const names = Array.from({ length: 11 }, (_, i) => `s${i}`);
      expect(() => assertReadOnly('aws', ['ecs', 'describe-services', '--cluster', CLUSTER, '--services', ...names, '--output', 'json'])).toThrow(CloudCommandRefused);
    });

    it('refuses flags that belong to another operation', () => {
      expect(() => assertReadOnly('aws', ['ec2', 'describe-vpcs', '--target-group-arn', ARN, '--output', 'json'])).toThrow(CloudCommandRefused);
    });

    it('gcloud: refuses scopes outside a project, impersonation and unknown output formats', () => {
      const search = ['asset', 'search-all-resources'];
      for (const extra of [['--scope=organizations/1234567', '--format=json'], ['--scope=folders/1234567', '--format=json'], ['--scope=projects/p', '--format=json'], ['--scope=projects/shop-prod-123456', '--format=yaml'], ['--scope=projects/shop-prod-123456', '--format=json', '--impersonate-service-account=a@b.iam.gserviceaccount.com'], ['--scope=projects/shop-prod-123456', '--format=json', '--access-token-file=/tmp/t'], ['--scope=projects/shop-prod-123456', '--format=json', '--project=other'], ['--scope=projects/shop-prod-123456'], ['--format=json'], ['--scope=projects/shop-prod-123456', '--format=json', '--page-size=abc'], ['--scope=projects/shop-prod-123456', '--format=value(name)'], ['--scope=projects/shop-prod-123456', '--format=json', '--read-mask=*'], ['--scope=projects/shop-prod-123456', '--format=json', '--billing-project=x'], ['--scope=projects/shop-prod-123456', '--format=json', '--verbosity=debug'], ['--scope=projects/shop-prod-123456', '--format=json', '--log-http']]) {
        expect(() => assertReadOnly('gcloud', [...search, ...extra]), extra.join(' ')).toThrow(CloudCommandRefused);
      }
    });

    it('az: refuses unknown flags, queries, other outputs and odd subscription names', () => {
      const list = ['resource', 'list'];
      for (const extra of [['--query', '[].id', '--output', 'json'], ['--output', 'tsv'], ['--output', 'yaml'], ['--output', 'json', '--ids', 'x'], ['--output', 'json', '--debug'], ['--output', 'json', '--subscription', '--debug'], ['--output', 'json', '--subscription', 'a;b'], ['--output', 'json', '--resource-group', 'a b'], ['--output', 'json', '--resource-type', 'x'], ['--output', 'json', '--tag', 'k=v'], ['-o', 'json']]) {
        expect(() => assertReadOnly('az', [...list, ...extra]), extra.join(' ')).toThrow(CloudCommandRefused);
      }
    });
  });

  describe('readOnlyRunner', () => {
    const recording = () => {
      const calls: { cmd: string; args: readonly string[] }[] = [];
      const inner: CommandRunner = async (cmd, args) => { calls.push({ cmd, args: [...args] }); return { code: 0, stdout: '{}', stderr: '' }; };
      return { calls, run: readOnlyRunner(inner) };
    };

    it('passes an allowed command through untouched', async () => {
      const { calls, run } = recording();
      const result = await run('aws', ['ec2', 'describe-vpcs', '--output', 'json']);
      expect(result.stdout).toBe('{}');
      expect(calls).toEqual([{ cmd: 'aws', args: ['ec2', 'describe-vpcs', '--output', 'json'] }]);
    });

    it('never reaches the real runner with a refused command', async () => {
      const { calls, run } = recording();
      for (const [, cmd, args] of refused) await expect(run(cmd, args)).rejects.toBeInstanceOf(CloudCommandRefused);
      expect(calls).toEqual([]);
    });

    it('refuses to be given a working directory or an environment: credentials come only from the user’s own CLI setup', async () => {
      const { calls, run } = recording();
      await expect(run('aws', ['ec2', 'describe-vpcs', '--output', 'json'], { env: { AWS_ENDPOINT_URL: 'https://evil.example' } })).rejects.toBeInstanceOf(CloudCommandRefused);
      await expect(run('aws', ['ec2', 'describe-vpcs', '--output', 'json'], { cwd: '/' })).rejects.toBeInstanceOf(CloudCommandRefused);
      expect(calls).toEqual([]);
    });

    it('says in pt-BR what was refused', async () => {
      const { run } = recording();
      await expect(run('aws', ['secretsmanager', 'get-secret-value', '--secret-id', 'x'])).rejects.toThrow(/somente leitura|lista de comandos permitidos/);
    });
  });

  it('every allowed operation is a read: no mutating verb in any allowed path', () => {
    for (const [, args] of allowed) {
      const path = args.filter((arg) => !arg.startsWith('-')).slice(0, 2).join(' ');
      expect(path, path).not.toMatch(/\b(create|delete|put|update|terminate|run|start|stop|reboot|attach|detach|modify|remove|invoke|publish|send|assume|decrypt|get-secret|get-password|get-token|get-function|login)\b/);
    }
  });
});
