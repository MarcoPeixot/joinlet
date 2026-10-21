import { describe, expect, it } from 'vitest';
import { normalizeAws } from './aws';
import { normalizeAzure } from './azure';
import { normalizeGcp } from './gcp';
import { graphToModel } from './graph';
import { compareCloud, parseCloudState, trackResources } from './state';
import { MAX_TERRAFORM_JSON, importTerraformShow, parseTerraformShow } from './terraformShow';
import type { CloudGraph } from './types';

/**
 * Cloud importers read untrusted JSON (CLI output, repo files). Like the HCL/K8s importers they must be total and
 * near-linear: each case builds a large hostile input and bounds the wall-clock time far below what a quadratic
 * implementation would need.
 */
const LIMIT_MS = 4000;
function timed<T>(fn: () => T, limit = LIMIT_MS): T {
  const start = performance.now();
  const value = fn();
  const took = performance.now() - start;
  expect(took, `took ${took.toFixed(0)} ms`).toBeLessThan(limit);
  return value;
}
const show = (resources: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ format_version: '1.0', values: { root_module: { resources, ...extra } } });
const instance = (i: number, values: Record<string, unknown> = {}) => ({ address: `aws_instance.i${i}`, mode: 'managed', type: 'aws_instance', name: `i${i}`, values: { id: `i-${i}`, arn: `arn:aws:ec2:us-east-1:123456789012:instance/i-${i}`, instance_type: 't3.micro', ...values } });

describe('terraform show -json is total and linear', () => {
  it('30,000 instances (several MB)', () => {
    const text = show(Array.from({ length: 30_000 }, (_, i) => instance(i)));
    expect(text.length).toBeGreaterThan(5_000_000);
    const parsed = timed(() => parseTerraformShow(text));
    expect('graph' in parsed && parsed.graph.resources.length).toBe(5000);
    expect('graph' in parsed && parsed.graph.diagnostics.map((d) => d.message).join(' ')).toMatch(/Limite de 5000/);
  });

  it('every resource referencing every other id (dense references)', () => {
    const ids = Array.from({ length: 800 }, (_, i) => `i-${i}`);
    const text = show(Array.from({ length: 800 }, (_, i) => instance(i, { vpc_security_group_ids: ids })));
    const parsed = timed(() => parseTerraformShow(text));
    expect('graph' in parsed).toBe(true);
  });

  it('10,000 attachments onto one target group, and a load balancer for each of 1,000 listeners', () => {
    const tg = 'arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/t/1';
    const resources: unknown[] = [{ address: 'aws_lb_target_group.t', mode: 'managed', type: 'aws_lb_target_group', name: 't', values: { id: tg, arn: tg } }];
    for (let i = 0; i < 1000; i += 1) {
      const lb = `arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/l${i}/1`;
      resources.push({ address: `aws_lb.l${i}`, mode: 'managed', type: 'aws_lb', name: `l${i}`, values: { id: lb, arn: lb } });
      resources.push({ address: `aws_lb_listener.l${i}`, mode: 'managed', type: 'aws_lb_listener', name: `l${i}`, values: { id: `${lb}/x`, load_balancer_arn: lb, default_action: [{ target_group_arn: tg }] } });
    }
    for (let i = 0; i < 3000; i += 1) {
      resources.push(instance(i));
      resources.push({ address: `aws_lb_target_group_attachment.a${i}`, mode: 'managed', type: 'aws_lb_target_group_attachment', name: `a${i}`, values: { target_group_arn: tg, target_id: `i-${i}` } });
    }
    const graph = timed(() => (parseTerraformShow(show(resources)) as { graph: CloudGraph }).graph);
    timed(() => graphToModel(graph));
  });

  it('module trees 5,000 levels deep are cut at 25 with a diagnostic', () => {
    const depth = 5000;
    const text = `{"format_version":"1.0","values":{"root_module":${'{"resources":[],"child_modules":['.repeat(depth)}{"resources":[${JSON.stringify(instance(1))}]}${']}'.repeat(depth)}}}`;
    const parsed = timed(() => parseTerraformShow(text));
    expect('graph' in parsed && parsed.graph.diagnostics.map((d) => d.message).join(' ')).toMatch(/Módulos aninhados demais/);
  });

  it('2,000 sibling modules', () => {
    const modules = Array.from({ length: 2000 }, (_, i) => ({ address: `module.m${i}`, resources: [instance(i)] }));
    expect(timed(() => parseTerraformShow(show([], { child_modules: modules }))).hasOwnProperty('graph')).toBe(true);
  });

  it('one resource with a 1.9 MB string, a 100,000-item array and a 500-level object', () => {
    let nested: unknown = 'leaf';
    for (let i = 0; i < 500; i += 1) nested = { a: nested };
    const text = show([instance(1, { big: 'x'.repeat(1_900_000), list: Array.from({ length: 100_000 }, (_, i) => `v${i}`), nested })]);
    expect('graph' in timed(() => parseTerraformShow(text))).toBe(true);
  });

  it('plan configuration with 20,000 resources and long reference lists', () => {
    const config = Array.from({ length: 20_000 }, (_, i) => ({ address: `aws_instance.i${i}`, expressions: { x: { references: Array.from({ length: 20 }, (_, k) => `aws_instance.i${(i + k) % 20_000}.id`) } } }));
    const text = JSON.stringify({ format_version: '1.0', planned_values: { root_module: { resources: Array.from({ length: 4000 }, (_, i) => instance(i)) } }, configuration: { root_module: { resources: config } } });
    expect('graph' in timed(() => parseTerraformShow(text))).toBe(true);
  });

  it('hostile names (__proto__, constructor) are ordinary data', () => {
    const text = show([
      { address: '__proto__.x', mode: 'managed', type: 'aws___proto__', name: '__proto__', values: { id: '__proto__', arn: 'constructor', name: '__proto__', tags: { Name: '__proto__' } } },
      { address: 'aws_instance.constructor', mode: 'managed', type: 'aws_instance', name: 'constructor', values: { id: 'toString', ref: '__proto__' } },
    ]);
    const result = importTerraformShow(text);
    expect(Object.getPrototypeOf(result.model.elements)).toBe(Object.prototype);
    expect(Object.hasOwn(result.model.elements, '__proto__')).toBe(false);
  });

  it('input over the cap is refused outright', () => {
    expect('error' in parseTerraformShow(' '.repeat(MAX_TERRAFORM_JSON + 1))).toBe(true);
    expect(importTerraformShow(' '.repeat(2_100_000)).diagnostics[0]?.message).toMatch(/grande demais/);
  });
});

