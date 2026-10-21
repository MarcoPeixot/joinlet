import { CARDINALITIES, LAYOUT_ROLES, PRESENTATIONS, PORTS, COLOR_MODES, CONNECTORS, DIRECTIONS, SHAPES, STYLE_MODES, TYPEFACES } from '@strukt/core';
import type { DiagramOp, ID } from '@strukt/core';
import { Ajv } from 'ajv';
import type { ErrorObject, ValidateFunction } from 'ajv';

/** The subset of JSON Schema that strict tool use accepts (no numeric/string constraints, no recursion). */
export type JsonSchema = { [keyword: string]: unknown };

export const TOOL_NAME = 'apply_diagram_ops';

/** A connection that exists before the batch, by its ends as written in the DSL; `nth` picks among parallel ones (1 = first). */
export interface EdgeRef {
  from: ID;
  to: ID;
  nth?: number;
}

/**
 * What the AI may send: every DiagramOp except the internal `reorder`, with edges referenced by their ends
 * instead of ids (ids change inside a batch when an endpoint is renamed). diagram.ts resolves them.
 * Built from DiagramOp, so a new op kind in core is a compile error in OP_SCHEMAS until it gets a schema.
 */
export type AiOp =
  | Exclude<DiagramOp, { op: 'reorder' | 'update_edge' | 'remove_edge' }>
  | ({ op: 'update_edge'; set: Extract<DiagramOp, { op: 'update_edge' }>['set'] } & EdgeRef)
  | ({ op: 'remove_edge' } & EdgeRef);

const text = (description: string): JsonSchema => ({ type: 'string', description });
const choice = (values: readonly string[], description: string): JsonSchema => ({ type: 'string', enum: [...values], description });
/** Enum props are cleared with null (PropPatch); text props are cleared with "" (applyOps treats '' like null). */
const clearable = (values: readonly string[], description: string): JsonSchema => ({
  anyOf: [{ type: 'string', enum: [...values] }, { type: 'null' }],
  description: `${description} null remove a propriedade.`,
});

