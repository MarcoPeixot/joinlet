import { describe, expect, it } from 'vitest';
import { applyOps, computeRects, emptyModel, visualBox } from '@strukt/core';
import { parseDiagramJson, printDiagramJson } from '@strukt/json';
import { TEMPLATES } from './templates';

describe('TEMPLATES', () => {
  it('offers cloud, Kubernetes, data, sequence, process and general architecture starters', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(expect.arrayContaining(['aws-serverless', 'aws-containers', 'azure-web', 'gcp-serverless', 'argocd-gitops', 'kubernetes-autoscaling', 'relational-orders', 'sequence-api', 'process-approval', 'microservices', 'c4-context', 'event-driven', 'rag', 'etl']));
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });

  it('separates browser requests from S3 origins and keeps managed AWS data services outside the VPC', () => {
    const serverless = applyOps(emptyModel(), TEMPLATES.find((template) => template.id === 'aws-serverless')!.ops);
    const containers = applyOps(emptyModel(), TEMPLATES.find((template) => template.id === 'aws-containers')!.ops);
    if (!serverless.ok || !containers.ok) throw new Error('Invalid AWS templates');
    expect(serverless.model.edges.some((edge) => edge.from === 'Navegador' && edge.to === 'API')).toBe(true);
    expect(serverless.model.edges.some((edge) => edge.from === 'S3' && edge.to === 'API')).toBe(false);
    expect(serverless.model.elements.Navegador?.parentId).toBeUndefined();
    expect(containers.model.elements.Gerenciados?.parentId).toBe('AWS');
    expect(containers.model.elements['Dados A']?.parentId).toBe('Gerenciados');
    expect(containers.model.elements['Dados B']?.parentId).toBe('Gerenciados');
    expect(containers.model.edges.some((edge) => edge.from === 'ECS A' && edge.to === 'ECR' && edge.label === 'pull de imagem')).toBe(true);
  });

  for (const template of TEMPLATES) {
    describe(template.id, () => {
      const result = applyOps(emptyModel(), template.ops);

      it('applies to an empty model', () => {
        expect(result).toMatchObject({ ok: true });
      });

      it('has enough elements and connections', () => {
        if (!result.ok) throw new Error(result.error.message);
        expect(result.model.order.length).toBeGreaterThanOrEqual(4);
        expect(result.model.edges.length).toBeGreaterThanOrEqual(4);
      });

      it('round-trips through the canonical JSON without errors', () => {
        if (!result.ok) throw new Error(result.error.message);
        const printed = printDiagramJson(result.model);
        const parsed = parseDiagramJson(printed);
        expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
        expect(printDiagramJson(parsed.model)).toBe(printed);
      });

      it('has unique ids and Portuguese copy', () => {
        const ids = template.ops.flatMap((op) => (op.op === 'add_node' || op.op === 'add_group' ? [op.id] : []));
        expect(new Set(ids).size).toBe(ids.length);
        expect(template.title.length).toBeGreaterThan(0);
        expect(template.description).toMatch(/[áâãéêíóôõúç]| (de|com|para|e|do|da|em) /);
        expect(template.category).toBeTruthy();
      });

      if (template.positions) it('authors every node without overlapping its visual footprint', () => {
        if (!result.ok) throw new Error(result.error.message);
        const model = result.model;
        const nodes = model.order.filter((id) => model.elements[id]?.kind === 'node');
        expect(nodes.every((id) => Object.hasOwn(template.positions!, id))).toBe(true);
        expect(Object.keys(template.positions!).every((id) => Object.hasOwn(model.elements, id))).toBe(true);
        const rects = computeRects(model, { nodes: template.positions!, edges: {} });
        for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
          const a = visualBox(model.elements[nodes[i]!]!, rects[nodes[i]!]!);
          const b = visualBox(model.elements[nodes[j]!]!, rects[nodes[j]!]!);
          expect(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y, `${nodes[i]} overlaps ${nodes[j]}`).toBe(false);
        }
        for (const id of nodes) for (const group of model.order.filter((entry) => model.elements[entry]?.kind === 'group')) {
          let parent = model.elements[id]?.parentId;
          while (parent && parent !== group) parent = model.elements[parent]?.parentId;
          if (parent === group) continue;
          const a = visualBox(model.elements[id]!, rects[id]!);
          const b = rects[group]!;
          expect(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y, `${id} overlaps an unrelated group ${group}`).toBe(false);
        }
      });
    });
  }
});
