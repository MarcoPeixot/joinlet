import { describe, expect, it } from 'vitest';
import { slugify, uniqueSlug } from './slug';

describe('slugify', () => {
  it('folds pt-BR accents and joins words with hyphens', () => {
    expect(slugify('Visão Geral')).toBe('visao-geral');
    expect(slugify('Integração de Pagamentos')).toBe('integracao-de-pagamentos');
    expect(slugify('Ação à vista: 1ª versão')).toBe('acao-a-vista-1a-versao');
  });

  it('drops punctuation, trims hyphens and never returns an empty slug', () => {
    expect(slugify('  API / Gateway (v2)!  ')).toBe('api-gateway-v2');
    expect(slugify('***')).toBe('sem-titulo');
    expect(slugify('')).toBe('sem-titulo');
  });

  it('caps the length without leaving a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(59)} b`);
    expect(slug).toBe('a'.repeat(59));
    expect(slugify('x'.repeat(100))).toHaveLength(60);
  });
});

describe('uniqueSlug', () => {
  it('numbers repeated slugs from 2', () => {
    expect(uniqueSlug('Pagamentos', new Set())).toBe('pagamentos');
    expect(uniqueSlug('Pagamentos', new Set(['pagamentos']))).toBe('pagamentos-2');
    expect(uniqueSlug('Pagamentos', new Set(['pagamentos', 'pagamentos-2']))).toBe('pagamentos-3');
  });
});
