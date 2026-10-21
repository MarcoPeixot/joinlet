import { asArray, asString, pick, pickPath } from '../common';
import { GraphCollector } from './collector';
import { ec2Arn, nameTag, parseArn } from './ids';
import { setAttr } from './safe';
import type { CloudAttrs, CloudGraph, CloudScope } from './types';

/**
 * Parsed output of the read-only AWS CLI calls the collector makes (one value per call, `undefined` when the call was
 * skipped or denied). Shapes follow `aws ... --output json` of CLI v2; nothing here is trusted: every read is defensive.
 */
export interface AwsInputs {
  region: string;
  account?: string;
  instances?: unknown;
  vpcs?: unknown;
  subnets?: unknown;
  securityGroups?: unknown;
  natGateways?: unknown;
  internetGateways?: unknown;
  loadBalancers?: unknown;
  targetGroups?: unknown;
  /** `describe-target-health` per target group ARN. */
  targetHealth?: Record<string, unknown>;
  rdsInstances?: unknown;
  rdsClusters?: unknown;
  lambdaFunctions?: unknown;
  eventSourceMappings?: unknown;
  buckets?: unknown;
  queues?: unknown;
  topics?: unknown;
  subscriptions?: unknown;
  dynamoTables?: unknown;
  apis?: unknown;
  /** `apigatewayv2 get-integrations` per API id. */
  integrations?: Record<string, unknown>;
  ecsClusters?: unknown;
  /** `ecs describe-services` per cluster ARN (already merged across batches of 10). */
  ecsServices?: Record<string, unknown>;
  /** `eks describe-cluster` outputs. */
  eksClusters?: unknown[];
}

const items = (source: unknown, key: string, limit = 2000): unknown[] => asArray(pick(source, key), limit);
const text = (record: unknown, key: string): string | undefined => asString(pick(record, key));

function label(record: unknown, fallback: string | undefined): string | undefined {
  return nameTag(pick(record, 'Tags')) ?? fallback;
}

/** Native EC2 id → canonical ARN (falls back to the id itself when the account is unknown). */
export function awsEc2Id(type: string, nativeId: string, region: string, account: string | undefined): string {
  return ec2Arn(type, nativeId, region, account) ?? nativeId;
}

const LAMBDA_ARN = /arn:aws[a-z-]*:lambda:[a-z0-9-]+:\d{12}:function:[A-Za-z0-9_-]{1,64}/;

