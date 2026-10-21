import { CARDINALITIES, LAYOUT_ROLES, PRESENTATIONS, PORTS, COLOR_MODES, CONNECTORS, DIRECTIONS, SHAPES, STYLE_MODES, TYPEFACES } from '@strukt/core';

const enumOf = (values: readonly string[]) => ({ enum: [...values] });

const elementProps = {
  presentation: enumOf(PRESENTATIONS), layoutRole: enumOf(LAYOUT_ROLES),
  id: { type: 'string', minLength: 1, description: 'Nome do elemento (é o id; único no diagrama).' },
  label: { type: 'string', description: 'Rótulo exibido no lugar do nome.' },
  icon: { type: 'string', description: 'Ícone: aws-*, gcp-*, azure-*, k8s-*, marca ou genérico.' },
  color: { type: 'string', description: 'Cor da paleta ou hex.' },
  tech: { type: 'string', description: 'Tecnologia (ex.: "PostgreSQL 16").' },
  description: { type: 'string', description: 'Descrição/responsabilidades.' },
  link: { type: 'string', description: 'URL ou "doc:<slug>" / "diagram:<slug>".' },
  colorMode: enumOf(COLOR_MODES),
  styleMode: enumOf(STYLE_MODES),
  typeface: enumOf(TYPEFACES),
} as const;

/**
 * The diagram document (spec M5.5), single source for `.arch/strukt.schema.json` and for the reader's
 * validation. 2020-12; defaults are absent, never null.
 */
export const diagramJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://strukt.dev/strukt.schema.json',
  title: 'Diagrama do Joinlet',
  description: 'Diagrama do Joinlet (version 1): nós e grupos com propriedades, conexões e estilo. Posições ficam no .layout.json.',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'nodes'],
  properties: {
    $schema: { type: 'string' },
    version: { const: 1 },
    style: {
      type: 'object',
      additionalProperties: false,
      properties: { direction: enumOf(DIRECTIONS), colorMode: enumOf(COLOR_MODES), styleMode: enumOf(STYLE_MODES), typeface: enumOf(TYPEFACES) },
    },
    nodes: { type: 'array', items: { $ref: '#/$defs/element' } },
    connections: { type: 'array', items: { $ref: '#/$defs/connection' } },
  },
  $defs: {
    element: { anyOf: [{ $ref: '#/$defs/node' }, { $ref: '#/$defs/group' }] },
    node: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { ...elementProps, type: { const: 'node' }, shape: enumOf(SHAPES), fields: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 1 }, type: { type: 'string' }, key: { enum: ['PK', 'FK'] } } } } },
    },
    group: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'type'],
      properties: { ...elementProps, canvasFrame: { type: 'boolean', description: 'Área de diagrama independente no canvas.' }, type: { const: 'group' }, children: { type: 'array', items: { $ref: '#/$defs/element' } } },
    },
    connection: {
      type: 'object',
      additionalProperties: false,
      required: ['from', 'to'],
      properties: {
        from: { type: 'string', minLength: 1 },
        to: { type: 'string', minLength: 1 },
        fromCardinality: enumOf(CARDINALITIES), toCardinality: enumOf(CARDINALITIES),
        type: enumOf(CONNECTORS), fromPort: enumOf(PORTS), toPort: enumOf(PORTS),
        label: { type: 'string' },
        color: { type: 'string' },
      },
    },
  },
} as const;

/** The file written to `.arch/strukt.schema.json`: 2 spaces, trailing newline, byte-stable. */
export function printDiagramJsonSchema(): string {
  return `${JSON.stringify(diagramJsonSchema, null, 2)}\n`;
}
