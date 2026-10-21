import { describe, expect, it } from 'vitest';
import { labelParts, splitShortcut } from './shortcut';

describe('labelParts', () => {
  it('splits a trailing "(shortcut)" off an accessible label', () => {
    expect(labelParts('Adicionar nó (N)')).toEqual({ text: 'Adicionar nó', shortcut: 'N' });
    expect(labelParts('Refazer (⇧⌘Z)')).toEqual({ text: 'Refazer', shortcut: '⇧⌘Z' });
    expect(labelParts('Agrupar seleção / novo grupo (⌘G)')).toEqual({ text: 'Agrupar seleção / novo grupo', shortcut: '⌘G' });
  });

  it('leaves labels without a shortcut alone', () => {
    expect(labelParts('Versões')).toEqual({ text: 'Versões', shortcut: null });
    expect(labelParts('Abrir pasta… (salva em <pasta>/.arch)')).toEqual({ text: 'Abrir pasta… (salva em <pasta>/.arch)', shortcut: null });
  });
});

describe('splitShortcut', () => {
  it('gives each modifier its own key and keeps the rest together', () => {
    expect(splitShortcut('⌘G')).toEqual(['⌘', 'G']);
    expect(splitShortcut('⇧⌘Z')).toEqual(['⇧', '⌘', 'Z']);
    expect(splitShortcut('N')).toEqual(['N']);
    expect(splitShortcut('⌘↵')).toEqual(['⌘', '↵']);
    expect(splitShortcut('Esc')).toEqual(['Esc']);
    expect(splitShortcut('⌘\\')).toEqual(['⌘', '\\']);
  });
});
