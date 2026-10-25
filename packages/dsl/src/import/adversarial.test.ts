import { describe, expect, it } from 'vitest';
import { measured } from '../../../../scripts/performance';
import { detectImportFormat, importArchitecture } from '../import';
import { importD2 } from './d2';
import { importKubernetes, k8sProbe } from './k8s';
import { importOpenApi } from './openapi';
import { importTerraform } from './terraform';
import type { ImportResult } from './common';

/**
 * Importers and the sniffer take untrusted text (and the sniffer runs on every keystroke): they must be total and
 * near-linear. Each case builds an input just under the 2 MB cap and asserts a generous wall-clock bound that a
 * quadratic implementation blows through by orders of magnitude.
 */
const BIG = 1_900_000;
const MEDIUM = 200_000;
const BIG_MS = 1500;
const MEDIUM_MS = 300;

const rep = (unit: string, bytes: number): string => unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
const binary = (bytes: number): string => {
  let seed = 12345;
  let out = '';
  for (let i = 0; i < bytes; i += 1) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; out += String.fromCharCode(seed % 256); }
  return out;
};

function timed<T>(fn: () => T, limit: number): T {
  return measured(fn, limit);
}

const whitespace: [string, string][] = [['newlines', '\n'], ['spaces', ' '], ['mixed whitespace', '\n\t ']];
const runs: [string, string][] = [
  ...whitespace, ['"model {" lines', 'model {\n'], ['edge lines', 'a -> b\n'], ['open braces', '{'], ['dashes', '-'], ['commas and braces', '{,'],
];

describe('detectImportFormat is total and linear', () => {
  for (const [name, unit] of runs) {
    it(`1.9 MB of ${name}`, () => { timed(() => detectImportFormat(rep(unit, BIG)), BIG_MS); });
    it(`200 KB of ${name} (per-keystroke budget)`, () => { timed(() => detectImportFormat(rep(unit, MEDIUM)), MEDIUM_MS); });
  }
  it('finds OpenAPI / Kubernetes markers in the tail of a long document', () => {
    const filler = `${rep('# filler comment line\n', 60_000)}\n`;
    expect(detectImportFormat(`${filler}openapi: 3.0.0\n`)).toBe('openapi');
    expect(detectImportFormat(`${filler}apiVersion: v1\nkind: Service\n`)).toBe('kubernetes');
    expect(detectImportFormat(filler)).toBeNull();
    timed(() => detectImportFormat(`${filler}openapi: 3.0.0\n`), MEDIUM_MS);
  });
  it('1.9 MB of random binary', () => { timed(() => detectImportFormat(binary(BIG)), BIG_MS); });
  it('still detects a format after a long blank prefix within the head', () => {
    expect(detectImportFormat(`${rep('\n', 5000)}flowchart LR\n a --> b\n`)).toBe('mermaid');
    expect(detectImportFormat(`${rep('\n', 5000)}apiVersion: v1\nkind: Service\n`)).toBe('kubernetes');
    expect(detectImportFormat(`${rep('\n', 5000)}a -> b\n`)).toBe('d2');
  });
});

function expectTotal(result: ImportResult): void {
  expect(result.model).toBeDefined();
  expect(Array.isArray(result.diagnostics)).toBe(true);
}

