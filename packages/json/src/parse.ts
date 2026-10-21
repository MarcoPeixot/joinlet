import {
  CARDINALITIES, validTableFields, LAYOUT_ROLES, PRESENTATIONS, PORTS, COLOR_MODES, CONNECTORS, DEFAULT_STYLE, RESERVED_NAME, SHAPES, STYLE_MODES, TYPEFACES, emptyModel, normalizeEdgeIds, own,
} from '@strukt/core';
import type { Connector, DiagramElement, DiagramModel, EdgeEl, ID, Shape, Span } from '@strukt/core';
import { parseJsonText, positionOf } from './parseJson';
import type { JsonNode } from './parseJson';
import { diagramJsonSchema } from './schema';
import { pathText, validateNode } from './validate';
import type { SchemaError } from './validate';

/** The same diagnostic shape the DSL parser uses: message in pt-BR plus line/column. */
export interface JsonDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  span: Span;
  line: number;
  column: number;
}

/** Parser limit, independent of the network limits (the server and the MCP keep their own 200_000): a bigger diagram is refused with one diagnostic. */
export const MAX_DIAGRAM_JSON = 5_000_000;

const STRING_PROPS = ['label', 'icon', 'color', 'tech', 'description', 'link'] as const;
const ELEMENT_ENUMS = { presentation: PRESENTATIONS, layoutRole: LAYOUT_ROLES };
const ENUM_PROPS = { colorMode: COLOR_MODES, styleMode: STYLE_MODES, typeface: TYPEFACES } as const;
const STYLE_ENUMS = { direction: ['right', 'down', 'left', 'up'], ...ENUM_PROPS } as const;

export function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function prop(node: JsonNode, key: string): JsonNode | undefined {
  return node.kind === 'object' ? node.entries.find((entry) => entry.key === key)?.value : undefined;
}

/**
 * Reads the canonical diagram JSON. Lenient like the DSL parser: a broken document keeps what could
 * be read, every dropped or repaired piece comes back as a diagnostic, and the rest of the diagram
 * continues. `__proto__` is refused, ids are read through `own()`, and the text has a size limit.
 */