export function normalizeAws(inputs: AwsInputs): CloudGraph {
  const c = new GraphCollector();
  const { region } = inputs;
  const guessAccount = (): string | undefined => {
    for (const reservation of items(inputs.instances, 'Reservations', 100)) { const owner = text(reservation, 'OwnerId'); if (owner) return owner; }
    for (const vpc of items(inputs.vpcs, 'Vpcs', 10)) { const owner = text(vpc, 'OwnerId'); if (owner) return owner; }
    for (const fn of items(inputs.lambdaFunctions, 'Functions', 10)) { const parsed = parseArn(text(fn, 'FunctionArn')); if (parsed?.account) return parsed.account; }
    return undefined;
  };
  const account = inputs.account ?? guessAccount();
  if (!account) c.warn('Conta AWS desconhecida: os identificadores de EC2 e DynamoDB ficam sem o número da conta.');
  const ec2 = (type: string, native: string): string => awsEc2Id(type, native, region, account);
  const links: [string, string][] = [];
  const connect = (from: string, to: string) => links.push([from, to]);

  for (const vpc of items(inputs.vpcs, 'Vpcs')) {
    const native = text(vpc, 'VpcId');
    if (!native) continue;
    const attrs: CloudAttrs = {};
    setAttr(attrs, 'cidr', pick(vpc, 'CidrBlock'));
    c.add({ id: ec2('aws:ec2:vpc', native), provider: 'aws', type: 'aws:ec2:vpc', name: label(vpc, native), region, attrs });
  }
  for (const subnet of items(inputs.subnets, 'Subnets')) {
    const native = text(subnet, 'SubnetId');
    if (!native) continue;
    const attrs: CloudAttrs = {};
    setAttr(attrs, 'cidr', pick(subnet, 'CidrBlock'));
    setAttr(attrs, 'az', pick(subnet, 'AvailabilityZone'));
    if (pick(subnet, 'MapPublicIpOnLaunch') === true) attrs.public = true;
    const vpc = text(subnet, 'VpcId');
    c.add({ id: text(subnet, 'SubnetArn') ?? ec2('aws:ec2:subnet', native), provider: 'aws', type: 'aws:ec2:subnet', name: label(subnet, native), region, attrs, ...(vpc ? { net: { vpc: ec2('aws:ec2:vpc', vpc) } } : {}) });
  }
  for (const group of items(inputs.securityGroups, 'SecurityGroups')) {
    const native = text(group, 'GroupId');
    if (!native) continue;
    const vpc = text(group, 'VpcId');
    c.add({ id: ec2('aws:ec2:security-group', native), provider: 'aws', type: 'aws:ec2:security-group', name: text(group, 'GroupName') ?? native, region, ...(vpc ? { net: { vpc: ec2('aws:ec2:vpc', vpc) } } : {}) });
  }
  for (const nat of items(inputs.natGateways, 'NatGateways')) {
    const native = text(nat, 'NatGatewayId');
    if (!native || text(nat, 'State') === 'deleted') continue;
    const subnet = text(nat, 'SubnetId');
    const vpc = text(nat, 'VpcId');
    const attrs: CloudAttrs = {};
    setAttr(attrs, 'connectivity', pick(nat, 'ConnectivityType'));
    c.add({ id: ec2('aws:ec2:nat-gateway', native), provider: 'aws', type: 'aws:ec2:nat-gateway', name: label(nat, native), region, attrs, net: { ...(vpc ? { vpc: ec2('aws:ec2:vpc', vpc) } : {}), ...(subnet ? { subnets: [ec2('aws:ec2:subnet', subnet)] } : {}) } });
  }
  for (const gateway of items(inputs.internetGateways, 'InternetGateways')) {
    const native = text(gateway, 'InternetGatewayId');
    if (!native) continue;
    const vpc = text(asArray(pick(gateway, 'Attachments'), 5)[0], 'VpcId');
    c.add({ id: ec2('aws:ec2:internet-gateway', native), provider: 'aws', type: 'aws:ec2:internet-gateway', name: label(gateway, native), region, ...(vpc ? { net: { vpc: ec2('aws:ec2:vpc', vpc) } } : {}) });
  }
  for (const reservation of items(inputs.instances, 'Reservations', 5000)) {
    for (const instance of items(reservation, 'Instances', 1000)) {
      const native = text(instance, 'InstanceId');
      const state = text(pick(instance, 'State'), 'Name');
      if (!native || state === 'terminated' || state === 'shutting-down') continue;
      const attrs: CloudAttrs = {};
      setAttr(attrs, 'instanceType', pick(instance, 'InstanceType'));
      setAttr(attrs, 'az', pickPath(instance, 'Placement', 'AvailabilityZone'));
      setAttr(attrs, 'state', state);
      const subnet = text(instance, 'SubnetId');
      const vpc = text(instance, 'VpcId');
      c.add({ id: ec2('aws:ec2:instance', native), provider: 'aws', type: 'aws:ec2:instance', name: label(instance, native), region, attrs, net: { ...(vpc ? { vpc: ec2('aws:ec2:vpc', vpc) } : {}), ...(subnet ? { subnets: [ec2('aws:ec2:subnet', subnet)] } : {}) } });
    }
  }

  for (const lb of items(inputs.loadBalancers, 'LoadBalancers')) {
    const arn = text(lb, 'LoadBalancerArn');
    if (!arn) continue;
    const attrs: CloudAttrs = {};
    setAttr(attrs, 'lbType', pick(lb, 'Type'));
    setAttr(attrs, 'scheme', pick(lb, 'Scheme'));
    const vpc = text(lb, 'VpcId');
    const subnets = items(lb, 'AvailabilityZones', 20).map((zone) => text(zone, 'SubnetId')).filter((id): id is string => !!id).map((id) => ec2('aws:ec2:subnet', id));
    c.add({ id: arn, provider: 'aws', type: 'aws:elbv2:load-balancer', name: text(lb, 'LoadBalancerName'), region, attrs, net: { ...(vpc ? { vpc: ec2('aws:ec2:vpc', vpc) } : {}), subnets } });
  }
  for (const group of items(inputs.targetGroups, 'TargetGroups')) {
    const arn = text(group, 'TargetGroupArn');
    if (!arn) continue;
    const attrs: CloudAttrs = {};
    setAttr(attrs, 'protocol', pick(group, 'Protocol'));
    setAttr(attrs, 'port', pick(group, 'Port'));
    c.add({ id: arn, provider: 'aws', type: 'aws:elbv2:target-group', name: text(group, 'TargetGroupName'), region, attrs });
    for (const lb of items(group, 'LoadBalancerArns', 50)) if (typeof lb === 'string') connect(lb, arn);
    for (const health of items(inputs.targetHealth?.[arn], 'TargetHealthDescriptions', 1000)) {
      const target = text(pick(health, 'Target'), 'Id');
      if (!target) continue;
      if (target.startsWith('arn:')) connect(arn, target);
      else if (/^i-[0-9a-f]+$/.test(target)) connect(arn, ec2('aws:ec2:instance', target));
    }
  }

  for (const db of items(inputs.rdsInstances, 'DBInstances')) {
    const arn = text(db, 'DBInstanceArn');
    if (!arn) continue;
    const attrs: CloudAttrs = {};
    setAttr(attrs, 'engine', pick(db, 'Engine'));
    setAttr(attrs, 'engineVersion', pick(db, 'EngineVersion'));
    setAttr(attrs, 'instanceClass', pick(db, 'DBInstanceClass'));
    setAttr(attrs, 'multiAz', pick(db, 'MultiAZ'));
    const vpc = text(pick(db, 'DBSubnetGroup'), 'VpcId');
    c.add({ id: arn, provider: 'aws', type: 'aws:rds:instance', name: text(db, 'DBInstanceIdentifier'), region, attrs, ...(vpc ? { net: { vpc: ec2('aws:ec2:vpc', vpc) } } : {}) });
  }
  for (const cluster of items(inputs.rdsClusters, 'DBClusters')) {
    const arn = text(cluster, 'DBClusterArn');
    if (!arn) continue;
    const attrs: CloudAttrs = {};
    setAttr(attrs, 'engine', pick(cluster, 'Engine'));
    setAttr(attrs, 'engineVersion', pick(cluster, 'EngineVersion'));
    c.add({ id: arn, provider: 'aws', type: 'aws:rds:cluster', name: text(cluster, 'DBClusterIdentifier'), region, attrs });
  }

  for (const fn of items(inputs.lambdaFunctions, 'Functions')) {
    const arn = text(fn, 'FunctionArn');
    if (!arn) continue;
    const attrs: CloudAttrs = {};
    setAttr(attrs, 'runtime', pick(fn, 'Runtime'));
    setAttr(attrs, 'memory', pick(fn, 'MemorySize'));
    const vpc = text(pick(fn, 'VpcConfig'), 'VpcId');
    c.add({ id: arn, provider: 'aws', type: 'aws:lambda:function', name: text(fn, 'FunctionName'), region, attrs, ...(vpc ? { net: { vpc: ec2('aws:ec2:vpc', vpc) } } : {}) });
  }
  for (const mapping of items(inputs.eventSourceMappings, 'EventSourceMappings')) {
    const source = text(mapping, 'EventSourceArn');
    const fn = text(mapping, 'FunctionArn');
    if (source && fn) connect(source, fn);
  }

  for (const bucket of items(inputs.buckets, 'Buckets')) {
    const name = text(bucket, 'Name');
    if (!name) continue;
    const bucketRegion = text(bucket, 'BucketRegion');
    if (bucketRegion && bucketRegion !== region) continue;
    c.add({ id: `arn:aws:s3:::${name}`, provider: 'aws', type: 'aws:s3:bucket', name, ...(bucketRegion ? { region: bucketRegion } : {}) });
  }
  for (const queue of items(inputs.queues, 'QueueUrls')) {
    const url = typeof queue === 'string' ? /^https:\/\/sqs\.([a-z0-9-]+)\.amazonaws\.com\/(\d{12})\/([A-Za-z0-9_.-]{1,80})$/.exec(queue) : null;
    if (!url) continue;
    const attrs: CloudAttrs = {};
    if (url[3]!.endsWith('.fifo')) attrs.fifo = true;
    c.add({ id: `arn:aws:sqs:${url[1]}:${url[2]}:${url[3]}`, provider: 'aws', type: 'aws:sqs:queue', name: url[3], region: url[1], attrs });
  }
  for (const topic of items(inputs.topics, 'Topics')) {
    const arn = text(topic, 'TopicArn');
    const parsed = parseArn(arn);
    if (arn && parsed) c.add({ id: arn, provider: 'aws', type: 'aws:sns:topic', name: parsed.resource, region: parsed.region });
  }
  for (const subscription of items(inputs.subscriptions, 'Subscriptions')) {
    const topic = text(subscription, 'TopicArn');
    const endpoint = text(subscription, 'Endpoint');
    // Only AWS endpoints are relations; e-mail/SMS/HTTP endpoints are personal data and never leave the CLI output.
    if (topic && endpoint?.startsWith('arn:')) connect(topic, endpoint);
  }
  for (const table of asArray(pick(inputs.dynamoTables, 'TableNames'), 2000)) {
    if (typeof table !== 'string' || !/^[A-Za-z0-9_.-]{3,255}$/.test(table)) continue;
    const arn = account ? `arn:aws:dynamodb:${region}:${account}:table/${table}` : `dynamodb:${region}:table/${table}`;
    c.add({ id: arn, provider: 'aws', type: 'aws:dynamodb:table', name: table, region });
  }

  for (const api of items(inputs.apis, 'Items')) {
    const apiId = text(api, 'ApiId');
    if (!apiId) continue;
    const attrs: CloudAttrs = {};
    setAttr(attrs, 'protocol', pick(api, 'ProtocolType'));
    const arn = `arn:aws:apigateway:${region}::/apis/${apiId}`;
    c.add({ id: arn, provider: 'aws', type: 'aws:apigateway:api', name: text(api, 'Name') ?? apiId, region, attrs });
    for (const integration of items(inputs.integrations?.[apiId], 'Items', 500)) {
      const lambda = LAMBDA_ARN.exec(text(integration, 'IntegrationUri') ?? '');
      if (lambda) connect(arn, lambda[0]);
    }
  }

  for (const clusterArn of asArray(pick(inputs.ecsClusters, 'clusterArns'), 500)) {
    if (typeof clusterArn !== 'string') continue;
    const parsed = parseArn(clusterArn);
    if (!parsed) continue;
    c.add({ id: clusterArn, provider: 'aws', type: 'aws:ecs:cluster', name: parsed.resource.slice(parsed.resource.indexOf('/') + 1), region: parsed.region });
    for (const service of items(inputs.ecsServices?.[clusterArn], 'services', 1000)) {
      const arn = text(service, 'serviceArn');
      if (!arn) continue;
      const attrs: CloudAttrs = {};
      setAttr(attrs, 'launchType', pick(service, 'launchType'));
      setAttr(attrs, 'desired', pick(service, 'desiredCount'));
      const subnets = asArray(pickPath(service, 'networkConfiguration', 'awsvpcConfiguration', 'subnets'), 20).filter((id): id is string => typeof id === 'string').map((id) => ec2('aws:ec2:subnet', id));
      c.add({ id: arn, provider: 'aws', type: 'aws:ecs:service', name: text(service, 'serviceName'), region: parsed.region, attrs, ...(subnets.length ? { net: { subnets } } : {}) });
      connect(clusterArn, arn);
      for (const balancer of items(service, 'loadBalancers', 20)) {
        const target = text(balancer, 'targetGroupArn');
        if (target) connect(target, arn);
      }
    }
  }
  for (const wrapped of asArray(inputs.eksClusters, 200)) {
    const cluster = pick(wrapped, 'cluster');
    const arn = text(cluster, 'arn');
    if (!arn) continue;
    const attrs: CloudAttrs = {};
    setAttr(attrs, 'version', pick(cluster, 'version'));
    const vpc = text(pick(cluster, 'resourcesVpcConfig'), 'vpcId');
    c.add({ id: arn, provider: 'aws', type: 'aws:eks:cluster', name: text(cluster, 'name'), region, attrs, ...(vpc ? { net: { vpc: ec2('aws:ec2:vpc', vpc) } } : {}) });
  }

  for (const [from, to] of links) c.link(from, to);
  const scope: CloudScope = { region };
  return { origin: 'aws', scope, resources: c.resources(), diagnostics: c.diagnostics };
}
