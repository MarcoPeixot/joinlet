import { describe, expect, it } from 'vitest';
import { azureListingJson } from '../../fixtures/cloud';
import { normalizeAzure } from './azure';

const graph = normalizeAzure(azureListingJson, { subscription: 'sub' });
const byName = (name: string) => graph.resources.find((r) => r.name === name);

describe('Azure normalizer', () => {
  it('uses the lowercase resource id as the drift key and the resource group as scope', () => {
    const vm = byName('vm-web-01')!;
    expect(vm.id).toBe('/subscriptions/00000000-1111-2222-3333-444444444444/resourcegroups/rg-shop-prod/providers/microsoft.compute/virtualmachines/vm-web-01');
    expect(vm).toMatchObject({ type: 'azure:compute:virtual-machine', scope: 'rg-shop-prod', region: 'westeurope', show: true, provider: 'azure' });
  });

  it('keeps unknown ARM types as generic resources and hides structural ones', () => {
    expect(byName('appi-shop')?.type).toBe('azure:microsoft.insights/components');
    expect(byName('nic-web-01')?.show).toBe(false);
    expect(byName('nsg-web')?.show).toBe(false);
  });

  it('links a server to its databases through the id path, and a disk to the VM that manages it', () => {
    expect(byName('sql-shop-prod')!.links).toEqual([byName('shopdb')!.id]);
    expect(byName('vm-web-01')!.links).toEqual([byName('vm-web-01_OsDisk_1_abc')!.id, byName('nic-web-01')!.id].sort());
  });

  it('omits extensions, role assignments, system databases and Key Vault secrets, and says so', () => {
    expect(byName('OmsAgent')).toBeUndefined();
    expect(byName('ra-1')).toBeUndefined();
    expect(byName('master')).toBeUndefined();
    expect(byName('db-password')).toBeUndefined();
    expect(graph.diagnostics.map((d) => d.message).join(' ')).toMatch(/4 recursos/);
  });

  it('reads only sku and kind: tags, identity and properties never reach the graph', () => {
    expect(byName('stshopdata001')!.attrs).toEqual({ sku: 'Standard_GRS', kind: 'StorageV2' });
    expect(JSON.stringify(graph)).not.toMatch(/AccountKey|SENTINEL|principalId/);
  });

  it('survives hostile input', () => {
    for (const value of [null, 3, 'x', {}, [null, 1, { id: 5 }, { id: '/a', type: 'T' }, { id: '__proto__', type: '__proto__' }, { id: '/x/providers/a/b/c/d/e', type: 'a/b', managedBy: 7, sku: 'str' }]]) {
      expect(() => normalizeAzure(value)).not.toThrow();
    }
  });
});
