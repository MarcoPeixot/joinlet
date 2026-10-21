import { describe, expect, it } from 'vitest';
import { awsInputs, terraformPlanText, terraformStateText } from '../../fixtures/cloud';
import { normalizeAws } from './aws';
import { importTerraformShow, parseTerraformShow } from './terraformShow';
import type { CloudGraph, CloudResource } from './types';
import { expectValid } from '../testkit';

function graphOf(text: string): CloudGraph {
  const parsed = parseTerraformShow(text);
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed.graph;
}
const state = graphOf(terraformStateText);
const A = '123456789012';
const named = (graph: CloudGraph, name: string): CloudResource => {
  const found = graph.resources.find((resource) => resource.name === name);
  if (!found) throw new Error(`recurso ${name} ausente`);
  return found;
};

describe('terraform show -json: state', () => {
  it('uses the same drift keys as the AWS CLI import (ARNs, also for resources Terraform knows by native id)', () => {
    const cli = new Set(normalizeAws(awsInputs()).resources.map((resource) => resource.id));
    for (const name of ['shop-vpc', 'shop-public-a', 'shop-web-1', 'shop-web-2', 'shop-igw', 'shop-nat-a', 'shop-alb', 'shop-web-tg', 'shop-db', 'shop-api-handler', 'shop-orders-worker', 'shop-assets-prod', 'shop-orders', 'shop-alerts', 'shop-carts', 'shop-http-api', 'shop-web-sg']) {
      expect(cli.has(named(state, name).id), name).toBe(true);
    }
    expect(named(state, 'shop-nat-a').id).toBe(`arn:aws:ec2:us-east-1:${A}:nat-gateway/nat-0123456789abcdef0`.replace('nat-gateway', 'natgateway'));
  });

  it('reads only the allowlisted values and names resources by their Name tag', () => {
    expect(named(state, 'shop-web-1').attrs).toEqual({ instanceType: 't3.medium', az: 'us-east-1a' });
    expect(named(state, 'shop-web-2').attrs.instanceType).toBe('t3.large');
    expect(named(state, 'shop-db').attrs).toEqual({ engine: 'postgres', engineVersion: '15.4', instanceClass: 'db.r6g.large', multiAz: true });
    expect(named(state, 'shop-alb').attrs).toEqual({ lbType: 'application', scheme: 'internet-facing' });
    expect(named(state, 'shop-public-a').attrs).toEqual({ cidr: '10.0.1.0/24', az: 'us-east-1a', public: true });
  });

  it('resolves placement and relations from the resolved ids', () => {
    expect(named(state, 'shop-web-1').net).toMatchObject({ subnets: [`arn:aws:ec2:us-east-1:${A}:subnet/subnet-0c33cccc3333cccc3`] });
    expect(named(state, 'shop-public-a').net).toEqual({ vpc: `arn:aws:ec2:us-east-1:${A}:vpc/vpc-0a1b2c3d4e5f60718` });
    expect(named(state, 'shop-web-1').links).toContain(named(state, 'shop-web-sg').id);
    expect(named(state, 'shop-api-handler').links).toContain(`arn:aws:dynamodb:us-east-1:${A}:table/shop-carts`.replace('shop-carts', 'shop-carts'));
  });

  it('turns listeners, attachments, event source mappings, subscriptions and integrations into links, not resources', () => {
    expect(named(state, 'shop-alb').links).toContain(named(state, 'shop-web-tg').id);
    expect(named(state, 'shop-web-tg').links).toEqual(expect.arrayContaining([named(state, 'shop-web-1').id, named(state, 'shop-web-2').id]));
    expect(named(state, 'shop-orders').links).toEqual([named(state, 'shop-orders-worker').id]);
    expect(named(state, 'shop-alerts').links).toEqual([named(state, 'shop-orders-worker').id]);
    expect(named(state, 'shop-http-api').links).toEqual([named(state, 'shop-api-handler').id]);
    expect(state.resources.some((r) => r.address?.includes('listener') || r.address?.includes('attachment') || r.address?.includes('subscription'))).toBe(false);
  });

  it('includes child modules, with indexes and labels from tags', () => {
    const extra = named(state, 'shop-private-c');
    expect(extra.address).toBe('module.net.aws_subnet.extra[0]');
    expect(extra.net?.vpc).toBeDefined();
  });

  it('keeps unknown noise types out of the drawing but still tracks them', () => {
    const role = state.resources.find((r) => r.address === 'aws_iam_role.worker');
    expect(role).toMatchObject({ show: false, type: 'aws:aws_iam_role' });
  });

  it('classifies Azure and GCP resources with the ids their CLIs report', () => {
    const vm = named(state, 'vm-web-01');
    expect(vm).toMatchObject({ provider: 'azure', scope: 'rg-shop-prod', region: 'westeurope', attrs: { size: 'Standard_D2s_v5' } });
    expect(vm.id).toBe('/subscriptions/00000000-1111-2222-3333-444444444444/resourcegroups/rg-shop-prod/providers/microsoft.compute/virtualmachines/vm-web-01');
    expect(named(state, 'shop-prod-assets').id).toBe('projects/_/buckets/shop-prod-assets');
    expect(named(state, 'web-1')).toMatchObject({ id: 'projects/shop-prod-123456/zones/us-central1-a/instances/web-1', attrs: { machineType: 'e2-medium', zone: 'us-central1-a' } });
  });

  it('leaves out credential resources, other providers and data sources, and says so', () => {
    const addresses = state.resources.map((r) => r.address);
    for (const address of ['tls_private_key.ca', 'random_password.db', 'aws_secretsmanager_secret_version.db', 'data.aws_caller_identity.current']) expect(addresses).not.toContain(address);
    expect(state.diagnostics.map((d) => d.message).join(' ')).toMatch(/3 recursos de outros provedores ou de credenciais/);
  });

  it('never carries a sensitive value: user data, passwords, environment, startup scripts', () => {
    expect(JSON.stringify(state)).not.toMatch(/SENTINEL|sk_live|shopadmin|ops-oncall|BEGIN RSA/);
  });
});

