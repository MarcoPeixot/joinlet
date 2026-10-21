import { describe, expect, it } from 'vitest';
import { awsInputs, terraformStateText } from '../../fixtures/cloud';
import { normalizeAws } from './aws';
import { graphToModel } from './graph';
import { CLOUD_STATE_PATH, compareCloud, emptyCloudState, parseCloudState, printCloudState, trackResources, withSource } from './state';
import type { CloudSource } from './state';
import { parseTerraformShow } from './terraformShow';
import type { CloudGraph } from './types';

const live = normalizeAws(awsInputs());
const drawn = graphToModel(live);
const source: CloudSource = { diagram: 'aws-us-east-1', origin: 'aws', scope: { region: 'us-east-1' }, resources: trackResources(live, drawn.nodes) };
const clone = (graph: CloudGraph, edit: (graph: CloudGraph) => void): CloudGraph => {
  const copy = structuredClone(graph);
  edit(copy);
  return copy;
};

describe('cloud.json', () => {
  it('lives at .arch/cloud.json', () => {
    expect(CLOUD_STATE_PATH).toBe('cloud.json');
  });

  it('records the element each resource was drawn as, and tracks undrawn ones without a node', () => {
    const web = source.resources.find((r) => r.name === 'shop-web-1')!;
    expect(web.node).toBe('shop-web-1');
    const sg = source.resources.find((r) => r.name === 'shop-web-sg')!;
    expect(sg.node).toBeUndefined();
  });

  it('prints byte-stable JSON and reads it back unchanged', () => {
    const state = withSource(emptyCloudState(), source);
    const text = printCloudState(state);
    expect(text.endsWith('\n')).toBe(true);
    expect(printCloudState(parseCloudState(text).state)).toBe(text);
    expect(parseCloudState(text).errors).toEqual([]);
  });

  it('never stores a profile, credentials or attribute values that look secret', () => {
    const text = printCloudState(withSource(emptyCloudState(), source));
    expect(text).not.toMatch(/profile|SENTINEL|hunter2|sk_live/i);
    const parsed = parseCloudState(JSON.stringify({ version: 1, sources: [{ diagram: 'a', origin: 'aws', scope: { profile: 'prod-admin', region: 'us-east-1' }, resources: [{ id: 'x', type: 't', attrs: { password: 'p', ok: 'fine', token: 'AKIAIOSFODNN7EXAMPLE', long: 'A'.repeat(200) } }] }] }));
    expect(parsed.state.sources[0]!.scope).toEqual({ region: 'us-east-1' });
    expect(parsed.state.sources[0]!.resources[0]!.attrs).toEqual({ ok: 'fine' });
  });

  it('replaces the source of the same diagram and keeps sources ordered', () => {
    const second = { ...source, diagram: 'a-first' };
    const state = withSource(withSource(emptyCloudState(), source), second);
    expect(state.sources.map((s) => s.diagram)).toEqual(['a-first', 'aws-us-east-1']);
    expect(withSource(state, { ...source, resources: [] }).sources[1]!.resources).toEqual([]);
  });

  it('reads leniently: damage becomes a message, never an exception', () => {
    expect(parseCloudState(null)).toEqual({ state: emptyCloudState(), errors: [] });
    expect(parseCloudState('{').errors[0]).toMatch(/JSON válido/);
    expect(parseCloudState('{"version":2}').errors[0]).toMatch(/versão/);
    const mixed = parseCloudState(JSON.stringify({ version: 1, sources: [{ diagram: 'ok', origin: 'gcp', resources: [{ id: '__proto__', type: 't' }, { id: 'a', type: 't' }, 5] }, { origin: 'aws' }, { diagram: 'x', origin: 'nope' }] }));
    expect(mixed.state.sources.map((s) => s.diagram)).toEqual(['ok']);
    expect(mixed.state.sources[0]!.resources.map((r) => r.id)).toEqual(['a']);
    expect(mixed.errors).toHaveLength(2);
  });
});

