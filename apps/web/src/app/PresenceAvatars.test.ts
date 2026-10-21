import { describe, expect, it } from 'vitest';
import { initials } from './PresenceAvatars';

describe('initials', () => {
  it('takes the first letter of up to two words', () => {
    expect(initials('Ana Souza')).toBe('AS');
    expect(initials('colaborador 12 extra')).toBe('C1');
    expect(initials('Bia')).toBe('B');
    expect(initials('   ')).toBe('?');
  });
});
