import { printDiagramJson } from '@strukt/json';
import { describe, expect, it } from 'vitest';
import { SECRET_SENTINELS, awsInputs, azureListingJson, gcpListingJson, terraformPlanText, terraformStateText } from '../../fixtures/cloud';
import { normalizeAws } from './aws';
import { normalizeAzure } from './azure';
import { normalizeGcp } from './gcp';
import { graphToModel } from './graph';
import { looksSecret, safeName, safeValue, setAttr } from './safe';
import { emptyCloudState, printCloudState, trackResources, withSource } from './state';
import { parseTerraformShow } from './terraformShow';
import type { CloudGraph } from './types';

const INJECTED = 'SENTINEL-INJECTED-9a8b7c';
const HOSTILE_KEYS = ['Environment', 'Variables', 'UserData', 'user_data', 'Password', 'MasterUserPassword', 'Policy', 'SecretString', 'secret_string', 'Tags', 'tags', 'Description', 'Name', 'Endpoint', 'additionalAttributes', 'labels', 'properties', 'metadata_startup_script', 'private_key_pem'];

/** Every object of a document gets credential-shaped extra fields: whatever the normalizers read, none of it may surface. */
function poison(value: unknown, depth = 0): unknown {
  if (depth > 12) return value;
  if (Array.isArray(value)) return value.map((item) => poison(item, depth + 1));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) out[key] = poison(child, depth + 1);
  for (const key of HOSTILE_KEYS) if (!Object.hasOwn(out, key)) out[key] = INJECTED;
  return out;
}

function everything(graph: CloudGraph): string {
  const drawn = graphToModel(graph);
  return [JSON.stringify(graph), printDiagramJson(drawn.result.model), JSON.stringify(drawn.result.diagnostics), printCloudState(withSource(emptyCloudState(), { diagram: 'd', origin: graph.origin, scope: graph.scope, resources: trackResources(graph, drawn.nodes) }))].join('\n');
}

describe('no secret ever leaves an import', () => {
  const graphs: [string, CloudGraph][] = [
    ['aws', normalizeAws(awsInputs())],
    ['azure', normalizeAzure(azureListingJson)],
    ['gcp', normalizeGcp(gcpListingJson, { project: 'p' })],
    ['terraform state', (parseTerraformShow(terraformStateText) as { graph: CloudGraph }).graph],
    ['terraform plan', (parseTerraformShow(terraformPlanText) as { graph: CloudGraph }).graph],
  ];
  for (const [name, graph] of graphs) {
    it(`${name}: graph, diagram, diagnostics and cloud.json carry none of the fixture's sentinels`, () => {
      const text = everything(graph);
      for (const sentinel of SECRET_SENTINELS) expect(text, sentinel).not.toContain(sentinel);
    });
  }

  it('credential-shaped fields injected into every object of every input never surface', () => {
    const inputs = poison(awsInputs()) as ReturnType<typeof awsInputs>;
    const poisoned: CloudGraph[] = [
      normalizeAws(inputs),
      normalizeAzure(poison(azureListingJson)),
      normalizeGcp(poison(gcpListingJson), { project: 'p' }),
      (parseTerraformShow(JSON.stringify(poison(JSON.parse(terraformStateText)))) as { graph: CloudGraph }).graph,
      (parseTerraformShow(JSON.stringify(poison(JSON.parse(terraformPlanText)))) as { graph: CloudGraph }).graph,
    ];
    for (const graph of poisoned) {
      expect(graph.resources.length).toBeGreaterThan(0);
      expect(everything(graph)).not.toContain(INJECTED);
    }
  });
});

describe('safe values', () => {
  it('drops credential-shaped strings and keeps ordinary ones', () => {
    for (const secret of ['AKIAIOSFODNN7EXAMPLE', '-----BEGIN PRIVATE KEY-----', 'password=hunter2', 'token: abc', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig', 'A'.repeat(60), 'x'.repeat(161)]) {
      expect(safeValue(secret), secret).toBeUndefined();
    }
    for (const fine of ['t3.medium', 'us-east-1a', 'aurora-postgresql', 'db.r6g.large', 'prod-shop-orders-worker-queue-processor-v2']) expect(safeValue(fine)).toBe(fine);
    expect(safeValue(5)).toBe(5);
    expect(safeValue(true)).toBe(true);
    expect(safeValue(NaN)).toBeUndefined();
    expect(safeValue({})).toBeUndefined();
    expect(looksSecret('plain text')).toBe(false);
  });

  it('refuses attribute names that smell like secrets and the reserved name', () => {
    const attrs: Record<string, string | number | boolean> = {};
    for (const key of ['password', 'apiKey', 'userData', 'environment', 'secretValue', 'policy', 'certificateBody', '__proto__']) setAttr(attrs, key, 'ok');
    setAttr(attrs, 'engine', 'postgres');
    expect(attrs).toEqual({ engine: 'postgres' });
    expect(Object.getPrototypeOf(attrs)).toBe(Object.prototype);
  });

  it('refuses names that look like credentials', () => {
    expect(safeName('AKIAIOSFODNN7EXAMPLE')).toBeUndefined();
    expect(safeName('shop-web-1')).toBe('shop-web-1');
    expect(safeName(5)).toBeUndefined();
  });
});
