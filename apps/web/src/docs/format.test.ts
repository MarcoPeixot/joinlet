import { describe, expect, it } from 'vitest';
import { applyFormat } from './format';

const run = (text: string, from: number, to: number, kind: Parameters<typeof applyFormat>[3]) => {
  const r = applyFormat(text, from, to, kind);
  return { text: r.text, selected: r.text.slice(r.selStart, r.selEnd) };
};

describe('applyFormat', () => {
  it('wraps the selection', () => {
    expect(run('uma palavra aqui', 4, 11, 'bold')).toEqual({ text: 'uma **palavra** aqui', selected: 'palavra' });
    expect(run('uma palavra aqui', 4, 11, 'italic').text).toBe('uma _palavra_ aqui');
    expect(run('uma palavra aqui', 4, 11, 'code').text).toBe('uma `palavra` aqui');
  });

  it('toggles: unwraps markers around or inside the selection', () => {
    expect(run('uma **palavra** aqui', 6, 13, 'bold')).toEqual({ text: 'uma palavra aqui', selected: 'palavra' });
    expect(run('uma **palavra** aqui', 4, 15, 'bold')).toEqual({ text: 'uma palavra aqui', selected: 'palavra' });
  });

  it('inserts a selected placeholder when nothing is selected', () => {
    expect(run('ab', 1, 1, 'bold')).toEqual({ text: 'a**texto**b', selected: 'texto' });
    expect(run('', 0, 0, 'code')).toEqual({ text: '`código`', selected: 'código' });
  });

  it('handles selections at the bounds', () => {
    expect(run('tudo', 0, 4, 'italic')).toEqual({ text: '_tudo_', selected: 'tudo' });
    expect(run('fim', 3, 3, 'italic').text).toBe('fim_texto_');
    expect(run('x', 0, 99, 'bold').text).toBe('**x**');
    expect(run('x', 1, 0, 'bold').text).toBe('**x**');
  });

  it('turns lines into a list and back', () => {
    expect(run('a\nb\nc', 0, 3, 'list').text).toBe('- a\n- b\nc');
    expect(run('- a\n- b\nc', 0, 7, 'list').text).toBe('a\nb\nc');
    expect(run('linha', 2, 2, 'list').text).toBe('- linha');
    expect(run('', 0, 0, 'list').text).toBe('- item');
  });

  it('builds a link with the address selected', () => {
    expect(run('veja aqui', 5, 9, 'link')).toEqual({ text: 'veja [aqui](https://)', selected: 'https://' });
    expect(run('', 0, 0, 'link')).toEqual({ text: '[texto](https://)', selected: 'https://' });
  });

  it('reports the splice it made', () => {
    const r = applyFormat('uma palavra aqui', 4, 11, 'bold');
    const { from, to, insert } = r.change;
    expect('uma palavra aqui'.slice(0, from) + insert + 'uma palavra aqui'.slice(to)).toBe(r.text);
  });
});

describe('document block formatting', () => {
  it('changes heading level without accumulating markers', () => {
    expect(run('## Uma decisão\n\nTexto', 6, 6, 'heading1').text).toBe('# Uma decisão\n\nTexto');
    expect(run('# Uma decisão', 3, 3, 'paragraph').text).toBe('Uma decisão');
  });
  it('formats all selected lines and keeps the rest of the document', () => {
    expect(run('Antes\nUm\nDois\nDepois', 6, 13, 'quote').text).toBe('Antes\n> Um\n> Dois\nDepois');
    expect(run('> Uma decisão', 4, 4, 'heading2').text).toBe('## Uma decisão');
  });
});
