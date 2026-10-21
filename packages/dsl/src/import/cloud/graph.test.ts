import { CLOUD_ICONS } from '@strukt/core/cloud';
import { printDiagramJson } from '@strukt/json';
import { describe, expect, it } from 'vitest';
import { awsInputs, azureListingJson, gcpListingJson } from '../../fixtures/cloud';
import { normalizeAws } from './aws';
import { normalizeAzure } from './azure';
import { normalizeGcp } from './gcp';
import { graphToModel } from './graph';
import { KINDS, PROVIDER_ICON } from './kinds';
import { expectValid } from '../testkit';

const aws = graphToModel(normalizeAws(awsInputs()));
const { model } = aws.result;
const parent = (id: string) => model.elements[id]?.parentId;

describe('graphToModel: AWS', () => {
  it('nests region > VPC > subnet and puts each resource where it lives', () => {
    expect(model.elements['us-east-1']?.kind).toBe('group');
    expect(parent('shop-vpc')).toBe('us-east-1');
    expect(parent('shop-private-a')).toBe('shop-vpc');
    expect(parent('shop-web-1')).toBe('shop-private-a');
    expect(parent('shop-web-2')).toBe('shop-private-b');
    expect(parent('shop-nat-a')).toBe('shop-public-a');
    expect(parent('shop-alb')).toBe('shop-vpc');
    expect(parent('shop-db')).toBe('shop-vpc');
    expect(parent('shop-carts')).toBe('us-east-1');
    expect(parent('shop-orders-worker')).toBe('shop-vpc');
    expect(parent('shop-api-handler')).toBe('us-east-1');
  });

  it('draws icon tiles with the kind as tech and a one-line summary', () => {
    expect(model.elements['shop-web-1']).toMatchObject({ presentation: 'icon', tech: 'EC2', description: 't3.medium · us-east-1a · running', icon: 'aws:resource-amazon-ec2-instance' });
    expect(model.elements['shop-db']).toMatchObject({ shape: 'cylinder', tech: 'RDS' });
    expect(model.elements['shop-public-a']?.icon).toBe('aws:group-public-subnet');
    expect(model.elements['shop-private-a']?.icon).toBe('aws:group-private-subnet');
  });

  it('does not draw security groups or target groups', () => {
    expect(model.elements['shop-web-sg']).toBeUndefined();
    expect(model.elements['shop-web-tg']).toBeUndefined();
  });

  it('connects the load balancer straight to what it routes to, and triggers to their functions', () => {
    const pairs = model.edges.map((edge) => `${edge.from}>${edge.to}`);
    for (const pair of ['shop-alb>shop-web-1', 'shop-alb>shop-web-2', 'shop-alb>shop-checkout', 'shop-alb>shop-api-handler', 'shop-orders>shop-orders-worker', 'shop-alerts>shop-orders-worker', 'shop-http-api>shop-api-handler', 'shop-cluster>shop-checkout']) {
      expect(pairs, pair).toContain(pair);
    }
  });

  it('maps every drawn resource to its element, groups included', () => {
    for (const [resource, element] of aws.nodes) expect(model.elements[element], resource).toBeDefined();
    expect(aws.nodes.get('arn:aws:ec2:us-east-1:123456789012:instance/i-0123456789abcdef0')).toBe('shop-web-1');
  });

  it('prints canonical JSON that parses back without errors', () => {
    expectValid(aws.result);
    expect(printDiagramJson(model)).toBe(printDiagramJson(graphToModel(normalizeAws(awsInputs())).result.model));
  });

  it('makes duplicate names unique instead of merging two resources', () => {
    const inputs = awsInputs();
    const twin = graphToModel(normalizeAws({ ...inputs, queues: { QueueUrls: ['https://sqs.us-east-1.amazonaws.com/123456789012/shop-orders'] }, topics: { Topics: [{ TopicArn: 'arn:aws:sns:us-east-1:123456789012:shop-orders' }] } }));
    expect(Object.keys(twin.result.model.elements).filter((id) => id.startsWith('shop-orders'))).toEqual(expect.arrayContaining(['shop-orders', 'shop-orders (2)']));
  });
});

describe('graphToModel: icons', () => {
  const catalog = new Set(CLOUD_ICONS.map((icon) => icon.name));

  it('only uses icon ids that exist in the cloud catalog', () => {
    const missing = KINDS.filter((kind) => !catalog.has(kind.icon)).map((kind) => `${kind.type} → ${kind.icon}`);
    expect(missing).toEqual([]);
    for (const id of ['aws:group-region', 'aws:group-public-subnet', 'azure:resource-groups', 'gcp:project']) expect(catalog.has(id), id).toBe(true);
  });

  it('falls back to the provider mark when the catalog does not know an id', () => {
    const result = graphToModel(normalizeAws(awsInputs()), { hasIcon: () => false }).result.model;
    expect(result.elements['shop-web-1']?.icon).toBe(PROVIDER_ICON.aws);
    expect(result.elements['us-east-1']?.icon).toBe(PROVIDER_ICON.aws);
  });

  it('keeps catalog ids when the predicate accepts them', () => {
    const result = graphToModel(normalizeAws(awsInputs()), { hasIcon: (id) => catalog.has(id) }).result.model;
    expect(result.elements['shop-web-1']?.icon).toBe('aws:resource-amazon-ec2-instance');
  });
});

describe('graphToModel: Azure and GCP', () => {
  it('groups Azure resources by resource group and shows the location', () => {
    const { model: azure } = graphToModel(normalizeAzure(azureListingJson)).result;
    expect(azure.elements['rg-shop-prod']?.kind).toBe('group');
    expect(azure.elements['vm-web-01']).toMatchObject({ parentId: 'rg-shop-prod', tech: 'Máquina virtual', icon: 'azure:virtual-machine', description: 'westeurope' });
    expect(azure.elements.stshopdata001).toMatchObject({ parentId: 'rg-shop-data', shape: 'cylinder' });
    expect(azure.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['sql-shop-prod>shopdb']);
    expect(azure.elements['nic-web-01']).toBeUndefined();
  });

  it('groups GCP resources by project and uses a generic mark for kinds it does not know', () => {
    const { model: gcp } = graphToModel(normalizeGcp(gcpListingJson, { project: 'shop-prod-123456' })).result;
    expect(gcp.elements['shop-prod-123456']?.kind).toBe('group');
    expect(gcp.elements['web-1']).toMatchObject({ parentId: 'shop-prod-123456', icon: 'gcp:compute-engine' });
    expect(gcp.elements['shop-prod-assets']?.parentId).toBe('shop-prod-123456');
    expect(gcp.elements['shop-cache']).toMatchObject({ icon: 'gcp', tech: 'instance' });
    expect(gcp.elements['allow-http']).toBeUndefined();
  });
});