function object(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

function op(kind: AiOp['op'], description: string, properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { ...object({ op: { type: 'string', const: kind }, ...properties }, ['op', ...required]), description };
}

const FIELDS: JsonSchema = { type: 'array', description: 'Campos da tabela na ordem de exibição.', items: object({ name: text('Nome do campo.'), type: text('Tipo de dado.'), key: choice(['PK', 'FK'], 'Chave primária ou estrangeira.') }, ['name']) };

const ELEMENT_ID = text('Nome do elemento, exatamente como no diagrama (é o id; pode ter espaços).');
const NEW_ID = text('Nome do novo elemento (único no diagrama).');
const PARENT = text('Grupo que vai conter o elemento (nome de um grupo existente ou criado antes no lote).');
const LABEL = text('Rótulo exibido no lugar do nome.');
const ICON = text('Ícone: aws-*, gcp-*, azure-*, k8s-*, marca (redis, postgresql, kafka, react) ou genérico (server, database, user).');
const COLOR = text('Cor da paleta (blue, green, purple, red, orange, yellow, black, white) ou hex.');
const DESCRIPTION = text('Descrição das responsabilidades do elemento.');
const TECH = text('Tecnologia (ex.: "Node.js 22", "PostgreSQL 16").');
const EDGE_FROM = text('Origem de uma conexão que já existe, com o nome como está em <diagrama> (antes do lote).');
const EDGE_TO = text('Destino dessa conexão, com o nome como está em <diagrama> (antes do lote).');
const NTH = { type: 'integer', description: 'Qual das conexões repetidas entre as mesmas pontas, na ordem do código: 1 (padrão) é a primeira.' };

/** One JSON Schema per AI op kind. The Record type makes a missing kind a compile error. */
export const OP_SCHEMAS: Record<AiOp['op'], JsonSchema> = {
  add_node: op('add_node', 'Cria um nó.', {
    id: NEW_ID, description: DESCRIPTION, label: LABEL, parentId: PARENT, fields: FIELDS, shape: choice(SHAPES, 'Forma do nó.'), presentation: choice(PRESENTATIONS, 'Apresentação da cena.'), layoutRole: choice(LAYOUT_ROLES, 'Papel na composição: entrada, par ou infraestrutura compartilhada.'), icon: ICON, color: COLOR, tech: TECH,
  }, ['id']),
  add_group: op('add_group', 'Cria um grupo (container).', {
    canvasFrame: { type: 'boolean', description: 'true cria uma área nomeada para um diagrama independente no mesmo canvas.' }, id: NEW_ID, description: DESCRIPTION, label: LABEL, parentId: PARENT, icon: ICON, color: COLOR }, ['id']),
  connect: op('connect', 'Cria uma conexão de "from" para "to"; seta, rótulo e cor de conexões novas vão aqui.', {
    from: ELEMENT_ID, to: ELEMENT_ID, connector: choice(CONNECTORS, 'Tipo de seta; padrão ">".'), label: text('Rótulo da conexão.'), color: COLOR, fromPort: choice(PORTS, 'Lado de saída.'), toPort: choice(PORTS, 'Lado de entrada.'), fromCardinality: choice(CARDINALITIES, 'Cardinalidade da origem.'), toCardinality: choice(CARDINALITIES, 'Cardinalidade do destino.'),
  }, ['from', 'to']),
  insert_between: op('insert_between', 'Troca a conexão from→to (a primeira, se houver repetidas) por from→node→to, criando o nó novo e mantendo seta, rótulo e cor.', {
    from: ELEMENT_ID,
    to: ELEMENT_ID,
    node: object({ id: NEW_ID, description: DESCRIPTION, label: LABEL, icon: ICON, tech: TECH }, ['id']),
  }, ['from', 'to', 'node']),
  update: op('update', 'Altera propriedades de um nó ou grupo.', {
    id: ELEMENT_ID,
    set: object({ canvasFrame: { anyOf: [{ type: 'boolean' }, { type: 'null' }], description: 'Somente grupos: marca uma área de diagrama do canvas.' },
      fields: { anyOf: [FIELDS, { type: 'null' }], description: 'Campos da tabela; null remove.' },
      label: text('Novo rótulo; "" remove.'),
      icon: text('Novo ícone; "" remove.'),
      color: text('Nova cor; "" remove.'),
      link: text('URL; "" remove.'),
      tech: text('Tecnologia; "" remove.'),
      description: text('Descrição/responsabilidades; "" remove.'),
      shape: clearable(SHAPES, 'Forma (só nós).'), presentation: clearable(PRESENTATIONS, 'Apresentação.'), layoutRole: clearable(LAYOUT_ROLES, 'Papel na composição.'),
      colorMode: clearable(COLOR_MODES, 'Modo de cor do elemento.'),
      styleMode: clearable(STYLE_MODES, 'Estilo do elemento.'),
      typeface: clearable(TYPEFACES, 'Fonte do elemento.'),
    }),
  }, ['id', 'set']),
  update_edge: op('update_edge', 'Altera uma conexão que já existe no diagrama.', {
    from: EDGE_FROM,
    to: EDGE_TO,
    nth: NTH,
    set: object({ label: text('Rótulo; "" remove.'), color: text('Cor; "" remove.'), connector: choice(CONNECTORS, 'Tipo de seta.'), fromPort: clearable(PORTS, 'Saída.'), toPort: clearable(PORTS, 'Entrada.'), fromCardinality: clearable(CARDINALITIES, 'Cardinalidade da origem.'), toCardinality: clearable(CARDINALITIES, 'Cardinalidade do destino.') }),
  }, ['from', 'to', 'set']),
  rename: op('rename', 'Renomeia um elemento (mantém posição e conexões).', { id: ELEMENT_ID, to: NEW_ID }, ['id', 'to']),
  move_to_group: op('move_to_group', 'Move um elemento para um grupo; parentId null tira do grupo.', {
    id: ELEMENT_ID,
    parentId: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Grupo de destino, ou null para o nível raiz.' },
  }, ['id', 'parentId']),
  remove: op('remove', 'Remove um elemento, seus filhos e suas conexões.', { id: ELEMENT_ID }, ['id']),
  remove_edge: op('remove_edge', 'Remove uma conexão que já existe no diagrama.', { from: EDGE_FROM, to: EDGE_TO, nth: NTH }, ['from', 'to']),
  set_style: op('set_style', 'Muda o estilo do diagrama inteiro.', {
    set: object({
      direction: choice(DIRECTIONS, 'Direção do fluxo.'),
      colorMode: choice(COLOR_MODES, 'Modo de cor.'),
      styleMode: choice(STYLE_MODES, 'Estilo.'),
      typeface: choice(TYPEFACES, 'Fonte.'),
    }),
  }, ['set']),
};

export const OP_KINDS = Object.keys(OP_SCHEMAS) as AiOp['op'][];

/** input_schema of the apply_diagram_ops tool (sent with strict: true). Built once: byte-stable for prompt caching. */
export const TOOL_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    ops: {
      type: 'array',
      description: 'Lote de operações, aplicado em ordem e de forma atômica (um erro rejeita o lote inteiro).',
      items: { anyOf: OP_KINDS.map((kind) => OP_SCHEMAS[kind]) },
    },
    summary: { type: 'string', description: 'Uma ou duas frases em português do Brasil explicando a mudança.' },
  },
  required: ['ops', 'summary'],
  additionalProperties: false,
};

