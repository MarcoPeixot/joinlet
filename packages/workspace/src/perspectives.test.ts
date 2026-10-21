import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PERSPECTIVES, allPerspectives, isBuiltinPerspective, newPerspectiveId,
  perspectivesPath, printPerspectives, renamePerspectiveNodes,
} from './perspectives';
import type { Perspective } from './perspectives';
import { PERSPECTIVE_LIMITS, parsePerspectives } from './perspectivesParse';

const sample: Perspective = {
  id: 'riscos', name: 'Riscos altos', description: 'O que pode quebrar', tags: ['risco:alto', 'ambiente:produção'], levels: ['container'],
  include: ['API'], hide: ['Legado'], collapsed: ['Plataforma'], mode: 'dim', collapse: true,
};

describe('perspectives file', () => {
  it('lives next to the diagram', () => {
    expect(perspectivesPath('visao-geral')).toBe('diagrams/visao-geral.perspectives.json');
  });

  it('round trips, in a canonical order', () => {
    const text = printPerspectives([sample]);
    expect(JSON.parse(text)).toEqual({ version: 1, perspectives: [sample] });
    expect(parsePerspectives(text)).toEqual([sample]);
    expect(printPerspectives(parsePerspectives(text))).toBe(text);
  });

  it('accepts a bare list, as the flows file is', () => {
    expect(parsePerspectives(JSON.stringify([{ id: 'a', name: 'A' }]))).toEqual([{ id: 'a', name: 'A' }]);
  });

  it('is tolerant: broken text, wrong shapes and bad items give what can be kept', () => {
    expect(parsePerspectives(null)).toEqual([]);
    expect(parsePerspectives('{')).toEqual([]);
    expect(parsePerspectives('42')).toEqual([]);
    expect(parsePerspectives('{"version":1,"perspectives":"x"}')).toEqual([]);
    const parsed = parsePerspectives(JSON.stringify({ version: 1, perspectives: [
      null, 7, 'x', { name: 'sem id' }, { id: '../x', name: 'ruim' }, { id: '__proto__', name: 'proto' },
      { id: 'ok', name: '  Bom  ', mode: 'nada', collapse: 'sim', tags: ['risco:alto', 'sem-dois-pontos', 3, 'risco:alto', 'a:b:c'], levels: ['container', 'quarto', 'container'], include: ['A', 3, '__proto__', 'A'], hide: 'x' },
      { id: 'OK', name: 'duplicado pelo id minúsculo' },
      { id: 'vazio', name: '   ' },
    ] }));
    expect(parsed).toEqual([
      { id: 'ok', name: 'Bom', tags: ['risco:alto'], levels: ['container'], include: ['A'] },
      { id: 'vazio', name: 'vazio' },
    ]);
  });

  it('never lets an id become a prototype key', () => {
    const parsed = parsePerspectives('{"version":1,"perspectives":[{"id":"__proto__","name":"x"},{"id":"constructor","name":"c"}]}');
    expect(parsed.map((p) => p.id)).toEqual(['constructor']);
    expect(Object.getPrototypeOf(parsed[0])).toBe(Object.prototype);
  });

  it('caps sizes: perspectives, names, lists and the file itself', () => {
    const many = Array.from({ length: PERSPECTIVE_LIMITS.perspectives + 10 }, (_, i) => ({ id: `p${i}`, name: 'x'.repeat(500), description: 'd'.repeat(5000), include: Array.from({ length: PERSPECTIVE_LIMITS.nodes + 50 }, (_, j) => `n${j}`) }));
    const parsed = parsePerspectives(JSON.stringify({ version: 1, perspectives: many }));
    expect(parsed).toHaveLength(PERSPECTIVE_LIMITS.perspectives);
    expect(parsed[0]!.name).toHaveLength(PERSPECTIVE_LIMITS.name);
    expect(parsed[0]!.description).toHaveLength(PERSPECTIVE_LIMITS.description);
    expect(parsed[0]!.include).toHaveLength(PERSPECTIVE_LIMITS.nodes);
    expect(parsePerspectives(' '.repeat(PERSPECTIVE_LIMITS.bytes + 1))).toEqual([]);
  });

  it('reads back what it prints even when a list was left empty, as defaults', () => {
    const text = printPerspectives([{ id: 'a', name: 'A', tags: [], include: [], mode: 'hide', collapse: false }]);
    expect(parsePerspectives(text)).toEqual([{ id: 'a', name: 'A' }]);
  });
});

describe('built-in C4 perspectives', () => {
  it('are the three C4 views, by level', () => {
    expect(BUILTIN_PERSPECTIVES.map((p) => [p.id, p.name, p.levels])).toEqual([
      ['c4-contexto', 'C4: Contexto', ['contexto']],
      ['c4-containers', 'C4: Containers', ['contexto', 'container']],
      ['c4-componentes', 'C4: Componentes', ['container', 'componente']],
    ]);
    expect(BUILTIN_PERSPECTIVES[0]!.collapse).toBe(true);
    expect(isBuiltinPerspective('c4-contexto')).toBe(true);
    expect(isBuiltinPerspective('riscos')).toBe(false);
  });

  it('list after the saved ones, and a saved perspective with the same id wins', () => {
    const own: Perspective = { id: 'c4-contexto', name: 'Meu contexto', levels: ['contexto', 'container'] };
    const all = allPerspectives([sample, own]);
    expect(all.map((p) => p.id)).toEqual(['riscos', 'c4-contexto', 'c4-containers', 'c4-componentes']);
    expect(all[1]!.name).toBe('Meu contexto');
    expect(allPerspectives(undefined)).toEqual(BUILTIN_PERSPECTIVES);
  });
});

describe('ids and renames', () => {
  it('makes an id that is not taken', () => {
    expect(newPerspectiveId('Riscos altos', new Set())).toBe('riscos-altos');
    expect(newPerspectiveId('Riscos altos', new Set(['riscos-altos']))).toBe('riscos-altos-2');
    expect(newPerspectiveId('C4: Contexto', new Set(['c4-contexto']))).toBe('c4-contexto-2');
    expect(newPerspectiveId('???', new Set())).toBe('sem-titulo');
    expect(newPerspectiveId('x'.repeat(200), new Set())).toHaveLength(PERSPECTIVE_LIMITS.id);
  });

  it('follows a renamed element in every list', () => {
    const renamed = renamePerspectiveNodes([sample], 'API', 'Gateway');
    expect(renamed[0]!.include).toEqual(['Gateway']);
    expect(renamePerspectiveNodes([sample], 'Legado', 'Velho')[0]!.hide).toEqual(['Velho']);
    expect(renamePerspectiveNodes([sample], 'Plataforma', 'Core')[0]!.collapsed).toEqual(['Core']);
    const same = [sample];
    expect(renamePerspectiveNodes(same, 'Nada', 'X')).toBe(same);
  });
});
