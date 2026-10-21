import { semanticView } from '@strukt/core';
import { parseDsl, printDsl } from '@strukt/dsl';
import { describe, expect, it } from 'vitest';
import { exampleSnapshot } from './example';

describe('example diagram as DSL', () => {
  it('prints Eraser-compatible code that parses back to the same diagram', () => {
    const { model } = exampleSnapshot();
    const text = printDsl(model);
    expect(text).toContain('Frontend [icon: monitor-smartphone, color: blue] {');
    expect(text).toContain('Pedidos --> Kafka: eventos');
    const parsed = parseDsl(text);
    expect(parsed.diagnostics).toEqual([]);
    expect(semanticView(parsed.model)).toEqual(semanticView(model));
  });
});
