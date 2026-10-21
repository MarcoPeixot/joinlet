import { describe, expect, it } from 'vitest';
import { importD2 } from './d2';
import { importKubernetes } from './k8s';
import { importOpenApi } from './openapi';
import { importTerraform } from './terraform';
import { ModelBuilder, replayStats } from './common';
import type { ImportResult } from './common';

/** Names the model stores are cleaned (control chars, 200-char cap); every importer must stay consistent and linear on them. */
const LONG = 'a'.repeat(201);
const MS = 3000;

function timed(fn: () => ImportResult): { result: ImportResult; attempts: number } {
  const before = replayStats.attempts;
  const start = performance.now();
  const result = fn();
  const took = performance.now() - start;
  expect(took, `took ${took.toFixed(0)} ms`).toBeLessThan(MS);
  return { result, attempts: replayStats.attempts - before };
}

const d2Filler = (n: number): string => Array.from({ length: n }, (_, i) => `n${i} -> n${i + 1}`).join('\n');

describe('cleaned ids stay consistent across importers', () => {
  it('D2: a >200-char container name keeps its children (single batch, no replay)', () => {
    const { result, attempts } = timed(() => importD2(`${LONG}.x\n${LONG}.y\n${d2Filler(1990)}\n`));
    expect(attempts).toBe(1);
    expect(result.diagnostics.filter((d) => d.message.startsWith('Item ignorado'))).toEqual([]);
    expect(result.model.order.length).toBeGreaterThan(1900);
  });

  it('D2: a container name near the cap keeps children whose ids get cut', () => {
    const near = 'c'.repeat(195);
    const { result, attempts } = timed(() => importD2(`${near}.x\n${near}.y\nn1 -> ${near}.x\n`));
    expect(attempts).toBe(1);
    expect(result.diagnostics.filter((d) => d.message.startsWith('Item ignorado'))).toEqual([]);
    expect(result.model.edges.length).toBe(1);
  });

  it('D2: control characters in names', () => {
    const { result, attempts } = timed(() => importD2('"a\\u0001b".x -> "a\\u0001b".y\n'));
    expect(attempts).toBe(1);
    expect(result.model.edges.length).toBe(1);
  });

  it('D2: names colliding after cleaning merge', () => {
    const { result, attempts } = timed(() => importD2(`${'b'.repeat(250)}.one -> ${'b'.repeat(260)}.two\n`));
    expect(attempts).toBe(1);
    expect(result.diagnostics.filter((d) => d.message.startsWith('Item ignorado'))).toEqual([]);
    expect(Object.keys(result.model.elements).length).toBeGreaterThanOrEqual(1);
  });

  it('Terraform: long resource names connect and stay in a single batch', () => {
    const type = 'aws_' + 't'.repeat(150);
    const name = 'n'.repeat(150);
    const text = `resource "${type}" "${name}" {\n}\nresource "aws_instance" "web" {\n  x = ${type}.${name}\n}\n`;
    const { result, attempts } = timed(() => importTerraform(text));
    expect(attempts).toBe(1);
    expect(result.model.edges.length).toBe(1);
  });

  it('Kubernetes: long names and namespaces group correctly', () => {
    const ns = 'z'.repeat(150);
    const text = `apiVersion: v1\nkind: Service\nmetadata:\n  name: ${'s'.repeat(230)}\n  namespace: ${ns}\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n  namespace: ${ns}\n`;
    const { result, attempts } = timed(() => importKubernetes(text));
    expect(attempts).toBe(1);
    expect(Object.keys(result.model.elements).length).toBeGreaterThanOrEqual(3);
  });

  it('OpenAPI: paths longer than 200 chars sharing a prefix do not merge', () => {
    const prefix = '/' + 'p'.repeat(210);
    const text = `openapi: 3.0.0\ninfo:\n  title: T\npaths:\n  ${prefix}/one:\n    get:\n      summary: a\n  ${prefix}/two:\n    get:\n      summary: b\n`;
    const { result, attempts } = timed(() => importOpenApi(text));
    expect(attempts).toBe(1);
    const gets = Object.keys(result.model.elements).filter((id) => id.startsWith('GET '));
    expect(gets.length).toBe(2);
    for (const id of gets) expect(id.length).toBeLessThanOrEqual(200);
  });
});

describe('fallback replay is bounded', () => {
  const build = (bad: number) => {
    const b = new ModelBuilder();
    b.add('leaf', { label: 'leaf' });
    for (let i = 0; i < 1500; i += 1) b.add(`ok${i}`, { label: 'ok' });
    for (let i = 0; i < bad; i += 1) b.add(`bad${i}`, { label: 'bad', parentId: 'leaf' }); // parent is not a group: invalid
    const before = replayStats.attempts;
    const start = performance.now();
    const result = b.build();
    return { result, attempts: replayStats.attempts - before, took: performance.now() - start };
  };

  it('a few invalid items are dropped one by one, the rest is kept', () => {
    const { result, attempts } = build(5);
    expect(attempts).toBe(6);
    expect(Object.keys(result.model.elements).length).toBe(1501);
    expect(result.diagnostics.some((d) => d.message.startsWith('Item ignorado'))).toBe(true);
  });

  it('many invalid items stop after at most 51 attempts with a pt-BR diagnostic and a valid partial model', () => {
    const { result, attempts, took } = build(400);
    expect(attempts).toBeLessThanOrEqual(51);
    expect(took).toBeLessThan(MS);
    expect(result.diagnostics.map((d) => d.message)).toContain('Importação parcial: muitos itens inválidos.');
    expect(Object.keys(result.model.elements).length).toBeGreaterThan(1000);
  });
});
