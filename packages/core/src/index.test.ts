import { expect, it } from 'vitest';
import { STRUKT_FORMAT_VERSION } from './index';

it('exposes the file format version', () => {
  expect(STRUKT_FORMAT_VERSION).toBe(1);
});
