import { awsOutputs, azureListingJson, gcpListingJson } from '@strukt/dsl/cloud-fixtures';
import type { CommandResult, CommandRunner } from '@strukt/git';

export interface FixtureRunnerOptions {
  /** Every `cmd args` the runner saw, in order. */
  calls?: string[];
  /** `aws <service>` prefixes that answer AccessDenied (the call is skipped, the import goes on). */
  denied?: string[];
  /** Replaces what a path answers: `aws ec2 describe-vpcs` → the JSON to print. */
  override?: Record<string, unknown>;
  /** Makes every call fail with this stderr (exit 255). */
  fail?: string;
}

const ok = (value: unknown): CommandResult => ({ code: 0, stdout: `${JSON.stringify(value, null, 2)}\n`, stderr: '' });
const flag = (args: readonly string[], name: string): string | undefined => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };

const AWS: Record<string, unknown> = {
  'sts get-caller-identity': awsOutputs.identity,
  'ec2 describe-instances': awsOutputs.instances,
  'ec2 describe-vpcs': awsOutputs.vpcs,
  'ec2 describe-subnets': awsOutputs.subnets,
  'ec2 describe-security-groups': awsOutputs.securityGroups,
  'ec2 describe-nat-gateways': awsOutputs.natGateways,
  'ec2 describe-internet-gateways': awsOutputs.internetGateways,
  'elbv2 describe-load-balancers': awsOutputs.loadBalancers,
  'elbv2 describe-target-groups': awsOutputs.targetGroups,
  'rds describe-db-instances': awsOutputs.rdsInstances,
  'rds describe-db-clusters': awsOutputs.rdsClusters,
  'lambda list-functions': awsOutputs.lambdaFunctions,
  'lambda list-event-source-mappings': awsOutputs.eventSourceMappings,
  's3api list-buckets': awsOutputs.buckets,
  'sqs list-queues': awsOutputs.queues,
  'sns list-topics': awsOutputs.topics,
  'sns list-subscriptions': awsOutputs.subscriptions,
  'dynamodb list-tables': awsOutputs.dynamoTables,
  'apigatewayv2 get-apis': awsOutputs.apis,
  'ecs list-clusters': awsOutputs.ecsClusters,
  'eks list-clusters': awsOutputs.eksList,
};

/** A stand-in for the `aws`/`az`/`gcloud` binaries that answers with the recorded-shape fixtures. */
export function fixtureCloudRunner(options: FixtureRunnerOptions = {}): CommandRunner {
  return async (cmd, args) => {
    options.calls?.push(`${cmd} ${args.join(' ')}`);
    if (options.fail) return { code: 255, stdout: '', stderr: options.fail };
    if (cmd === 'az') return ok(azureListingJson);
    if (cmd === 'gcloud') return ok(gcpListingJson);
    if (cmd !== 'aws') return { code: 127, stdout: '', stderr: `${cmd}: command not found` };
    const path = `${args[0]} ${args[1]}`;
    if (options.denied?.some((prefix) => path.startsWith(prefix))) return { code: 254, stdout: '', stderr: `An error occurred (AccessDeniedException) when calling the ${args[1]} operation: User is not authorized to perform ${args[1]}` };
    if (options.override && Object.hasOwn(options.override, `aws ${path}`)) return ok(options.override[`aws ${path}`]);
    if (path === 'elbv2 describe-target-health') return ok(flag(args, '--target-group-arn')?.includes('shop-web-tg') ? awsOutputs.healthWeb : awsOutputs.healthApi);
    if (path === 'apigatewayv2 get-integrations') return ok(awsOutputs.integrations);
    if (path === 'ecs list-services') return ok(awsOutputs.ecsServicesList);
    if (path === 'ecs describe-services') return ok(awsOutputs.ecsServices);
    if (path === 'eks describe-cluster') return ok(awsOutputs.eksCluster);
    if (Object.hasOwn(AWS, path)) return ok(AWS[path]);
    return { code: 252, stdout: '', stderr: `aws: error: argument operation: Invalid choice: ${args[1]}` };
  };
}
