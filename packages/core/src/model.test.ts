import { describe, expect, it } from 'vitest';
import { STYLE_KEYS, UPDATABLE_PROP_KEYS } from './model';
import type { DiagramStyle, UpdatableProps } from './model';

describe('UPDATABLE_PROP_KEYS', () => {
  it('covers every key of a fully-populated UpdatableProps', () => {
    const full: Required<UpdatableProps> = { canvasFrame: true,
      presentation: 'card', layoutRole: 'peer', fields: [{ name: 'id', type: 'uuid', key: 'PK' }],
      label: 'x', icon: 'x', color: 'x', link: 'x', tech: 'x', description: 'x',
      colorMode: 'pastel', styleMode: 'shadow', typeface: 'rough', shape: 'rectangle',
    };
    expect([...UPDATABLE_PROP_KEYS].sort()).toEqual(Object.keys(full).sort());
  });
});

describe('STYLE_KEYS', () => {
  it('covers every key of a fully-populated DiagramStyle', () => {
    const full: Required<DiagramStyle> = { direction: 'right', colorMode: 'pastel', styleMode: 'shadow', typeface: 'rough' };
    expect([...STYLE_KEYS].sort()).toEqual(Object.keys(full).sort());
  });
});
