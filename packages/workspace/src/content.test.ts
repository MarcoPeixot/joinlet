import { describe, expect, it } from 'vitest';
import { defaultDoc, docExcerpt, emptySketch, markdownTitle, sketchElementCount } from './content';

describe('content helpers', () => {
  it('creates an empty .excalidraw scene', () => {
    const scene = JSON.parse(emptySketch());
    expect(scene).toMatchObject({ type: 'excalidraw', version: 2, source: 'strukt', elements: [], files: {} });
    expect(sketchElementCount(emptySketch())).toBe(0);
  });

  it('counts visible sketch elements and survives broken files', () => {
    const text = JSON.stringify({ elements: [{ id: 'a' }, { id: 'b', isDeleted: true }, { id: 'c' }] });
    expect(sketchElementCount(text)).toBe(2);
    expect(sketchElementCount('nope')).toBe(0);
  });

  it('takes a doc title from the first level-1 heading', () => {
    expect(markdownTitle('Intro\n\n# Arquitetura da Loja #\n\n## Visão geral\n')).toBe('Arquitetura da Loja');
    expect(markdownTitle('## Só subtítulo\n')).toBeNull();
  });

  it('starts docs with their title and cuts excerpts at a line break', () => {
    expect(defaultDoc('API')).toBe('# API\n\n');
    expect(docExcerpt('curto')).toBe('curto');
    expect(docExcerpt('linha um\nlinha dois\nlinha três', 15)).toBe('linha um');
  });
});