describe('terraform show -json: plan', () => {
  const plan = graphOf(terraformPlanText);

  it('reads planned_values, with tf:<address> ids where the real id is not known yet', () => {
    expect(plan.resources.map((r) => r.id)).toEqual(['tf:aws_db_instance.db', 'tf:aws_instance.app', 'tf:aws_subnet.a', 'tf:aws_vpc.main']);
    expect(plan.diagnostics[0]?.message).toMatch(/Plano do Terraform/);
  });

  it('derives placement and dependencies from the configuration references', () => {
    expect(named(plan, 'plan-subnet-a').net).toEqual({ vpc: 'tf:aws_vpc.main' });
    expect(named(plan, 'plan-app').net).toEqual({ subnets: ['tf:aws_subnet.a'] });
    expect(named(plan, 'plan-app').links).toEqual(['tf:aws_db_instance.db']);
  });

  it('does not leak planned secrets', () => {
    expect(JSON.stringify(plan)).not.toMatch(/SENTINEL/);
  });
});

describe('terraform show -json: input errors', () => {
  const message = (text: string) => {
    const parsed = parseTerraformShow(text);
    return 'error' in parsed ? parsed.error : '';
  };
  it('explains what is wrong in pt-BR', () => {
    expect(message('resource "a" "b" {}')).toMatch(/JSON válido/);
    expect(message('{"a":1}')).toMatch(/format_version/);
    expect(message('{"format_version":"1.0"}')).toMatch(/terraform apply/);
    expect(message('[]')).toMatch(/format_version/);
  });

  it('enforces the size cap', () => {
    const parsed = parseTerraformShow('{}'.padEnd(300, ' '), 200);
    expect('error' in parsed && parsed.error).toMatch(/grande demais/);
  });
});

describe('importTerraformShow (the web import)', () => {
  it('draws the state into a valid model', () => {
    const result = importTerraformShow(terraformStateText);
    expectValid(result);
    expect(result.model.elements['shop-web-1']?.parentId).toBe('shop-private-a');
    expect(result.model.edges.map((e) => `${e.from}>${e.to}`)).toContain('shop-alb>shop-web-1');
  });

  it('refuses text that is not terraform show output with a diagnostic, not an exception', () => {
    const result = importTerraformShow('nope');
    expect(result.model.order).toEqual([]);
    expect(result.diagnostics[0]?.message).toMatch(/JSON válido/);
  });
});
