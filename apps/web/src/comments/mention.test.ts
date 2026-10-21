import { describe, expect, it } from 'vitest';
import { applyMention, mentionQuery } from './mention';

describe('mentionQuery', () => {
  it('finds the @ being typed right before the caret', () => {
    expect(mentionQuery('Oi @', 4)).toEqual({ at: 3, query: '' });
    expect(mentionQuery('Oi @An', 6)).toEqual({ at: 3, query: 'An' });
    expect(mentionQuery('@Ana Sou', 8)).toEqual({ at: 0, query: 'Ana Sou' });
    expect(mentionQuery('linha\n@Bi', 9)).toEqual({ at: 6, query: 'Bi' });
  });
  it('is not a mention in an e-mail, after the caret, across a line or once a name is long gone', () => {
    expect(mentionQuery('fale@ana', 8)).toBeNull();
    expect(mentionQuery('Oi @Ana e mais', 14)).toBeNull();
    expect(mentionQuery('@Ana\nfoo', 8)).toBeNull();
    expect(mentionQuery('@um dois três quatro', 20)).toBeNull();
    expect(mentionQuery('sem arroba', 10)).toBeNull();
    expect(mentionQuery('@a  b', 5)).toBeNull();
  });
});

describe('applyMention', () => {
  it('replaces what was typed with the whole name and a space, and puts the caret after it', () => {
    expect(applyMention('Oi @An e mais', 3, 6, 'Ana Souza')).toEqual({ text: 'Oi @Ana Souza  e mais', caret: 14 });
    expect(applyMention('Oi @An', 3, 6, 'Ana')).toEqual({ text: 'Oi @Ana ', caret: 8 });
  });
});