describe('D2 importer is total and linear', () => {
  const cases: [string, string][] = [
    ['double quotes', '"'], ['single quotes', "'"], ['unterminated quoted value', 'a: "'], ['open braces', '{'], ['newlines', '\n'],
    ['quote pairs', '""'], ['dollar braces', '${'], ['pipes', '|'], ['semicolons', ';'], ['hash comments', '#\n'],
  ];
  for (const [name, unit] of cases) {
    it(`1.9 MB of ${name}`, () => { expectTotal(timed(() => importD2(rep(unit, BIG)), BIG_MS)); });
  }
  it('500-level nesting', () => {
    const result = timed(() => importD2(`${'a {\n'.repeat(500)}${'}\n'.repeat(500)}`), MEDIUM_MS);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
  it('100k lines of x -> y', () => {
    const result = timed(() => importD2(rep('x -> y\n', 700_000)), BIG_MS);
    expect(result.model.edges.length).toBe(1);
  });
  it('many distinct edges hit the caps with a diagnostic', () => {
    let text = '';
    for (let i = 0; i < 30_000; i += 1) text += `n${i} -> n${i + 1}\n`;
    const result = timed(() => importD2(text), BIG_MS);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
  it('1.9 MB single unterminated block string', () => { expectTotal(timed(() => importD2(`a: |${rep('x', BIG)}`), BIG_MS)); });
});

describe('Terraform importer is total and linear', () => {
  const cases: [string, string][] = [
    ['plain words', 'a\n'], ['labelled words', 'x "y"\n'], ['unbalanced resources', 'resource "a" "b" {\n'], ['closing braces', '}\n'],
    ['open braces', '{'], ['newlines', '\n'], ['quotes', '"'], ['comment starts', '/*'], ['hash comments', '#\n'], ['heredoc heads', '<<A\n'],
    ['interpolation starts', '"${'],
  ];
  for (const [name, unit] of cases) {
    it(`1.9 MB of ${name}`, () => { expectTotal(timed(() => importTerraform(rep(unit, BIG)), BIG_MS)); });
  }
  it('unbalanced braces produce a diagnostic', () => {
    expect(timed(() => importTerraform(rep('resource "a" "b" {\n', MEDIUM)), MEDIUM_MS).diagnostics.length).toBeGreaterThan(0);
  });
  it('resource fan-out referencing each other', () => {
    let text = '';
    for (let i = 0; i < 20_000; i += 1) text += `resource "t" "r${i}" {\n  x = t.r${i + 1}\n}\n`;
    expectTotal(timed(() => importTerraform(text), BIG_MS));
  });
  it('takes the label only from a top-level tags block', () => {
    const result = importTerraform('resource "aws_instance" "web" {\n  ebs_block_device {\n    tags = { Name = "nested" }\n  }\n  tags = {\n    Name = "top"\n  }\n}\n');
    expect(result.model.order.length).toBe(1);
    const labels = JSON.stringify(result.model);
    expect(labels).toContain('top');
    expect(labels).not.toContain('nested');
    const onlyNested = importTerraform('resource "aws_instance" "web" {\n  ebs_block_device {\n    tags = { Name = "nested" }\n  }\n}\n');
    expect(JSON.stringify(onlyNested.model)).not.toContain('nested');
  });
});

describe('OpenAPI importer is total and linear', () => {
  it('huge paths map is capped with a diagnostic', () => {
    let text = 'openapi: 3.0.0\npaths:\n';
    for (let i = 0; i < 40_000; i += 1) text += `  /p${i}:\n    get:\n      summary: s\n`;
    const result = timed(() => importOpenApi(text), BIG_MS);
    expect(result.diagnostics.some((d) => /Limite/.test(d.message))).toBe(true);
  });
  it('huge JSON paths map', () => {
    const paths = Array.from({ length: 40_000 }, (_, i) => `"/p${i}":{"get":{}}`).join(',');
    const result = timed(() => importOpenApi(`{"openapi":"3.0.0","paths":{${paths}}}`), BIG_MS);
    expect(result.diagnostics.some((d) => /Limite/.test(d.message))).toBe(true);
  });
  const cases: [string, string][] = [['open brackets', '['], ['open braces', '{'], ['newlines', '\n'], ['quotes', '"'], ['dashes', '- '], ['colons', ': '], ['anchors', '&a '], ['tags', '! ']];
  for (const [name, unit] of cases) {
    it(`1.9 MB of ${name}`, () => { expectTotal(timed(() => importOpenApi(rep(unit, BIG)), BIG_MS)); });
  }
  it('1.9 MB of whitespace after a key', () => { expectTotal(timed(() => importOpenApi(`openapi: 3.0.0\npaths:${rep(' ', BIG)}`), BIG_MS)); });
});

describe('line-based importers (Mermaid, LikeC4, Structurizr) are linear', () => {
  const run = (text: string, format: 'mermaid' | 'likec4' | 'structurizr') => timed(() => importArchitecture(text, format), MEDIUM_MS);
  it('a long run of spaces between tokens', () => {
    run(`A${rep(' ', MEDIUM)}x`, 'mermaid');
    run(`A${rep(' ', MEDIUM)}--> B`, 'mermaid');
    run(`model {\na${rep(' ', MEDIUM)}-> b`, 'likec4');
  });
  it('deeply nested groups', () => {
    let mermaid = '';
    let likec4 = 'model {\n';
    let open = '';
    for (let i = 0; i < 15_000; i += 1) { mermaid += `subgraph s${i}\nn${i}\n`; likec4 += `g${i} = system 'x' {\n`; open += `s${i} {\n`; }
    run(mermaid, 'mermaid');
    run(likec4, 'likec4');
    run(open, 'structurizr');
  });
  it('keeps the Mermaid edge grammar', () => {
    const { model } = importArchitecture('flowchart LR\nA---B\nB -.-> C\nC ==>|  "lbl"  | D\nD -->|x| E\n', 'mermaid');
    expect(model.edges.map((e) => [e.from, e.to, e.connector, e.label])).toEqual([['A', 'B', '-', undefined], ['B', 'C', '-->', undefined], ['C', 'D', '>', 'lbl'], ['D', 'E', '>', 'x']]);
  });
});

describe('Kubernetes importer is total and linear', () => {
  it('100k tiny documents separated by ---', () => {
    const result = timed(() => importKubernetes(rep('---\na: 1\n', BIG)), BIG_MS);
    expectTotal(result);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
  it('100k empty documents', () => { expectTotal(timed(() => importKubernetes(rep('---\n', BIG)), BIG_MS)); });
  it('services x workloads selector fan-out', () => {
    let text = '';
    for (let i = 0; i < 1000; i += 1) text += `apiVersion: apps/v1\nkind: Deployment\nmetadata: {name: d${i}}\nspec: {template: {metadata: {labels: {app: shared, tier: web}}}}\n---\n`;
    for (let i = 0; i < 1000; i += 1) text += `apiVersion: v1\nkind: Service\nmetadata: {name: s${i}}\nspec: {selector: {app: shared, tier: web}}\n---\n`;
    const result = timed(() => importKubernetes(text), 1000);
    expect(result.diagnostics.some((d) => /Limite/.test(d.message))).toBe(true);
  });
  it('services whose 2nd selector pair matches nothing examine O(workloads + services) candidates, not their product', () => {
    let text = '';
    for (let i = 0; i < 1000; i += 1) text += `apiVersion: apps/v1\nkind: Deployment\nmetadata: {name: d${i}}\nspec: {template: {metadata: {labels: {app: shared, tier: web}}}}\n---\n`;
    for (let i = 0; i < 1000; i += 1) text += `apiVersion: v1\nkind: Service\nmetadata: {name: s${i}}\nspec: {selector: {app: shared, tier: db, zone: a}}\n---\n`;
    k8sProbe.candidates = 0;
    const result = timed(() => importKubernetes(text), 1000);
    expect(result.model.edges.length).toBe(0);
    expect(result.diagnostics.some((d) => /Limite/.test(d.message))).toBe(false);
    // A first-pair-only scan examines 1000 x 1000 = 1,000,000; the bound is 20x below that.
    expect(k8sProbe.candidates).toBeLessThanOrEqual(50_000);
  });
  it('one workload with a very large label map', () => {
    let labels = '';
    for (let i = 0; i < 10_000; i += 1) labels += `l${i}: v, `;
    let selector = '';
    for (let i = 0; i < 10_000; i += 1) selector += `l${i}: v, `;
    const text = `apiVersion: apps/v1\nkind: Deployment\nmetadata: {name: d}\nspec: {template: {metadata: {labels: {${labels}}}}}\n---\napiVersion: v1\nkind: Service\nmetadata: {name: s}\nspec: {selector: {${selector}}}\n`;
    const result = timed(() => importKubernetes(text), 1000);
    expect(result.model.edges.length).toBe(1);
  });
  const cases: [string, string][] = [['open brackets', '['], ['open braces', '{'], ['newlines', '\n'], ['quotes', '"'], ['dashes', '- '], ['colons', ': '], ['anchors', '&a '], ['tags', '! ']];
  for (const [name, unit] of cases) {
    it(`1.9 MB of ${name}`, () => { expectTotal(timed(() => importKubernetes(rep(unit, BIG)), BIG_MS)); });
  }
});
