import { describe, expect, it } from 'vitest';
import { importD2 } from './d2';
import { shopD2 } from '../fixtures/import';
import { expectValid, messages } from './testkit';

const fixture = shopD2;

describe('D2 importer', () => {
  it('imports edges, labels and connector kinds', () => {
    const { model } = importD2('a -> b: hello\nb <-> c\nc -- d\nd <- a\n');
    expect(model.edges.map((e) => [e.from, e.to, e.connector, e.label])).toEqual([
      ['a', 'b', '>', 'hello'], ['b', 'c', '<>', undefined], ['c', 'd', '-', undefined], ['d', 'a', '<', undefined],
    ]);
  });

  it('turns blocks into groups, resolves dotted paths and maps shapes', () => {
    const result = importD2(fixture);
    const { model } = result;
    expect(model.elements.backend?.kind).toBe('group');
    expect(model.elements['backend.api']).toMatchObject({ kind: 'node', parentId: 'backend', label: 'API Gateway' });
    expect(model.elements['backend.db']).toMatchObject({ shape: 'cylinder', label: 'Postgres' });
    expect(model.elements.web).toMatchObject({ shape: 'circle', label: 'Web App' });
    expect(model.style.direction).toBe('down');
    expect(model.edges.find((e) => e.to === 'backend.api')?.label).toBe('HTTPS');
    expect(model.elements['my store']).toBeDefined();
    expectValid(result);
  });

  it('warns once per ignored construct kind with its line', () => {
    const result = importD2('a\nb: { style: { fill: red } }\nc: { style: { stroke: blue } }\nclasses: { x: {} }\nd: { shape: sql_table\n id: int }\n');
    const styles = result.diagnostics.filter((d) => d.message.includes('style'));
    expect(styles).toHaveLength(1);
    expect(styles[0]!.line).toBe(2);
    expect(messages(result).some((m) => m.includes('classes') && m.includes('ignorad'))).toBe(true);
    expect(messages(result).some((m) => m.includes('sql_table') && m.includes('ignorad'))).toBe(true);
    expect(result.model.elements['d.id']).toBeUndefined();
  });

  it('ignores comments, quoted keys and semicolons', () => {
    const { model } = importD2('# c\n"x y": { p; q } # tail\n"x y".p -> "x y".q\n');
    expect(model.elements['x y']?.kind).toBe('group');
    expect(model.elements['x y.p']?.parentId).toBe('x y');
    expect(model.edges).toHaveLength(1);
  });

  it('warns about imports and layers', () => {
    const result = importD2('...@base\nlayers: { l: { a } }\nx\n');
    expect(messages(result).some((m) => m.includes('import') && m.includes('ignorad'))).toBe(true);
    expect(messages(result).some((m) => m.includes('layers'))).toBe(true);
    expect(result.model.elements.x).toBeDefined();
  });

  describe('hostile input', () => {
    it('accepts constructor/toString and refuses __proto__', () => {
      const result = importD2('constructor -> toString: x\n__proto__ -> a\n__proto__: { b }\n');
      expect(result.model.elements.constructor).toBeDefined();
      expect(result.model.edges).toHaveLength(1);
      expect(Object.keys(result.model.elements)).not.toContain('__proto__');
      expect(messages(result).some((m) => m.includes('__proto__'))).toBe(true);
      expectValid(result);
    });

    it('survives 500 nested containers', () => {
      const text = `${'a: {\n'.repeat(500)}leaf\n${'}\n'.repeat(500)}`;
      const result = importD2(text);
      expect(result.model.order.length).toBeGreaterThan(10);
      expect(messages(result).some((m) => m.includes('profundidade'))).toBe(true);
    });

    it('survives unbalanced braces, junk, long lines and huge fan-out', () => {
      for (const text of ['}}}}\n{{{{ a', '\u0000\u0001￿->->->', `a${'-'.repeat(200_000)}>b`, 'a: "unterminated', '|md\nnever closed', `${'x'.repeat(1_000_000)}`]) {
        expect(() => importD2(text)).not.toThrow();
      }
      const fan = Array.from({ length: 6000 }, (_, i) => `hub -> n${i}`).join('\n');
      const result = importD2(fan);
      expect(result.model.order.length).toBeLessThanOrEqual(2000);
      expect(messages(result).some((m) => m.includes('Limite'))).toBe(true);
    });

    it('refuses input over the size limit', () => {
      const result = importD2(`a -> b\n${'#'.repeat(2_000_001)}`);
      expect(result.model.order).toEqual([]);
      expect(messages(result)[0]).toContain('grande demais');
    });
  });
});
