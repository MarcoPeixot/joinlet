import { describe, expect, it } from 'vitest';
import { pluralize } from './plural';

describe('pluralize', () => {
  it('uses the plural form for many', () => {
    expect(pluralize(2, 'pendência', 'pendências', 'f')).toBe('2 pendências');
    expect(pluralize(12, 'arquivo', 'arquivos')).toBe('12 arquivos');
  });
  it('uses the singular for exactly one', () => {
    expect(pluralize(1, 'pendência', 'pendências', 'f')).toBe('1 pendência');
  });
  it('says nenhum/nenhuma for zero, agreeing with the gender', () => {
    expect(pluralize(0, 'pendência', 'pendências', 'f')).toBe('Nenhuma pendência');
    expect(pluralize(0, 'arquivo', 'arquivos')).toBe('Nenhum arquivo');
  });
});
