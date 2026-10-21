import { describe, expect, it } from 'vitest';
import { detectImportFormat, importArchitecture } from '@strukt/dsl';
import { IMPORT_ACCEPT, IMPORT_FORMAT_LABELS } from './importFormats';

describe('import formats', () => {
  it('labels every format and accepts the new extensions', () => {
    expect(Object.keys(IMPORT_FORMAT_LABELS).sort()).toEqual(['d2', 'kubernetes', 'likec4', 'mermaid', 'openapi', 'structurizr', 'terraform']);
    for (const ext of ['.d2', '.tf', '.yaml', '.yml', '.json']) expect(IMPORT_ACCEPT.split(',')).toContain(ext);
  });

  it('imports a Kubernetes manifest picked as .yaml through detection', () => {
    const text = 'apiVersion: v1\nkind: Service\nmetadata: {name: s}\n';
    const format = detectImportFormat(text, 'svc.yaml');
    expect(format).toBe('kubernetes');
    expect(importArchitecture(text, format!).model.order).toEqual(['Service/s']);
  });
});