export function parseDiagramJson(text: string): { model: DiagramModel; diagnostics: JsonDiagnostic[] } {
  const diagnostics: JsonDiagnostic[] = [];
  const model = emptyModel();
  const diag = (severity: JsonDiagnostic['severity'], message: string, span: Span): void => {
    const { line, column } = positionOf(text, span.from);
    diagnostics.push({ severity, message, span, line, column });
  };
  const fail = (message: string, span: Span) => diag('error', message, span);
  const warn = (message: string, span: Span) => diag('warning', message, span);

  if (text.length > MAX_DIAGRAM_JSON) {
    fail(`O diagrama é grande demais (limite de ${MAX_DIAGRAM_JSON} caracteres).`, { from: 0, to: 0 });
    return { model, diagnostics };
  }
  const parsed = parseJsonText(text);
  if (!parsed.node) {
    const index = parsed.error!.index;
    fail(`JSON inválido: ${parsed.error!.message}`, { from: index, to: Math.min(index + 1, text.length) });
    return { model, diagnostics };
  }
  for (const duplicate of parsed.duplicateKeys) warn(`A chave "${duplicate.key}" aparece mais de uma vez; vale a última.`, duplicate.span);

  const schemaErrors: SchemaError[] = [];
  validateNode(parsed.node, diagramJsonSchema as unknown as Record<string, unknown>, diagramJsonSchema as unknown as Record<string, unknown>, [], schemaErrors);
  for (const error of schemaErrors) {
    fail(`${pathText(error.path) || 'o documento'}: ${error.message}.`, error.span);
  }

  const root = parsed.node;
  const style = prop(root, 'style');
  if (style?.kind === 'object') {
    const target = model.style as unknown as Record<string, string>;
    for (const [key, values] of Object.entries(STYLE_ENUMS) as [keyof typeof STYLE_ENUMS, readonly string[]][]) {
      const value = prop(style, key);
      if (value?.kind === 'string' && values.includes(value.value)) target[key] = value.value;
    }
  }

  const walk = (items: JsonNode[], parentId: ID | undefined): void => {
    for (const item of items) {
      if (item.kind !== 'object') continue;
      const idNode = prop(item, 'id');
      if (idNode?.kind !== 'string' || !idNode.value) continue;
      const id = idNode.value;
      if (id === RESERVED_NAME) {
        warn(`O nome "${id}" é reservado e foi ignorado.`, idNode.span);
        continue;
      }
      if (own(model.elements, id)) {
        warn(`O nome "${id}" aparece mais de uma vez; a repetição foi ignorada.`, idNode.span);
        continue;
      }
      const typeNode = prop(item, 'type');
      const isGroup = typeNode?.kind === 'string' && typeNode.value === 'group';
      const el: DiagramElement = isGroup ? { kind: 'group', id } : { kind: 'node', id };
      const frame = prop(item, 'canvasFrame');
      if (el.kind === 'group' && frame?.kind === 'boolean') el.canvasFrame = frame.value;
      if (parentId !== undefined) el.parentId = parentId;
      for (const key of STRING_PROPS) {
        const value = prop(item, key);
        if (value?.kind === 'string') el[key] = value.value;
      }
      const props = el as unknown as Record<string, string>;
      for (const [key, values] of Object.entries({ ...ENUM_PROPS, ...ELEMENT_ENUMS }) as [string, readonly string[]][]) {
        const value = prop(item, key);
        if (value?.kind === 'string' && values.includes(value.value)) props[key] = value.value;
      }
      if (el.kind === 'node') {
        const fields = prop(item, 'fields');
        if (fields?.kind === 'array') {
          const raw = fields.items.map(field => field.kind === 'object' ? Object.fromEntries(field.entries.map(entry => [entry.key, entry.value.kind === 'string' ? entry.value.value : null])) : null);
          if (validTableFields(raw)) el.fields = raw;
          else fail('Campos de tabela inválidos: cada campo precisa de um nome e uma chave PK/FK opcional.', fields.span);
        }
        const shape = prop(item, 'shape');
        if (shape?.kind === 'string' && (SHAPES as readonly string[]).includes(shape.value)) el.shape = shape.value as Shape;
      }
      model.elements[id] = el;
      model.order.push(id);
      const children = prop(item, 'children');
      if (isGroup && children?.kind === 'array') walk(children.items, id);
    }
  };
  const nodes = prop(root, 'nodes');
  if (nodes?.kind === 'array') walk(nodes.items, undefined);

  const connections = prop(root, 'connections');
  if (connections?.kind === 'array') {
    connections.items.forEach((item, index) => {
      if (item.kind !== 'object') return;
      const from = prop(item, 'from');
      const to = prop(item, 'to');
      if (from?.kind !== 'string' || to?.kind !== 'string' || !from.value || !to.value) return;
      if (!own(model.elements, from.value) || !own(model.elements, to.value)) {
        warn(`A conexão ${index + 1} ("${from.value}" → "${to.value}") aponta para um elemento que não existe; ela foi ignorada.`, item.span);
        return;
      }
      const typeNode = prop(item, 'type');
      const connector = typeNode?.kind === 'string' && (CONNECTORS as readonly string[]).includes(typeNode.value) ? (typeNode.value as Connector) : '>';
      const label = prop(item, 'label');
      const color = prop(item, 'color');
      const edge: EdgeEl = { id: '', from: from.value, to: to.value, connector };
      if (label?.kind === 'string') edge.label = label.value;
      if (color?.kind === 'string') edge.color = color.value;
      for (const key of ['fromPort', 'toPort'] as const) { const value = prop(item, key); if (value?.kind === 'string' && (PORTS as readonly string[]).includes(value.value)) edge[key] = value.value as typeof PORTS[number]; }
      for (const key of ['fromCardinality', 'toCardinality'] as const) { const value = prop(item, key); if (value?.kind === 'string' && (CARDINALITIES as readonly string[]).includes(value.value)) edge[key] = value.value as typeof CARDINALITIES[number]; }
      model.edges.push(edge);
    });
  }

  diagnostics.sort((a, b) => a.span.from - b.span.from || a.span.to - b.span.to);
  return { model: normalizeEdgeIds(model), diagnostics };
}
