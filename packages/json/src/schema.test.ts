import { COLOR_MODES, CONNECTORS, DIRECTIONS, SHAPES, STYLE_MODES, TYPEFACES } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { diagramJsonSchema, printDiagramJsonSchema } from './schema';

const defs = diagramJsonSchema.$defs as Record<string, { properties?: Record<string, { enum?: string[] }> }>;

describe('diagramJsonSchema', () => {
  it('keeps every enum in sync with the core constants', () => {
    expect(defs.node.properties!.shape!.enum).toEqual([...SHAPES]);
    expect(defs.connection.properties!.type!.enum).toEqual([...CONNECTORS]);
    expect(defs.node.properties!.colorMode!.enum).toEqual([...COLOR_MODES]);
    expect(defs.node.properties!.styleMode!.enum).toEqual([...STYLE_MODES]);
    expect(defs.node.properties!.typeface!.enum).toEqual([...TYPEFACES]);
    expect((diagramJsonSchema.properties.style as { properties: Record<string, { enum: string[] }> }).properties.direction.enum).toEqual([...DIRECTIONS]);
  });

  it('requires version and nodes, and references the shared element definition', () => {
    expect(diagramJsonSchema.required).toEqual(['version', 'nodes']);
    expect(diagramJsonSchema.properties.version).toEqual({ const: 1 });
    expect(diagramJsonSchema.properties.nodes.items).toEqual({ $ref: '#/$defs/element' });
  });

  it('prints byte-stable JSON that parses back to the same object', () => {
    const text = printDiagramJsonSchema();
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(diagramJsonSchema);
    expect(printDiagramJsonSchema()).toBe(text);
  });
});
