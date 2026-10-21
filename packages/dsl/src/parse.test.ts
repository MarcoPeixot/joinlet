import { applyOps, diffModels, emptyModel, own } from '@strukt/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseDsl } from './parse';

const clean = (text: string) => {
  const result = parseDsl(text);
  expect(result.diagnostics).toEqual([]);
  return result.model;
};

describe('parseDsl — elements', () => {
  it('reads nodes with multi-word names and properties', () => {
    const m = clean('API gateway [icon: aws-api-gateway, color: blue]\nDB [shape: cylinder, label: "Main DB"]\n');
    expect(m.order).toEqual(['API gateway', 'DB']);
    expect(m.elements['API gateway']).toMatchObject({ kind: 'node', icon: 'aws-api-gateway', color: 'blue' });
    expect(m.elements.DB).toMatchObject({ shape: 'cylinder', label: 'Main DB' });
  });

  it('nests groups, with children separated by newlines or commas', () => {
    const m = clean('VPC [color: blue] {\n  Main Server {\n    Server, Data\n  }\n  Queue\n}\n');
    expect(m.elements.VPC).toMatchObject({ kind: 'group', color: 'blue' });
    expect(m.elements['Main Server']).toMatchObject({ kind: 'group', parentId: 'VPC' });
    expect(m.elements.Server?.parentId).toBe('Main Server');
    expect(m.elements.Data?.parentId).toBe('Main Server');
    expect(m.elements.Queue?.parentId).toBe('VPC');
    expect(m.order).toEqual(['VPC', 'Main Server', 'Server', 'Data', 'Queue']);
  });

  it('accepts `{` glued to props, empty groups and one-line groups', () => {
    const m = clean('Plane [icon: k8s-control-plane]{\n  api\n}\nEmpty {}\nLoop { A, B }\n');
    expect(m.elements.api?.parentId).toBe('Plane');
    expect(m.elements.Empty?.kind).toBe('group');
    expect(m.elements.B?.parentId).toBe('Loop');
  });

  it('keeps hyphens and slashes inside names, quotes reserved characters', () => {
    const m = clean('k8s-api\nPub/Sub\n"https://localhost:8080" [icon: globe]\n"say \\"hi\\""\n');
    expect(m.order).toEqual(['k8s-api', 'Pub/Sub', 'https://localhost:8080', 'say "hi"']);
  });

  it('reads Joinlet extensions and unescapes quoted values', () => {
    const m = clean('Pedidos [tech: Node.js, description: "Recebe pedidos\\nValida estoque", link: "https://x.io/a"]');
    expect(m.elements.Pedidos).toMatchObject({ tech: 'Node.js', description: 'Recebe pedidos\nValida estoque', link: 'https://x.io/a' });
  });

  it('applies style statements anywhere and ignores comments', () => {
    const m = clean('// arquitetura\nA\ndirection down\ncolorMode bold // forte\nstyleMode watercolor\ntypeface mono\n');
    expect(m.style).toEqual({ direction: 'down', colorMode: 'bold', styleMode: 'watercolor', typeface: 'mono' });
    expect(m.order).toEqual(['A']);
  });

  it('merges later mentions and moves members listed inside a group declared afterwards', () => {
    const m = clean('Start [shape: oval] > Read\nRead > End\nEnd [icon: check]\nLoop [icon: repeat] {\n  Read\n}\n');
    expect(m.elements.End).toMatchObject({ icon: 'check' });
    expect(m.elements.Read?.parentId).toBe('Loop');
    expect(m.elements.Start).toMatchObject({ shape: 'oval' });
    expect(m.elements.Start?.parentId).toBeUndefined();
  });

  it('records spans for elements', () => {
    const m = clean('A\n  Beta [icon: x]');
    expect(m.elements.Beta?.span).toEqual({ from: 4, to: 8 });
  });

  it('treats non-breaking spaces as whitespace, same as plain spaces', () => {
    const plain = clean('A > B\n  Beta [icon: x]\n');
    const nbsp = clean('A > B\n  Beta [icon: x]\n');
    expect(nbsp).toEqual(plain);
  });
});

