import { describe, expect, it } from 'vitest';
import { printDiagramJson } from '@strukt/json';
import { importKubernetes } from './k8s';
import { shopK8s } from '../fixtures/import';
import { expectValid, messages } from './testkit';

const fixture = shopK8s;

describe('Kubernetes importer', () => {
  it('imports workloads, services, ingress, config and volumes inside a namespace group', () => {
    const result = importKubernetes(fixture);
    const { model } = result;
    expect(model.elements.shop?.kind).toBe('group');
    for (const id of ['shop/Deployment/web', 'shop/Service/web-svc', 'shop/Ingress/web-ing', 'shop/ConfigMap/web-config', 'shop/Secret/web-secret', 'shop/PersistentVolumeClaim/web-data']) {
      expect(model.elements[id]?.parentId, id).toBe('shop');
    }
    expect(model.elements['shop/Deployment/web']).toMatchObject({ label: 'web', tech: 'Deployment' });
    expectValid(result);
  });

  it('connects service to workload by selector, ingress to service, workload to config/secret/pvc', () => {
    const pairs = importKubernetes(fixture).model.edges.map((e) => `${e.from}>${e.to}`);
    expect(pairs).toContain('shop/Service/web-svc>shop/Deployment/web');
    expect(pairs).toContain('shop/Ingress/web-ing>shop/Service/web-svc');
    expect(pairs).toContain('shop/Deployment/web>shop/ConfigMap/web-config');
    expect(pairs).toContain('shop/Deployment/web>shop/Secret/web-secret');
    expect(pairs).toContain('shop/Deployment/web>shop/PersistentVolumeClaim/web-data');
  });

  it('never includes secret data values', () => {
    const json = printDiagramJson(importKubernetes(fixture).model);
    expect(json).not.toContain('c3VwZXI');
    expect(json).not.toContain('hunter2');
    expect(json).not.toContain('password');
  });

  it('warns once per unknown kind', () => {
    const result = importKubernetes(`${fixture}---\napiVersion: policy/v1\nkind: PodDisruptionBudget\nmetadata: {name: other}\n`);
    expect(result.diagnostics.filter((d) => d.message.includes('PodDisruptionBudget'))).toHaveLength(1);
    expect(messages(result)[0]).toContain('ignorad');
  });

  it('matches selectors only within the namespace and needs every label', () => {
    const text = [
      'kind: Deployment\napiVersion: apps/v1\nmetadata: {name: a, namespace: n1}\nspec: {template: {metadata: {labels: {app: a}}}}',
      'kind: Service\napiVersion: v1\nmetadata: {name: s1, namespace: n2}\nspec: {selector: {app: a}}',
      'kind: Service\napiVersion: v1\nmetadata: {name: s2, namespace: n1}\nspec: {selector: {app: a, extra: x}}',
      'kind: Service\napiVersion: v1\nmetadata: {name: s3, namespace: n1}\nspec: {selector: {}}',
    ].join('\n---\n');
    expect(importKubernetes(text).model.edges).toEqual([]);
  });

  it('handles CronJob pod templates and top-level (no namespace) resources', () => {
    const text = 'apiVersion: batch/v1\nkind: CronJob\nmetadata: {name: nightly}\nspec:\n  jobTemplate:\n    spec:\n      template:\n        metadata: {labels: {job: n}}\n        spec: {containers: [{name: c, env: [{name: X, valueFrom: {configMapKeyRef: {name: cfg}}}]}]}\n---\nkind: ConfigMap\napiVersion: v1\nmetadata: {name: cfg}\n---\nkind: Service\napiVersion: v1\nmetadata: {name: svc}\nspec: {selector: {job: n}}\n';
    const { model } = importKubernetes(text);
    expect(model.elements['CronJob/nightly']).toBeDefined();
    expect(model.edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual(['CronJob/nightly>ConfigMap/cfg', 'Service/svc>CronJob/nightly']);
  });

  it('warns on invalid documents and non-Kubernetes input', () => {
    expect(importKubernetes('just: text').diagnostics.length).toBeGreaterThan(0);
    expect(importKubernetes('a: [').model.order).toEqual([]);
    expect(importKubernetes('a: [').diagnostics.length).toBeGreaterThan(0);
  });

  describe('hostile input', () => {
    it('accepts constructor/toString names and labels, refuses __proto__', () => {
      const text = [
        'kind: Deployment\napiVersion: apps/v1\nmetadata: {name: constructor, namespace: toString}\nspec: {template: {metadata: {labels: {constructor: x}}}}',
        'kind: Service\napiVersion: v1\nmetadata: {name: toString, namespace: toString}\nspec: {selector: {constructor: x}}',
        'kind: Service\napiVersion: v1\nmetadata: {name: __proto__}',
        'kind: Deployment\napiVersion: v1\nmetadata: {name: ok, namespace: __proto__}',
      ].join('\n---\n');
      const result = importKubernetes(text);
      expect(result.model.elements['toString/Deployment/constructor']).toBeDefined();
      expect(result.model.edges).toHaveLength(1);
      expect(Object.keys(result.model.elements)).not.toContain('__proto__');
      expect(messages(result).some((m) => m.includes('__proto__'))).toBe(true);
      expectValid(result);
    });

    it('survives an alias bomb and deep/junk input', () => {
      const lines = ['a: &a [x,x,x,x,x,x,x,x,x]'];
      for (let i = 0; i < 12; i += 1) lines.push(`${String.fromCharCode(98 + i)}: &${String.fromCharCode(98 + i)} [${Array(9).fill(`*${String.fromCharCode(97 + i)}`).join(',')}]`);
      const bomb = `kind: ConfigMap\napiVersion: v1\nmetadata: {name: x}\nbomb:\n${lines.map((l) => `  ${l}`).join('\n')}\n`;
      for (const text of [bomb, '['.repeat(100_000), '\u0000\u0001: [', `kind: Service\napiVersion: v1\nmetadata: {name: "${'x'.repeat(1_000_000)}"}`, '---\n'.repeat(400_000)]) {
        expect(() => importKubernetes(text)).not.toThrow();
      }
    });

    it('caps elements and huge selector fan-out', () => {
      const docs: string[] = [];
      for (let i = 0; i < 1200; i += 1) docs.push(`kind: Deployment\napiVersion: apps/v1\nmetadata: {name: d${i}}\nspec: {template: {metadata: {labels: {app: x}}}}`);
      for (let i = 0; i < 1200; i += 1) docs.push(`kind: Service\napiVersion: v1\nmetadata: {name: s${i}}\nspec: {selector: {app: x}}`);
      const result = importKubernetes(docs.join('\n---\n'));
      expect(result.model.order.length).toBe(2000);
      expect(result.model.edges.length).toBeLessThanOrEqual(5000);
      expect(messages(result).some((m) => m.includes('Limite'))).toBe(true);
    });

    it('cuts long YAML at the last whole document instead of mid-document', () => {
      const doc = (i: number) => `apiVersion: v1\nkind: ConfigMap\nmetadata: {name: cm${i}}\ndata: {pad: "${'x'.repeat(900)}"}\n`;
      const text = Array.from({ length: 400 }, (_, i) => doc(i)).join('---\n');
      expect(text.length).toBeGreaterThan(250_000);
      const result = importKubernetes(text);
      const names = result.model.order;
      const whole = Math.floor((250_000 + 4) / (doc(0).length + 4));
      expect(names.length).toBe(whole);
      expect(names.at(-1)).toBe(`ConfigMap/cm${names.length - 1}`);
      expect(messages(result).some((m) => m.includes('Entrada YAML longa'))).toBe(true);
      expect(messages(result).some((m) => m.includes('YAML inválido'))).toBe(false);
    });

    it('states which cut applied, and ignores a document marker that would throw most of the input away', () => {
      const lines = Array.from({ length: 30_000 }, (_, i) => `  k${i}: value${i}\n`).join('');
      const early = `apiVersion: v1\nkind: ConfigMap\nmetadata: {name: first}\n---\napiVersion: v1\nkind: ConfigMap\nmetadata: {name: big}\ndata:\n${lines}`;
      expect(early.length).toBeGreaterThan(250_000);
      const cutEarly = importKubernetes(early);
      expect(cutEarly.model.order).toContain('ConfigMap/big');
      expect(messages(cutEarly).find((m) => m.includes('Entrada YAML longa'))).toMatch(/linha/);
      const doc = (i: number) => `apiVersion: v1\nkind: ConfigMap\nmetadata: {name: cm${i}}\ndata: {pad: "${'x'.repeat(900)}"}\n`;
      const late = importKubernetes(Array.from({ length: 400 }, (_, i) => doc(i)).join('---\n'));
      expect(messages(late).find((m) => m.includes('Entrada YAML longa'))).toMatch(/documento/);
    });

    it('refuses input over the size limit', () => {
      const result = importKubernetes(`kind: Service\n# ${'x'.repeat(2_000_001)}`);
      expect(messages(result)[0]).toContain('grande demais');
    });
  });
});
