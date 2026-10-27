import { describe, expect, it } from 'vitest';
import { isNewPassword, isPasswordInput } from './passwordPolicy';

describe('new password policy', () => {
  it.each(['1234567!', 'abcdefgh@', 'ááááááá!', '７７７７７７７！', '😀'.repeat(8), ' '.repeat(7) + '!'])('accepts eight characters including punctuation or symbols: %s', value => {
    expect(isNewPassword(value)).toBe(true);
  });
  it.each(['123456!', '12345678', 'Abcdefgh', 'abcdefgh ', 'abcdefg\t', 'abcdefg\u200b', '😀😀😀!', '', null, 12345678])('rejects insufficient length or missing symbols: %s', value => {
    expect(isNewPassword(value)).toBe(false);
  });
  it('counts Unicode code points and bounds input before counting', () => {
    expect(isNewPassword('😀'.repeat(128))).toBe(true);
    expect(isNewPassword('😀'.repeat(129))).toBe(false);
    expect(isNewPassword('a'.repeat(127) + '!')).toBe(true);
    expect(isNewPassword('a'.repeat(128) + '!')).toBe(false);
  });
  it('accepts existing credentials without applying new password requirements', () => {
    expect(isPasswordInput('legacyPasswordWithoutPunctuation')).toBe(true);
    expect(isPasswordInput('1234567')).toBe(true);
    expect(isPasswordInput('a'.repeat(129))).toBe(false);
    expect(isPasswordInput({ password: '1234567!' })).toBe(false);
  });
});
