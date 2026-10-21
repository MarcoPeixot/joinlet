import type { DiagramOp } from '@strukt/core';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { OP_KINDS, OP_SCHEMAS, TOOL_INPUT_SCHEMA, validateToolInput } from './schema';
import type { AiOp, JsonSchema } from './schema';

/** One valid op of every AI kind; the mapped type makes a missing or misspelled kind a compile error. */
const SAMPLES: { [K in AiOp['op']]: Extract<AiOp, { op: K }> } = {
  add_node: { op: 'add_node', id: 'Cache', description: 'Mantém respostas frequentes em cache.', label: 'Cache', parentId: 'Dados', shape: 'cylinder', icon: 'redis', color: 'red', tech: 'Redis 7' },
  add_group: { op: 'add_group', id: 'Dados', description: 'Camada de persistência.', label: 'Camada de dados', icon: 'database', color: 'green' },
  connect: { op: 'connect', from: 'API', to: 'Cache', connector: '-->', label: 'lê', color: 'blue' },
  insert_between: { op: 'insert_between', from: 'API', to: 'Cache', node: { id: 'Proxy', description: 'Encaminha requisições.', label: 'Proxy', icon: 'nginx', tech: 'Nginx' } },
  update: { op: 'update', id: 'API', set: { label: '', icon: 'server', shape: 'hexagon', colorMode: null, typeface: 'mono' } },
  update_edge: { op: 'update_edge', from: 'API', to: 'Proxy', nth: 1, set: { label: 'HTTP', color: '', connector: '<>' } },
  rename: { op: 'rename', id: 'Proxy', to: 'Borda' },
  move_to_group: { op: 'move_to_group', id: 'Borda', parentId: null },
  remove: { op: 'remove', id: 'Borda' },
  remove_edge: { op: 'remove_edge', from: 'API', to: 'Cache' },
  set_style: { op: 'set_style', set: { direction: 'down', colorMode: 'bold', styleMode: 'plain', typeface: 'clean' } },
};

/** Every DiagramOp kind the AI may use: all but the internal reorder. A new core kind must be listed here and in OP_SCHEMAS. */
const AI_KINDS: Record<Exclude<DiagramOp['op'], 'reorder'>, true> = {
  add_node: true, add_group: true, connect: true, insert_between: true, update: true, update_edge: true,
  rename: true, move_to_group: true, remove: true, remove_edge: true, set_style: true,
};

const forbidden = ['minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'pattern', 'format', 'oneOf', 'not', 'if', '$ref', 'maxItems', 'uniqueItems'];

function walk(schema: unknown, visit: (node: JsonSchema, path: string) => void, path = '#'): void {
  if (Array.isArray(schema)) schema.forEach((item, i) => walk(item, visit, `${path}/${i}`));
  else if (schema && typeof schema === 'object') {
    visit(schema as JsonSchema, path);
    for (const [key, value] of Object.entries(schema)) if (typeof value === 'object') walk(value, visit, `${path}/${key}`);
  }
}

describe('apply_diagram_ops schema', () => {
  it('covers every DiagramOp kind except the internal reorder', () => {
    expect([...OP_KINDS].sort()).toEqual(Object.keys(AI_KINDS).sort());
    expect(Object.keys(SAMPLES)).toEqual(OP_KINDS);
  });

  it('accepts one op of every kind, per op and as the whole tool input', () => {
    const all = Object.values(SAMPLES);
    expect(validateToolInput({ ops: all, summary: 'ok' })).toEqual({ ok: true, ops: all, summary: 'ok' });
    const whole = new Ajv({ allErrors: true }).compile(TOOL_INPUT_SCHEMA);
    expect(whole({ ops: all, summary: 'ok' }), JSON.stringify(whole.errors)).toBe(true);
  });

  it('rejects reorder, unknown kinds, extra fields, missing fields and bad enums with pt-BR messages', () => {
    expect(validateToolInput({ ops: [{ op: 'reorder', order: [] }], summary: '' })).toEqual({
      ok: false,
      error: `ops[0]: operação desconhecida "reorder". Use uma de: ${OP_KINDS.join(', ')}.`,
    });
    const bad = validateToolInput({
      ops: [
        { op: 'remove', id: 'A', force: true },
        { op: 'connect', from: 'A' },
        { op: 'add_node', id: 'B', shape: 'blob' },
        { op: 'remove_edge', edgeId: 'A→B' },
        { op: 'update_edge', from: 'A', to: 'B', nth: 1.5, set: {} },
      ],
      summary: '',
    });
    const lines = bad.ok ? [] : bad.error.split('\n');
    expect(lines[0]).toBe('ops[0] (remove): propriedade desconhecida "force".');
    expect(lines[1]).toBe('ops[1] (connect): falta "to".');
    expect(lines[2]).toMatch(/^ops\[2\] \(add_node\): \/shape deve ser um de: "rectangle", "cylinder"/);
    expect(lines[3]).toBe('ops[3] (remove_edge): falta "from"; falta "to"; propriedade desconhecida "edgeId".');
    expect(lines[4]).toMatch(/^ops\[4\] \(update_edge\): \/nth /);
    expect(validateToolInput({ ops: 'nope', summary: 'x' })).toEqual({ ok: false, error: 'A entrada precisa ser { "ops": [...], "summary": "..." }.' });
    const whole = new Ajv().compile(TOOL_INPUT_SCHEMA);
    expect(whole({ ops: [{ op: 'reorder', order: [] }], summary: 'x' })).toBe(false);
    expect(whole({ ops: [], summary: 'x', extra: 1 })).toBe(false);
  });

  it('only uses what strict tool use supports', () => {
    walk(TOOL_INPUT_SCHEMA, (node, path) => {
      for (const keyword of forbidden) expect(node, `${path} uses ${keyword}`).not.toHaveProperty(keyword);
      if (node.type === 'object') expect(node.additionalProperties, `${path}.additionalProperties`).toBe(false);
    });
    for (const kind of OP_KINDS) expect(OP_SCHEMAS[kind]).toMatchObject({ properties: { op: { const: kind } } });
  });
});