describe('compareCloud', () => {
  it('finds no drift when nothing changed', () => {
    expect(compareCloud(source, live)).toEqual([]);
  });

  it('reports a resource added in the cloud', () => {
    const grown = clone(live, (g) => g.resources.push({ id: 'arn:aws:sqs:us-east-1:123456789012:new-queue', provider: 'aws', type: 'aws:sqs:queue', name: 'new-queue', region: 'us-east-1', show: true, attrs: {}, links: [] }));
    const findings = compareCloud(source, grown);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'added', diagram: 'aws-us-east-1', id: 'arn:aws:sqs:us-east-1:123456789012:new-queue' });
    expect(findings[0]!.message).toBe('adicionado na nuvem e ausente do diagrama "aws-us-east-1": aws:sqs:queue new-queue (arn:aws:sqs:us-east-1:123456789012:new-queue)');
  });

  it('reports a resource removed from the cloud', () => {
    const shrunk = clone(live, (g) => { g.resources = g.resources.filter((r) => r.name !== 'shop-db'); });
    const findings = compareCloud(source, shrunk);
    expect(findings.map((f) => f.kind)).toEqual(['removed']);
    expect(findings[0]!.message).toContain('removido da nuvem, ainda no diagrama "aws-us-east-1": aws:rds:instance shop-db');
  });

  it('reports changed attributes with before and after', () => {
    const changed = clone(live, (g) => { g.resources.find((r) => r.name === 'shop-web-1')!.attrs.instanceType = 'm5.xlarge'; });
    const findings = compareCloud(source, changed);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'changed' });
    expect(findings[0]!.message).toContain('instanceType: t3.medium → m5.xlarge');
  });

  it('reports changed relations by count', () => {
    const rewired = clone(live, (g) => { g.resources.find((r) => r.name === 'shop-orders')!.links = []; });
    const [finding] = compareCloud(source, rewired);
    expect(finding!.message).toContain('relações: +0 −1');
  });

  it('leaves out resources a person removed from the diagram on purpose', () => {
    const curated = new Set([source.resources.find((r) => r.name === 'shop-db')!.id]);
    const shrunk = clone(live, (g) => { g.resources = g.resources.filter((r) => r.name !== 'shop-db'); });
    expect(compareCloud(source, shrunk, curated)).toEqual([]);
  });

  it('only compares what the source was scoped to: another region or provider is not drift', () => {
    const noise = clone(live, (g) => {
      g.resources.push({ id: 'arn:aws:sqs:eu-west-1:123456789012:other', provider: 'aws', type: 'aws:sqs:queue', name: 'other', region: 'eu-west-1', show: true, attrs: {}, links: [] });
      g.resources.push({ id: '/subscriptions/x', provider: 'azure', type: 'azure:compute:disk', name: 'disk', show: true, attrs: {}, links: [] });
    });
    expect(compareCloud(source, noise)).toEqual([]);
  });

  it('is stable and bounded: findings come sorted, and a flood is truncated with a note', () => {
    const flood = clone(live, (g) => {
      for (let i = 0; i < 700; i += 1) g.resources.push({ id: `arn:aws:sqs:us-east-1:123456789012:q${String(i).padStart(4, '0')}`, provider: 'aws', type: 'aws:sqs:queue', name: `q${i}`, region: 'us-east-1', show: true, attrs: {}, links: [] });
    });
    const findings = compareCloud(source, flood);
    expect(findings).toHaveLength(501);
    expect(findings.at(-1)).toMatchObject({ kind: 'truncated' });
    expect(findings.slice(0, 2).map((f) => f.id)).toEqual(['arn:aws:sqs:us-east-1:123456789012:q0000', 'arn:aws:sqs:us-east-1:123456789012:q0001']);
  });

  describe('a Terraform file against a CLI import', () => {
    const tf = (() => { const parsed = parseTerraformShow(terraformStateText); if ('error' in parsed) throw new Error(parsed.error); return parsed.graph; })();
    const findings = compareCloud(source, tf);
    const kinds = (kind: string) => findings.filter((f) => f.kind === kind);

    it('compares only kinds both sides know, on the attributes both carry', () => {
      const changed = kinds('changed');
      expect(changed.map((f) => f.message)).toEqual([expect.stringContaining('shop-web-2')]);
      expect(changed[0]!.message).toContain('instanceType: t3.medium → t3.large');
    });

    it('finds what Terraform has and the diagram lacks, and the other way round', () => {
      expect(kinds('added').map((f) => f.message).join('\n')).toMatch(/shop-batch/);
      expect(kinds('removed').map((f) => f.type)).toEqual(expect.arrayContaining(['aws:s3:bucket', 'aws:sqs:queue']));
    });

    it('ignores relations (each origin derives them from different data)', () => {
      expect(findings.some((f) => f.message.includes('relações'))).toBe(false);
    });
  });
});
