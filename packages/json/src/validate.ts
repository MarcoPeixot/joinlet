import type { Span } from '@strukt/core';
import type { JsonNode } from './parseJson';

export interface SchemaError {
  path: (string | number)[];
  message: string;
  span: Span;
}

type Schema = Record<string, unknown>;

/** The `path` as written in messages: `nodes[2].color`. */
export function pathText(path: readonly (string | number)[]): string {
  return path.map((part, i) => (typeof part === 'number' ? `[${part}]` : `${i ? '.' : ''}${part}`)).join('');
}

const TYPE_LABEL: Record<string, string> = {
  object: 'um objeto',
  array: 'uma lista',
  string: 'texto',
  number: 'número',
  boolean: 'booleano',
  null: 'null',
};

function resolve(schema: Schema, root: Schema): Schema {
  const ref = schema.$ref;
  if (typeof ref !== 'string') return schema;
  const name = ref.replace(/^#\/\$defs\//, '');
  const defs = (root.$defs ?? {}) as Record<string, Schema>;
  return Object.hasOwn(defs, name) ? defs[name]! : schema;
}

function literal(node: JsonNode): string | number | boolean | null | undefined {
  if (node.kind === 'string' || node.kind === 'number' || node.kind === 'boolean') return node.value;
  if (node.kind === 'null') return null;
  return undefined;
}

/**
 * Validates a parsed JSON node against the subset of JSON Schema the diagram schema uses
 * (`$ref`, `type`, `properties`, `additionalProperties: false`, `required`, `enum`, `const`,
 * `anyOf`, `items`, `minLength`). Errors carry the full path and the span to point at.
 */
export function validateNode(node: JsonNode, schema: Schema, root: Schema, path: (string | number)[], errors: SchemaError[]): boolean {
  const resolved = resolve(schema, root);
  if (Array.isArray(resolved.anyOf)) {
    const branches = resolved.anyOf as Schema[];
    const attempts = branches.map((branch) => {
      const branchErrors: SchemaError[] = [];
      const ok = validateNode(node, branch, root, path, branchErrors);
      return { ok, branchErrors };
    });
    if (attempts.some((attempt) => attempt.ok)) return true;
    const best = attempts.reduce((a, b) => (b.branchErrors.length < a.branchErrors.length ? b : a));
    errors.push(...best.branchErrors);
    return false;
  }

  const type = typeof resolved.type === 'string' ? resolved.type : undefined;
  if (type && node.kind !== type) {
    errors.push({ path, message: `deve ser ${TYPE_LABEL[type] ?? type}`, span: node.span });
    return false;
  }
  if (resolved.const !== undefined) {
    const value = literal(node);
    if (value === undefined || value !== resolved.const) {
      errors.push({ path, message: `deve ser ${JSON.stringify(resolved.const)}`, span: node.span });
      return false;
    }
  }
  if (Array.isArray(resolved.enum)) {
    const value = literal(node);
    if (value === undefined || !(resolved.enum as unknown[]).includes(value)) {
      errors.push({ path, message: `deve ser um de: ${(resolved.enum as string[]).map((v) => `"${v}"`).join(', ')}`, span: node.span });
      return false;
    }
  }
  if (typeof resolved.minLength === 'number' && node.kind === 'string' && node.value.length < resolved.minLength) {
    errors.push({ path, message: 'não pode ser vazio', span: node.span });
    return false;
  }

  let ok = true;
  if (node.kind === 'object') {
    const properties = (resolved.properties ?? {}) as Record<string, Schema>;
    for (const required of (resolved.required ?? []) as string[]) {
      if (!node.entries.some((entry) => entry.key === required)) {
        errors.push({ path, message: `falta "${required}"`, span: node.span });
        ok = false;
      }
    }
    for (const entry of node.entries) {
      const child = Object.hasOwn(properties, entry.key) ? properties[entry.key] : undefined;
      if (child) {
        if (!validateNode(entry.value, child, root, [...path, entry.key], errors)) ok = false;
      } else if (resolved.additionalProperties === false) {
        errors.push({ path: [...path, entry.key], message: `propriedade desconhecida "${entry.key}"`, span: entry.keySpan });
        ok = false;
      }
    }
  }
  if (node.kind === 'array' && resolved.items) {
    node.items.forEach((item, index) => {
      if (!validateNode(item, resolved.items as Schema, root, [...path, index], errors)) ok = false;
    });
  }
  return ok;
}
