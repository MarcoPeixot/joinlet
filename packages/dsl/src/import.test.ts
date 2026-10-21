import { describe, expect, it } from 'vitest';
import { detectImportFormat, importArchitecture } from './import';
import type { ImportFormat } from './import';

describe('architecture import', () => {
  it('imports a Mermaid flowchart with a group and labelled edge', () => {
    const text = 'flowchart LR\nsubgraph Frontend\nWeb[Web App] -->|HTTPS| API{Gateway}\nend\n';
    expect(detectImportFormat(text)).toBe('mermaid');
    const result = importArchitecture(text, 'mermaid');
    expect(result.model.elements.Frontend?.kind).toBe('group');
    expect(result.model.elements.Web?.parentId).toBe('Frontend');
    expect(result.model.edges[0]).toMatchObject({ from: 'Web', to: 'API', label: 'HTTPS' });
  });

  it('strips quotes around Mermaid edge labels', () => {
    const result = importArchitecture('flowchart LR\nA -->|"calls API"| B\nB -->|\'x\'| C\n', 'mermaid');
    expect(result.model.edges.map((e) => e.label)).toEqual(['calls API', 'x']);
  });

  it('imports LikeC4 model declarations and relationships', () => {
    const text = "specification { element service }\nmodel {\ncloud = system 'Cloud' {\napi = service 'API'\n}\ncloud -> api 'calls'\n}\n";
    expect(detectImportFormat(text)).toBe('likec4');
    const result = importArchitecture(text, 'likec4');
    expect(result.model.elements.api?.parentId).toBe('cloud');
    expect(result.model.edges[0]?.label).toBe('calls');
  });

  it('imports Structurizr components and reports unsupported lines', () => {
    const text = 'workspace {\nmodel {\nu = person "User"\ns = softwareSystem "Shop" {\napi = container "API"\n}\nu -> api "uses"\nunknown thing\n}\nviews {\n}\n}\n';
    expect(detectImportFormat(text)).toBe('structurizr');
    const result = importArchitecture(text, 'structurizr');
    expect(result.model.elements.api?.parentId).toBe('s');
    expect(result.model.edges[0]?.from).toBe('u');
    expect(result.diagnostics).toContainEqual({ line: 8, message: 'Construção não suportada ignorada.' });
  });

  it('keeps valid components when a relationship points at an unsupported declaration', () => {
    const result = importArchitecture("model {\napi = service 'API'\napi -> missing 'calls'\n}\n", 'likec4');
    expect(result.model.order).toEqual(['api']);
    expect(result.diagnostics[0]?.message).toContain('componente ausente');
  });
});

describe('registry: D2, Terraform, OpenAPI and Kubernetes', () => {
  const cases: [string, string, ImportFormat][] = [
    ['a -> b: x\n', 'a.txt', 'd2'],
    ['resource "aws_instance" "web" {\n}\n', 'main.txt', 'terraform'],
    ['openapi: 3.0.0\ninfo: {title: x}\npaths: {}\n', 'api.yaml', 'openapi'],
    ['{"swagger": "2.0", "paths": {}}', 'api.json', 'openapi'],
    ['apiVersion: v1\nkind: Service\nmetadata: {name: s}\n', 'k.yml', 'kubernetes'],
  ];
  it.each(cases)('detects %j', (text, name, format) => {
    expect(detectImportFormat(text)).toBe(format);
    const result = importArchitecture(text, format);
    expect(result.model.order.length).toBeGreaterThan(0);
  });

  it('uses the file extension for .d2 and .tf', () => {
    expect(detectImportFormat('x', 'a.d2')).toBe('d2');
    expect(detectImportFormat('locals {}', 'a.tf')).toBe('terraform');
  });

  it('does not take Eraser or Mermaid arrows for D2', () => {
    expect(detectImportFormat('a --> b\n')).toBeNull();
    expect(detectImportFormat('a > b\nb <> c\n')).toBeNull();
    expect(detectImportFormat('flowchart LR\nA --> B\n')).toBe('mermaid');
  });

  it('refuses oversized input for every format', () => {
    const huge = 'x'.repeat(2_000_001);
    for (const format of ['mermaid', 'likec4', 'structurizr', 'd2', 'terraform', 'openapi', 'kubernetes'] as const) {
      const result = importArchitecture(huge, format);
      expect(result.model.order).toEqual([]);
      expect(result.diagnostics[0]?.message).toContain('grande demais');
    }
    expect(detectImportFormat(huge)).toBeNull();
  });
});
