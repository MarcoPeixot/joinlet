import { describe, expect, it } from 'vitest';
import { AWS_ACCOUNT, awsInputs } from '../../fixtures/cloud';
import { normalizeAws } from './aws';
import type { CloudResource } from './types';

const graph = normalizeAws(awsInputs());
const byId = new Map(graph.resources.map((resource) => [resource.id, resource]));
const named = (name: string): CloudResource => {
  const found = graph.resources.find((resource) => resource.name === name);
  if (!found) throw new Error(`recurso ${name} ausente`);
  return found;
};
const A = AWS_ACCOUNT;

describe('AWS normalizer', () => {
  it('uses ARNs as canonical ids, also for EC2-family resources the CLI lists by native id', () => {
    expect(byId.has(`arn:aws:ec2:us-east-1:${A}:instance/i-0123456789abcdef0`)).toBe(true);
    expect(byId.has(`arn:aws:ec2:us-east-1:${A}:vpc/vpc-0a1b2c3d4e5f60718`)).toBe(true);
    expect(byId.has(`arn:aws:ec2:us-east-1:${A}:internet-gateway/igw-0123abcd4567ef890`)).toBe(true);
    expect(byId.has(`arn:aws:sqs:us-east-1:${A}:shop-orders`)).toBe(true);
    expect(byId.has(`arn:aws:dynamodb:us-east-1:${A}:table/shop-carts`)).toBe(true);
    expect(byId.has('arn:aws:s3:::shop-assets-prod')).toBe(true);
    expect(byId.has('arn:aws:apigateway:us-east-1::/apis/abc123xyz')).toBe(true);
  });

  it('covers every AWS service of the plan', () => {
    const types = new Set(graph.resources.map((resource) => resource.type));
    for (const type of [
      'aws:ec2:instance', 'aws:ec2:vpc', 'aws:ec2:subnet', 'aws:ec2:security-group', 'aws:ec2:nat-gateway', 'aws:ec2:internet-gateway',
      'aws:elbv2:load-balancer', 'aws:elbv2:target-group', 'aws:rds:instance', 'aws:rds:cluster', 'aws:lambda:function', 'aws:s3:bucket',
      'aws:sqs:queue', 'aws:sns:topic', 'aws:dynamodb:table', 'aws:apigateway:api', 'aws:ecs:cluster', 'aws:ecs:service', 'aws:eks:cluster',
    ]) expect(types.has(type), type).toBe(true);
  });

  it('skips terminated instances and deleted NAT gateways, and buckets of other regions', () => {
    expect(graph.resources.find((r) => r.name === 'shop-old-batch')).toBeUndefined();
    expect(graph.resources.find((r) => r.id.includes('nat-0deadbeef'))).toBeUndefined();
    expect(graph.resources.find((r) => r.name === 'shop-eu-backups')).toBeUndefined();
    expect(named('shop-assets-prod').type).toBe('aws:s3:bucket');
  });

  it('names resources by their Name tag and keeps only allowlisted attributes', () => {
    expect(named('shop-web-1').attrs).toEqual({ instanceType: 't3.medium', az: 'us-east-1a', state: 'running' });
    expect(named('shop-db').attrs).toEqual({ engine: 'postgres', engineVersion: '15.4', instanceClass: 'db.r6g.large', multiAz: true });
    expect(named('shop-orders-worker').attrs).toEqual({ runtime: 'python3.12', memory: 256 });
  });

  it('places resources in the network: subnet for an instance, VPC for a multi-subnet load balancer or database', () => {
    const subnet = (id: string) => `arn:aws:ec2:us-east-1:${A}:subnet/${id}`;
    expect(named('shop-web-1').net).toEqual({ vpc: `arn:aws:ec2:us-east-1:${A}:vpc/vpc-0a1b2c3d4e5f60718`, subnets: [subnet('subnet-0c33cccc3333cccc3')] });
    expect(named('shop-alb').net?.subnets).toHaveLength(2);
    expect(named('shop-db').net).toEqual({ vpc: `arn:aws:ec2:us-east-1:${A}:vpc/vpc-0a1b2c3d4e5f60718` });
  });

  it('links the load balancer to its target group and the target group to instances and the function, through the target health', () => {
    const lb = named('shop-alb');
    const web = named('shop-web-tg');
    const api = named('shop-api-tg');
    expect(lb.links).toEqual([api.id, web.id].sort());
    expect(web.links).toContain(`arn:aws:ec2:us-east-1:${A}:instance/i-0123456789abcdef0`);
    expect(web.links).toContain(`arn:aws:ec2:us-east-1:${A}:instance/i-0fedcba9876543210`);
    expect(web.links).toContain(`arn:aws:ecs:us-east-1:${A}:service/shop-cluster/shop-checkout`);
    expect(api.links).toEqual([`arn:aws:lambda:us-east-1:${A}:function:shop-api-handler`]);
  });

  it('links triggers to the functions they invoke, and API Gateway to its Lambda integration', () => {
    expect(named('shop-orders').links).toEqual([`arn:aws:lambda:us-east-1:${A}:function:shop-orders-worker`]);
    expect(named('shop-alerts').links).toEqual([`arn:aws:lambda:us-east-1:${A}:function:shop-orders-worker`, `arn:aws:sqs:us-east-1:${A}:shop-orders-dlq`]);
    expect(named('shop-http-api').links).toEqual([`arn:aws:lambda:us-east-1:${A}:function:shop-api-handler`]);
    expect(named('shop-cluster').links).toEqual([`arn:aws:ecs:us-east-1:${A}:service/shop-cluster/shop-checkout`]);
  });

  it('never links to something outside the graph (IP targets, e-mail subscribers)', () => {
    for (const resource of graph.resources) for (const link of resource.links) expect(byId.has(link), link).toBe(true);
  });

  it('is deterministic: the same inputs give the same resources in the same order', () => {
    expect(normalizeAws(awsInputs())).toEqual(graph);
    expect(graph.resources.map((r) => r.id)).toEqual([...graph.resources.map((r) => r.id)].sort());
  });

  it('marks structural kinds as not drawn (security groups, target groups)', () => {
    expect(named('shop-web-sg').show).toBe(false);
    expect(named('shop-web-tg').show).toBe(false);
    expect(named('shop-web-1').show).toBe(true);
  });

  it('still works when a call was denied: missing inputs just mean fewer resources', () => {
    const { region } = awsInputs();
    expect(normalizeAws({ region }).resources).toEqual([]);
    const partial = normalizeAws({ region, account: A, lambdaFunctions: awsInputs().lambdaFunctions });
    expect(partial.resources.map((r) => r.type)).toEqual(['aws:lambda:function', 'aws:lambda:function']);
  });

  it('tolerates hostile shapes without throwing', () => {
    const hostile: unknown[] = [null, 1, 'x', [], {}, { Reservations: 5 }, { Reservations: [null, { Instances: 'x' }, { Instances: [null, { InstanceId: 5 }, { InstanceId: '__proto__' }] }] }, { constructor: 1 }];
    for (const value of hostile) {
      expect(() => normalizeAws({ region: 'us-east-1', instances: value, vpcs: value, lambdaFunctions: value, buckets: value, queues: value, apis: value, ecsClusters: value, eksClusters: [value] })).not.toThrow();
    }
  });
});
