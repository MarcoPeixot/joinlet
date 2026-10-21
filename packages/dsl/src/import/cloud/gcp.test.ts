import { describe, expect, it } from 'vitest';
import { gcpListingJson } from '../../fixtures/cloud';
import { normalizeGcp } from './gcp';

const graph = normalizeGcp(gcpListingJson, { project: 'fallback-project' });
const byName = (name: string, type?: string) => graph.resources.find((r) => r.name === name && (!type || r.type === type));

describe('GCP normalizer', () => {
  it('keys resources by their canonical name, without the //service.googleapis.com/ prefix', () => {
    expect(byName('web-1', 'gcp:compute:instance')!.id).toBe('projects/shop-prod-123456/zones/us-central1-a/instances/web-1');
    expect(byName('web-1', 'gcp:compute:instance')).toMatchObject({ type: 'gcp:compute:instance', scope: 'shop-prod-123456', region: 'us-central1', attrs: { state: 'RUNNING' } });
  });

  it('gives buckets their canonical projects/_/buckets name and the fallback project', () => {
    expect(byName('shop-prod-assets')).toMatchObject({ id: 'projects/_/buckets/shop-prod-assets', scope: 'fallback-project', type: 'gcp:storage:bucket', region: 'us' });
  });

  it('keeps unknown asset types generic and hides firewalls, disks and subnetworks', () => {
    expect(byName('shop-cache')).toMatchObject({ type: 'gcp:redis.googleapis.com/instance', show: true });
    expect(byName('allow-http')?.show).toBe(false);
    expect(byName('shop-subnet')?.show).toBe(false);
  });

  it('omits secrets, service accounts, routes and API enablement, and says so', () => {
    for (const name of ['db-password', 'sa', 'default-route', 'compute.googleapis.com']) expect(byName(name), name).toBeUndefined();
    expect(graph.diagnostics[0]?.message).toMatch(/4 recursos/);
  });

  it('never reads labels, IP addresses or network tags', () => {
    expect(JSON.stringify(graph)).not.toMatch(/SENTINEL|203\.0\.113|10\.128|http-server/);
  });

  it('survives hostile input', () => {
    for (const value of [null, 3, {}, [null, { name: 1 }, { name: '__proto__', assetType: 'x' }, { name: '//a.googleapis.com/x', assetType: 'a/B', location: 5 }]]) {
      expect(() => normalizeGcp(value)).not.toThrow();
    }
  });
});
