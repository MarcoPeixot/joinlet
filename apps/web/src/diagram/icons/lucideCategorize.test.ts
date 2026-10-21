import { describe, expect, it } from 'vitest';
import { categorize } from './lucideCategorize';

describe('categorize (lucide name → picker category)', () => {
  it('uses OVERRIDES for the names the word rules would misfile', () => {
    expect(categorize('mouse-pointer')).toBe('interface'); // "mouse" alone would make it a device
    expect(categorize('mouse')).toBe('devices');
  });

  it('files a cloud with a weather word as weather, any other cloud as network', () => {
    expect(categorize('cloud-rain')).toBe('weather');
    expect(categorize('cloud-cog')).toBe('network');
  });

  it('skips container words, then the first known word decides', () => {
    expect(categorize('circle-user')).toBe('people');
    expect(categorize('square-code')).toBe('development');
    expect(categorize('file-lock')).toBe('files');
  });

  it('files a name with only containers and unknown words as a shape, anything else unknown as misc', () => {
    expect(categorize('square-dashed')).toBe('shapes');
    expect(categorize('zzz-unknown')).toBe('misc');
    expect(categorize('constructor')).toBe('misc');
  });
});
