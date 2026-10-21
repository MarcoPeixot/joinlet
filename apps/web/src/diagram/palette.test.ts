import type { ColorMode } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import type { Theme } from '../ui/theme';
import { CANVAS } from '../ui/theme';
import { edgeColor, edgeLabelColor, groupColors, hexToHsl, hslToHex, legibleBrandColor, nodeColors, resolveColor } from './palette';

const lightness = (hex: string) => Math.round(hexToHsl(hex).l);

describe('resolveColor', () => {
  it('resolves palette tokens, extended names and hex', () => {
    expect(resolveColor('Blue')).toBe('#2866c4');
    expect(resolveColor('grey')).toBe('#6b6b6b');
    expect(resolveColor('#ABC')).toBe('#aabbcc');
    expect(resolveColor('#12ab34')).toBe('#12ab34');
    expect(resolveColor('nope')).toBeNull();
    expect(resolveColor(undefined)).toBeNull();
  });

  it('never resolves a color from Object.prototype', () => {
    expect(resolveColor('constructor')).toBeNull();
    expect(resolveColor('__proto__')).toBeNull();
    const modes: ColorMode[] = ['pastel', 'bold', 'outline'];
    const themes: Theme[] = ['light', 'dark'];
    for (const mode of modes) {
      for (const theme of themes) {
        expect(nodeColors('constructor', mode, theme)).toEqual(nodeColors(undefined, mode, theme));
        expect(groupColors('constructor', mode, theme)).toEqual(groupColors(undefined, mode, theme));
      }
    }
    expect(edgeColor('__proto__', 'dark')).toEqual(edgeColor(undefined, 'dark'));
  });
  it('round-trips hsl', () => {
    expect(hslToHex(hexToHsl('#2866c4'))).toBe('#2866c4');
  });
});

describe('nodeColors', () => {
  it('pastel keeps the surface neutral and puts color in the icon', () => {
    const c = nodeColors('blue', 'pastel', 'light');
    expect(c.fill).toBe('#ffffff');
    expect(c.icon).toBe('#2866c4');
    expect(c.stroke).not.toBe(c.icon);
  });
  it('bold picks readable ink', () => {
    expect(nodeColors('yellow', 'bold', 'light').text).toBe('#111827');
    expect(nodeColors('blue', 'bold', 'light').text).toBe('#ffffff');
  });
  it('outline and uncolored nodes', () => {
    expect(nodeColors('blue', 'outline', 'light').fill).toBe('transparent');
    // Uncolored nodes are quiet cards: white or graphite with a soft hairline, ink text.
    expect(nodeColors(undefined, 'pastel', 'light')).toMatchObject({ fill: '#ffffff', stroke: '#bcc8d7', text: '#111827' });
    expect(nodeColors(undefined, 'pastel', 'dark')).toMatchObject({ fill: '#151d23', stroke: '#43535d', text: '#f5f7f2' });
    expect(nodeColors(undefined, 'outline', 'dark').fill).toBe('transparent');
  });
});

describe('groupColors and edges', () => {
  it('uses quiet groups with plain titles', () => {
    const c = groupColors('green', 'pastel', 'light');
    expect(lightness(c.fill)).toBeGreaterThanOrEqual(95);
    expect(c.fill).not.toBe(groupColors('blue', 'pastel', 'light').fill);
    expect(lightness(c.titleText)).toBeLessThan(35);
    expect(c.titleSurface).toBe('transparent');
    expect(groupColors(undefined, 'pastel', 'light')).toMatchObject({ fill: '#f3f6fa', stroke: '#b8c5d6' });
    expect(groupColors(undefined, 'pastel', 'dark').stroke).toBe('#2b363e');
  });
  it('colors edges', () => {
    expect(edgeColor(undefined, 'light')).toBe('#53657d');
    expect(edgeColor(undefined, 'dark')).toBe('#a5b4bb');
    expect(edgeColor('red', 'light')).toBe('#bd413a');
  });
});

describe('shadow', () => {
  it('is a soft translucent shade, not a solid offset color', () => {
    expect(nodeColors(undefined, 'pastel', 'light').shadow).toBe('rgba(24, 28, 40, 0.06)');
    expect(groupColors('blue', 'pastel', 'dark').shadow).toBe('rgba(0, 0, 0, 0.2)');
  });
});

describe('legibleBrandColor', () => {
  it('keeps brand colors that read on the theme', () => {
    expect(legibleBrandColor('#4169E1', 'dark')).toBe('#4169E1');
    expect(legibleBrandColor('#4169E1', 'light')).toBe('#4169E1');
    expect(legibleBrandColor('#181717', 'light')).toBe('#181717');
    expect(legibleBrandColor('#FFFFFF', 'dark')).toBe('#FFFFFF');
  });
  it('drops near-black marks on dark and near-white marks on light', () => {
    expect(legibleBrandColor('#181717', 'dark')).toBeNull();
    expect(legibleBrandColor('#000000', 'dark')).toBeNull();
    expect(legibleBrandColor('#FFFFFF', 'light')).toBeNull();
    expect(legibleBrandColor('#EDEDED', 'light')).toBeNull();
  });
});

describe('edgeLabelColor', () => {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x! + 0.05) / (y! + 0.05);
  };

  it('is AA (4.5:1) on the canvas for every token, in both themes', () => {
    for (const theme of ['light', 'dark'] as Theme[]) {
      for (const token of [undefined, 'white', 'yellow', 'green', 'blue', 'purple', 'red', 'orange', 'black', 'gray', 'silver', 'cyan', 'pink', '#ffff00', '#ffffff', '#000000']) {
        expect(ratio(edgeLabelColor(token, theme), CANVAS[theme].bg), `${theme}/${token}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the edge color when it already reads', () => {
    expect(edgeLabelColor('blue', 'light')).toBe(edgeColor('blue', 'light'));
    expect(edgeLabelColor(undefined, 'dark')).toBe(edgeColor(undefined, 'dark'));
  });

  it('only darkens (light) or lightens (dark) and keeps the hue', () => {
    const light = edgeLabelColor('yellow', 'light');
    expect(lightness(light)).toBeLessThan(lightness(edgeColor('yellow', 'light')));
    expect(Math.abs(hexToHsl(light).h - hexToHsl(edgeColor('yellow', 'light')).h)).toBeLessThan(6);
    expect(lightness(edgeLabelColor('#101010', 'dark'))).toBeGreaterThan(lightness('#101010'));
  });
});