describe('parseDsl — connections', () => {
  it('supports every connector with stable edge ids', () => {
    const m = clean('A > B\nA < B\nA <> B\nA - B\nA -- B\nA --> B\n');
    expect(m.edges.map((e) => e.connector)).toEqual(['>', '<', '<>', '-', '--', '-->']);
    expect(m.edges.map((e) => e.id)).toEqual(['A→B', 'A→B#2', 'A→B#3', 'A→B#4', 'A→B#5', 'A→B#6']);
  });

  it('chains, fans out and fans in', () => {
    const m = clean('A > B > C\nC > D, E\nD, E > F\n');
    expect(m.edges.map((e) => e.id)).toEqual(['A→B', 'B→C', 'C→D', 'C→E', 'D→F', 'E→F']);
    expect(m.order).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('reads labels, edge colors and endpoint props', () => {
    const m = clean('Storage > Server: Cache Hit [color: green]\nA > B: [color: "#ff0000"]\nX > Y [icon: bug]: Yes\n');
    expect(m.edges[0]).toMatchObject({ from: 'Storage', to: 'Server', label: 'Cache Hit', color: 'green' });
    expect(m.edges[1]).toMatchObject({ color: '#ff0000' });
    expect(m.edges[1]?.label).toBeUndefined();
    expect(m.edges[2]).toMatchObject({ label: 'Yes' });
    expect(m.elements.Y).toMatchObject({ icon: 'bug' });
  });

  it('creates undefined names inside the enclosing group', () => {
    const m = clean('G {\n  A > B\n}\nC > A\n');
    expect(m.elements.B?.parentId).toBe('G');
    expect(m.elements.C?.parentId).toBeUndefined();
    expect(m.elements.A?.parentId).toBe('G');
  });

  it('separates names from connectors by spacing rules', () => {
    const m = clean('front-end - back-end\nA-->B\n');
    expect(m.edges.map((e) => [e.from, e.connector, e.to])).toEqual([['front-end', '-', 'back-end'], ['A', '-->', 'B']]);
  });
});

describe('parseDsl — diagnostics', () => {
  it('warns about unknown properties with a suggestion', () => {
    const { diagnostics, model } = parseDsl('A [colour: blue, shape: circl]');
    expect(diagnostics.map((d) => [d.severity, d.message])).toEqual([
      ['warning', 'Propriedade desconhecida "colour". Você quis dizer "color"?'],
      ['warning', 'Valor inválido para shape: "circl". Você quis dizer "circle"?'],
    ]);
    expect(diagnostics[0]).toMatchObject({ line: 1, column: 4, span: { from: 3, to: 9 } });
    expect(model.elements.A).toEqual({ kind: 'node', id: 'A', span: { from: 0, to: 1 } });
  });

  it('recovers per line and reports line/column', () => {
    const { diagnostics, model } = parseDsl('A > \nB [icon: x\nC -> D\nE\n');
    expect(diagnostics.map((d) => [d.line, d.column, d.message])).toEqual([
      [1, 5, 'Esperava um nome.'],
      [2, 3, 'Falta fechar "]".'],
      [3, 3, 'Conector inválido "->". Use ">" ou "-->".'],
    ]);
    expect(model.elements.E).toBeDefined();
  });

  it('reports unclosed groups, stray braces and self connections', () => {
    expect(parseDsl('G {\n  A\n').diagnostics.map((d) => d.message)).toEqual(['Falta fechar "}" do grupo "G".']);
    expect(parseDsl('}\nA').diagnostics.map((d) => d.message)).toEqual(['Chave "}" sem grupo aberto.']);
    expect(parseDsl('A > A').diagnostics.map((d) => d.message)).toEqual(['Uma conexão precisa ligar dois elementos diferentes.']);
  });

  it('rejects labels outside connections and trailing garbage', () => {
    expect(parseDsl('A: nope').diagnostics[0]?.message).toBe('Rótulo com ":" só é permitido em conexões.');
    expect(parseDsl('A [icon: x] B').diagnostics[0]?.message).toBe('Texto inesperado: "B".');
  });

  it('warns about invalid style values', () => {
    const { diagnostics, model } = parseDsl('direction dwn');
    expect(diagnostics[0]).toMatchObject({ severity: 'warning', message: 'Valor inválido para direction: "dwn". Você quis dizer "down"?' });
    expect(model.style.direction).toBe('right');
  });
});

describe('parseDsl — robustness', () => {
  it('never throws, and error-free results always satisfy core invariants', () => {
    const unit = fc.constantFrom(...'ab -><>[]{}:,"\\/\n\t'.split(''), 'icon', 'shape: oval', 'direction down');
    fc.assert(
      fc.property(fc.string({ unit, maxLength: 60 }), (text) => {
        const { model, diagnostics } = parseDsl(text);
        if (diagnostics.some((d) => d.severity === 'error')) return;
        expect(applyOps(emptyModel(), diffModels(emptyModel(), model)).ok).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });
});

describe('parseDsl — names that collide with Object.prototype', () => {
  it('rejects "__proto__" with a diagnostic and never touches Object.prototype', () => {
    const { model, diagnostics } = parseDsl('API\n__proto__ [label: hacked, color: red]\n"__proto__" > API\n');
    expect(diagnostics.map((d) => [d.severity, d.message, d.line])).toEqual([
      ['error', 'O nome "__proto__" é reservado.', 2],
      ['error', 'O nome "__proto__" é reservado.', 3],
    ]);
    expect(model.order).toEqual(['API']);
    expect(model.edges).toEqual([]);
    expect(['label', 'color'].filter((key) => key in {})).toEqual([]);
  });

  it('reads "constructor", "toString" and friends as ordinary names', () => {
    const m = clean('toString {\n  valueOf\n}\nconstructor [label: Construtor] > API\n');
    expect(m.order).toEqual(['toString', 'valueOf', 'constructor', 'API']);
    expect(own(m.elements, 'constructor')).toMatchObject({ kind: 'node', id: 'constructor', label: 'Construtor' });
    expect(own(m.elements, 'valueOf')?.parentId).toBe('toString');
    expect(m.edges.map((e) => e.id)).toEqual(['constructor→API']);
    const applied = applyOps(emptyModel(), diffModels(emptyModel(), m));
    expect(applied.ok).toBe(true);
  });
});
