import { describe, expect, it } from 'vitest';
import { MAX_JSON_DEPTH, parseJsonText, positionOf } from './parseJson';

describe('parseJsonText', () => {
  it('parses values with spans', () => {
    const { node, error, duplicateKeys } = parseJsonText('{"a": [1, true, null, "x"], "b": {}}');
    expect(error).toBeNull();
    expect(duplicateKeys).toEqual([]);
    const root = node as { kind: string; entries: { key: string; keySpan: { from: number; to: number }; value: { kind: string; items: { kind: string; span: { from: number; to: number } }[] } }[] };
    expect(root.kind).toBe('object');
    expect(root.entries[0]!.key).toBe('a');
    expect(root.entries[0]!.keySpan).toEqual({ from: 1, to: 4 });
    const a = root.entries[0]!.value;
    expect(a.kind).toBe('array');
    expect(a.items.map((item) => item.kind)).toEqual(['number', 'boolean', 'null', 'string']);
    expect(a.items[0]!.span).toEqual({ from: 7, to: 8 });
  });

  it('keeps the last value of a repeated key and reports it', () => {
    const { node, duplicateKeys } = parseJsonText('{"a": 1, "a": 2}');
    expect(duplicateKeys).toEqual([{ key: 'a', span: { from: 9, to: 12 } }]);
    expect(node).toMatchObject({ entries: [{ key: 'a', value: { kind: 'number', value: 2 } }] });
  });

  it('reports syntax errors with the failing index', () => {
    expect(parseJsonText('{"a":}').error).toEqual({ message: 'Caractere inesperado "}".', index: 5 });
    expect(parseJsonText('{"a": 1').error?.message).toBe('Esperava "," ou "}".');
    expect(parseJsonText('"abc').error).toEqual({ message: 'A string não foi fechada.', index: 0 });
    expect(parseJsonText('{"a": 1} extra').error).toEqual({ message: 'Conteúdo extra depois do JSON.', index: 9 });
    expect(parseJsonText('').error).toEqual({ message: 'O JSON termina antes do valor.', index: 0 });
    expect(parseJsonText('nul').error?.message).toBe('Caractere inesperado "n".');
  });

  it('rejects invalid numbers and non-finite values', () => {
    expect(parseJsonText('01').error?.message).toBe('Conteúdo extra depois do JSON.');
    expect(parseJsonText('1e999').error?.message).toBe('Número inválido.');
    expect(parseJsonText('-0.5e-3').node).toMatchObject({ kind: 'number', value: -0.0005 });
  });

  it('accepts escapes and rejects control characters', () => {
    expect(parseJsonText('"a\\n\\u00e9\\"b"').node).toMatchObject({ kind: 'string', value: 'a\né"b' });
    expect(parseJsonText('"a\u0001b"').error?.message).toBe('Controle inválido dentro da string.');
    expect(parseJsonText('"\\x"').error?.message).toBe('Escape "\\x" inválido.');
  });

  it('refuses deeply nested documents', () => {
    const text = `${'['.repeat(MAX_JSON_DEPTH + 2)}${']'.repeat(MAX_JSON_DEPTH + 2)}`;
    expect(parseJsonText(text).error?.message).toBe('O JSON está aninhado demais.');
  });

  it('computes line and column from an index', () => {
    expect(positionOf('ab\ncd', 0)).toEqual({ line: 1, column: 1 });
    expect(positionOf('ab\ncd', 3)).toEqual({ line: 2, column: 1 });
    expect(positionOf('ab\ncd', 99)).toEqual({ line: 2, column: 3 });
  });
});