export type ToolInputCheck = { ok: true; ops: AiOp[]; summary: string } | { ok: false; error: string };

const ajv = new Ajv({ allErrors: true });
const opValidators = Object.fromEntries(OP_KINDS.map((kind) => [kind, ajv.compile(OP_SCHEMAS[kind])])) as Record<AiOp['op'], ValidateFunction>;

function describe(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((e) => {
      if (e.keyword === 'additionalProperties') return `propriedade desconhecida "${String(e.params.additionalProperty)}"${e.instancePath ? ` em ${e.instancePath}` : ''}`;
      if (e.keyword === 'required') return `falta "${String(e.params.missingProperty)}"${e.instancePath ? ` em ${e.instancePath}` : ''}`;
      if (e.keyword === 'enum') return `${e.instancePath} deve ser um de: ${(e.params.allowedValues as string[]).map((v) => `"${v}"`).join(', ')}`;
      return `${e.instancePath || 'valor'} ${e.message ?? 'inválido'}`;
    })
    .join('; ');
}

/** Checks a tool input op by op, so the repair message points at the exact op and field. */
export function validateToolInput(input: unknown): ToolInputCheck {
  const value = input as { ops?: unknown; summary?: unknown } | null;
  if (!value || typeof value !== 'object' || !Array.isArray(value.ops) || typeof value.summary !== 'string') {
    return { ok: false, error: 'A entrada precisa ser { "ops": [...], "summary": "..." }.' };
  }
  const problems: string[] = [];
  value.ops.forEach((item: unknown, index) => {
    const kind = (item as { op?: unknown } | null)?.op;
    const check = typeof kind === 'string' && Object.hasOwn(opValidators, kind) ? opValidators[kind as AiOp['op']] : undefined;
    if (!check) {
      problems.push(`ops[${index}]: operação desconhecida "${String(kind)}". Use uma de: ${OP_KINDS.join(', ')}.`);
    } else if (!check(item)) {
      problems.push(`ops[${index}] (${String(kind)}): ${describe(check.errors)}.`);
    }
  });
  if (problems.length) return { ok: false, error: problems.join('\n') };
  return { ok: true, ops: value.ops as AiOp[], summary: value.summary };
}