describe('CLI normalizers are total and linear', () => {
  it('AWS: 100,000 reservations and instances are capped', () => {
    const reservation = { OwnerId: '123456789012', Instances: [{ InstanceId: 'i-0', InstanceType: 't3.micro', State: { Name: 'running' } }] };
    const huge = { Reservations: Array.from({ length: 100_000 }, () => reservation) };
    const graph = timed(() => normalizeAws({ region: 'us-east-1', instances: huge }));
    expect(graph.resources.length).toBeLessThanOrEqual(1);
  });

  it('AWS: 5,000 distinct instances and subnets drawn into a model', () => {
    const instances = { Reservations: [{ Instances: Array.from({ length: 1000 }, (_, i) => ({ InstanceId: `i-${i}`, SubnetId: `subnet-${i % 40}`, VpcId: 'vpc-1', State: { Name: 'running' } })) }] };
    const subnets = { Subnets: Array.from({ length: 40 }, (_, i) => ({ SubnetId: `subnet-${i}`, VpcId: 'vpc-1' })) };
    const graph = timed(() => normalizeAws({ region: 'us-east-1', account: '123456789012', instances, subnets, vpcs: { Vpcs: [{ VpcId: 'vpc-1' }] } }));
    timed(() => graphToModel(graph));
  });

  it('Azure and GCP: 1.9 MB listings of distinct resources', () => {
    const azure = Array.from({ length: 12_000 }, (_, i) => ({ id: `/subscriptions/s/resourceGroups/g${i % 50}/providers/Microsoft.Compute/virtualMachines/vm${i}`, type: 'Microsoft.Compute/virtualMachines', name: `vm${i}`, location: 'westeurope', resourceGroup: `g${i % 50}` }));
    const gcp = Array.from({ length: 12_000 }, (_, i) => ({ name: `//compute.googleapis.com/projects/proj-${i % 50}-abcde/zones/us-central1-a/instances/vm${i}`, assetType: 'compute.googleapis.com/Instance', location: 'us-central1-a' }));
    timed(() => graphToModel(normalizeAzure(azure)));
    timed(() => graphToModel(normalizeGcp(gcp)));
  });

  it('a single huge string where a name or id is expected', () => {
    const big = 'x'.repeat(1_900_000);
    timed(() => normalizeAws({ region: 'us-east-1', instances: { Reservations: [{ Instances: [{ InstanceId: big, InstanceType: big, State: { Name: 'running' } }] }] }, lambdaFunctions: { Functions: [{ FunctionArn: big, FunctionName: big }] } }));
    timed(() => normalizeAzure([{ id: big, type: big, name: big }]));
    timed(() => normalizeGcp([{ name: `//storage.googleapis.com/${big}`, assetType: big }, { name: `https://x.googleapis.com/${'a/'.repeat(500_000)}`, assetType: 'a/B' }]));
  });
});

describe('cloud.json and drift are total and linear', () => {
  it('20,000 tracked resources against 20,000 live ones', () => {
    const resources = Array.from({ length: 20_000 }, (_, i) => ({ id: `arn:aws:sqs:us-east-1:123456789012:q${i}`, provider: 'aws' as const, type: 'aws:sqs:queue', name: `q${i}`, show: true, attrs: { fifo: i % 2 === 0 }, links: i > 0 ? [`arn:aws:sqs:us-east-1:123456789012:q${i - 1}`] : [] }));
    const graph: CloudGraph = { origin: 'aws', scope: {}, resources, diagnostics: [] };
    const source = { diagram: 'd', origin: 'aws' as const, scope: {}, resources: trackResources(graph, new Map()) };
    const moved = { ...graph, resources: resources.map((r, i) => (i % 3 === 0 ? { ...r, attrs: { fifo: !r.attrs.fifo } } : r)) };
    const findings = timed(() => compareCloud(source, moved));
    expect(findings.at(-1)?.kind).toBe('truncated');
  });

  it('hostile cloud.json text', () => {
    for (const text of ['{', '[]', 'null', '{"version":1,"sources":"x"}', `{"version":1,"sources":[${'{"diagram":"a","origin":"aws","resources":[{"id":"x","type":"t"}]},'.repeat(5000)}{}]}`, '{"version":1,"sources":[{"diagram":"a","origin":"aws","resources":[{"id":"x","type":"t","attrs":{"__proto__":"x","constructor":"y"},"links":[1,null,"z"]}]}]}']) {
      timed(() => parseCloudState(text), 1500);
    }
    const parsed = parseCloudState('{"version":1,"sources":[{"diagram":"a","origin":"aws","resources":[{"id":"x","type":"t","attrs":{"constructor":"y"}}]}]}');
    expect(parsed.state.sources[0]!.resources[0]!.attrs).toEqual({ constructor: 'y' });
  });
});
