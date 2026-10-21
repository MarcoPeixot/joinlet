import { describe, expect, it } from 'vitest';
import { importOpenApi } from './openapi';
import { petstoreYaml } from '../fixtures/import';
import { expectValid, messages } from './testkit';

const fixture = petstoreYaml;

describe('OpenAPI importer', () => {
  it('builds a service group with a group per tag and one node per operation', () => {
    const result = importOpenApi(fixture);
    const { model } = result;
    expect(model.elements['Loja de Pets']?.kind).toBe('group');
    expect(model.elements.pedidos).toMatchObject({ kind: 'group', parentId: 'Loja de Pets' });
    expect(model.elements['GET /pedidos']).toMatchObject({ kind: 'node', parentId: 'pedidos', tech: 'Lista pedidos' });
    expect(model.elements['POST /pedidos']?.parentId).toBe('pedidos');
    expect(model.elements['GET /estoque']?.parentId).toBe('estoque');
    expectValid(result);
  });

  it('warns about servers and external $ref, but not internal refs', () => {
    const result = importOpenApi(fixture);
    expect(messages(result).some((m) => m.includes('servers') && m.includes('ignorad'))).toBe(true);
    expect(result.diagnostics.filter((m) => m.message.includes('$ref'))).toHaveLength(1);
  });

  it('reads JSON and groups by path prefix when there are no tags', () => {
    const doc = { openapi: '3.1.0', info: { title: 'Svc' }, paths: { '/users': { get: {} }, '/users/{id}': { delete: {} }, '/': { get: {} } } };
    const { model } = importOpenApi(JSON.stringify(doc));
    expect(model.elements.users?.kind).toBe('group');
    expect(model.elements['GET /users']?.parentId).toBe('users');
    expect(model.elements['DELETE /users/{id}']?.parentId).toBe('users');
    expect(model.elements['GET /']).toBeDefined();
  });

  it('caps operations at 200 with a warning', () => {
    const paths: Record<string, unknown> = {};
    for (let i = 0; i < 300; i += 1) paths[`/p${i}`] = { get: {} };
    const result = importOpenApi(JSON.stringify({ openapi: '3.0.0', info: { title: 'Big' }, paths }));
    expect(Object.values(result.model.elements).filter((e) => e.kind === 'node')).toHaveLength(200);
    expect(messages(result).some((m) => m.includes('200'))).toBe(true);
  });

  it('warns when the text is not an OpenAPI document', () => {
    for (const text of ['just: some yaml', '[1,2]', '{', '']) {
      const result = importOpenApi(text);
      expect(result.model.order).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });

  describe('hostile input', () => {
    it('accepts constructor/toString and refuses __proto__ names', () => {
      const yaml = 'openapi: 3.0.0\ninfo: { title: constructor }\npaths:\n  /toString:\n    get: { tags: [__proto__] }\n    post: { tags: [constructor] }\n  __proto__:\n    get: {}\n';
      const result = importOpenApi(yaml);
      expect(result.model.elements.constructor).toBeDefined();
      expect(result.model.elements['POST /toString']).toBeDefined();
      expect(Object.keys(result.model.elements)).not.toContain('__proto__');
      expect(messages(result).some((m) => m.includes('__proto__'))).toBe(true);
      expectValid(result);
    });

    it('survives a YAML alias bomb', () => {
      const lines = ['a: &a [x,x,x,x,x,x,x,x,x]'];
      for (let i = 0; i < 12; i += 1) lines.push(`${String.fromCharCode(98 + i)}: &${String.fromCharCode(98 + i)} [${Array(9).fill(`*${String.fromCharCode(97 + i)}`).join(',')}]`);
      const result = importOpenApi(`openapi: 3.0.0\ninfo: {title: bomb}\npaths: {}\nx-bomb:\n${lines.map((l) => `  ${l}`).join('\n')}\n`);
      expect(result).toBeDefined();
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it('survives deep nesting, binary junk and long lines', () => {
      for (const text of ['['.repeat(100_000), `openapi: 3\n${'a:\n'.repeat(1)}${' '.repeat(10)}`, '\u0000\u0001\ufffe: [', `openapi: 3.0.0\ninfo: {title: "${'x'.repeat(1_000_000)}"}\n`, '{"a":'.repeat(50_000)]) {
        expect(() => importOpenApi(text)).not.toThrow();
      }
    });

    it('refuses input over the size limit', () => {
      const result = importOpenApi(`openapi: 3.0.0\n# ${'x'.repeat(2_000_001)}`);
      expect(result.model.order).toEqual([]);
      expect(messages(result)[0]).toContain('grande demais');
    });
  });
});
