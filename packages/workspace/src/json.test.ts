import { describe, expect, it } from 'vitest';
import { stableStringify } from './json';

describe('stableStringify', () => {
  it('sorts keys at every depth, indents with 2 spaces and ends with a newline', () => {
    const text = stableStringify({ b: 1, a: { d: [{ z: 1, y: 2 }], c: true } });
    expect(text).toBe('{\n  "a": {\n    "c": true,\n    "d": [\n      {\n        "y": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}\n');
  });

  it('is independent of insertion order and drops undefined values', () => {
    expect(stableStringify({ x: 1, y: undefined, w: 2 })).toBe(stableStringify({ w: 2, x: 1 }));
  });
});
