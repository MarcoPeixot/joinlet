import { describe, expect, it } from 'vitest';
import { IMPORT_SOURCES } from './Imports';

describe('Landing import formats', () => {
  it('lists only formats the importers support, with their scope', () => {
    expect(IMPORT_SOURCES.map((source) => source.name)).toEqual(['Terraform', 'Kubernetes', 'OpenAPI', 'D2', 'Mermaid', 'LikeC4', 'Structurizr']);
    for (const source of IMPORT_SOURCES) expect(source.note.length).toBeGreaterThan(0);
  });
});
