import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// vitest strips CSS imports (even ?raw), so read the real stylesheet from disk.
const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

type Block = 'light' | 'dark' | 'contrast';
const SELECTOR: Record<Block, string> = {
  light: ':root {',
  dark: ":root[data-theme='dark']",
  contrast: "*/\n:root[data-theme='contrast'] {",
};

/** The full rule (selector list + body) that starts at `selector`. */
function rule(selector: string): { selectors: string; body: string } {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`regra ${selector} não encontrada`);
  const open = css.indexOf('{', start);
  const end = css.indexOf('\n}', open);
  return { selectors: css.slice(css.lastIndexOf('\n\n', start) + 2, open), body: css.slice(open, end) };
}

/** The declarations of one theme block, layered over `base` (contrast overrides dark). */
function tokens(block: Block): Record<string, string> {
  const base = block === 'contrast' ? tokens('dark') : {};
  const body = rule(SELECTOR[block]).body;
  const own = Object.fromEntries([...body.matchAll(/--sk-([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1]!, m[2]!]));
  return { ...base, ...own };
}

const SURFACES = ['bg', 'canvas', 'panel', 'panel-2', 'panel-3'] as const;

describe('text tokens meet WCAG AA (4.5:1) on every surface', () => {
  for (const block of ['light', 'dark', 'contrast'] as const) {
    const t = tokens(block);
    for (const text of ['ink', 'muted', 'faint'] as const) {
      for (const surface of SURFACES) {
        it(`${block}: ${text} on ${surface}`, () => {
          expect(ratio(t[text]!, t[surface]!)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
});

describe('high contrast theme reaches AAA (7:1) for body text', () => {
  const t = tokens('contrast');
  for (const text of ['ink', 'muted', 'faint'] as const) {
    it(`${text} on panel`, () => {
      expect(ratio(t[text]!, t.panel!)).toBeGreaterThanOrEqual(7);
    });
  }
});

describe('contrast inherits the whole dark block through the real cascade', () => {
  const dark = rule(SELECTOR.dark);
  it('the dark selector list includes contrast', () => {
    expect(dark.selectors).toContain("[data-theme='contrast']");
  });
  it('color-scheme is dark for contrast, with dark semantic tokens', () => {
    expect(dark.body).toMatch(/color-scheme:\s*dark/);
    const t = tokens('contrast');
    expect(t.danger).toBe(tokens('dark').danger);
  });
  it('the contrast block comes after the dark block so it overrides', () => {
    expect(css.indexOf(SELECTOR.contrast)).toBeGreaterThan(css.indexOf(SELECTOR.dark));
  });
});

describe('accent themes keep AA in light and dark', () => {
  const lines = [...css.matchAll(/^:root\[data-theme='(light|dark)'\]\[data-accent='(\w+)'\] \{([^}]*)\}/gm)];
  const declared = (body: string, name: string) => new RegExp(`--sk-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(body)![1]!;
  const cases: [Block, string, string, string, string][] = [
    ['light', 'lime', tokens('light').accent!, tokens('light')['accent-strong']!, tokens('light')['accent-ink']!],
    ['dark', 'lime', tokens('dark').accent!, tokens('dark')['accent-strong']!, tokens('dark')['accent-ink']!],
    ...lines.map((m) => [m[1] as Block, m[2]!, declared(m[3]!, 'accent'), declared(m[3]!, 'accent-strong'), declared(m[3]!, 'accent-ink')] as [Block, string, string, string, string]),
  ];
  it('covers every accent in both themes', () => {
    expect(cases.map((c) => `${c[0]}:${c[1]}`).sort()).toEqual(
      ['dark', 'light'].flatMap((theme) => ['amber', 'cobalt', 'emerald', 'graphite', 'iris', 'lime', 'signal'].map((accent) => `${theme}:${accent}`)),
    );
  });
  for (const [theme, accent, text, strong, foreground] of cases) {
    const t = tokens(theme);
    it(`${theme}/${accent}: foreground on accent-strong`, () => {
      expect(ratio(foreground, strong)).toBeGreaterThanOrEqual(4.5);
    });
    for (const surface of ['bg', 'canvas', 'panel'] as const) {
      it(`${theme}/${accent}: accent text on ${surface}`, () => {
        expect(ratio(text, t[surface]!)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe('workspace surfaces and canvas stay distinct', () => {
  for (const block of ['light', 'dark', 'contrast'] as const) {
    it(`${block}: --sk-bg differs from --sk-canvas`, () => {
      const t = tokens(block);
      expect(t.bg).not.toBe(t.canvas);
    });
  }
  it('cards are opaque: .sk-float has no backdrop blur', () => {
    const start = css.indexOf('.sk-float {');
    const float = css.slice(start, css.indexOf('}', start));
    expect(float).not.toContain('backdrop-filter');
    expect(float).not.toContain('--sk-panel-glass');
  });
  it('the canvas mirror in ui/theme.ts matches the tokens', async () => {
    const { CANVAS } = await import('./theme');
    expect(CANVAS.light.bg).toBe(tokens('light').canvas);
    expect(CANVAS.dark.bg).toBe(tokens('dark').canvas);
  });
});

describe('no backdrop blur left in the chrome', () => {
  it('app.css, diagram.css and the Modal overlay draw opaque surfaces', () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
    expect(read('../styles/app.css')).not.toContain('backdrop-filter');
    expect(read('../styles/diagram.css')).not.toContain('backdrop-filter');
    expect(read('./Modal.tsx')).not.toContain('backdrop-blur');
  });
});

describe('touch targets are set in CSS (no per-component JS)', () => {
  it('the header groups reach 44 px on coarse pointers', () => {
    expect(css).toMatch(/@media \(pointer: coarse\)[\s\S]*\.sk-topbar-group[\s\S]*min-height: 44px/);
  });
});

describe('text drawn on the canvas meets AA in every theme', () => {
  it('the diff text tokens (edge labels in AI drafts and version compares) read on the canvas', () => {
    for (const block of ['light', 'dark', 'contrast'] as const) {
      const t = tokens(block);
      for (const diff of ['added', 'removed', 'changed'] as const) {
        expect(t[`diff-${diff}-text`], `${block}: --sk-diff-${diff}-text declared`).toBeDefined();
        expect(ratio(t[`diff-${diff}-text`]!, t.canvas!), `${block}: diff-${diff}-text on canvas`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('restrained depth tokens exist in both themes', () => {
  for (const token of ['glow', 'node-shadow', 'node-sheen', 'vignette'] as const) {
    it(`--sk-${token} is declared in light and dark`, () => {
      expect(rule(SELECTOR.light).body).toContain(`--sk-${token}:`);
      expect(rule(SELECTOR.dark).body).toContain(`--sk-${token}:`);
    });
  }
  it('the dark canvas is below the navigation and panels in elevation', () => {
    const t = tokens('dark');
    expect(lum(t.bg!)).toBeGreaterThan(lum(t.canvas!));
    expect(lum(t.panel!)).toBeGreaterThan(lum(t.canvas!));
    expect(lum(t['panel-2']!)).toBeGreaterThan(lum(t.panel!));
    expect(lum(t['panel-3']!)).toBeGreaterThan(lum(t['panel-2']!));
  });
  it('floating cards use a soft shadow without a lit inset edge', () => {
    const start = css.indexOf('.sk-float {');
    expect(css.slice(start, css.indexOf('}', start))).toContain('--sk-shadow-panel');
    const shadow = /--sk-shadow-panel:([^;]+);/.exec(rule(SELECTOR.dark).body)![1]!;
    expect(shadow).toContain('rgba(');
    expect(shadow).not.toContain('inset');
  });
});

describe('chrome states use tokens only', () => {
  it('focus inside floating chrome uses the glow token, never a literal color', () => {
    const start = css.indexOf('.sk-focus-glow');
    expect(start).toBeGreaterThanOrEqual(0);
    const body = css.slice(start, css.indexOf('}', start));
    expect(body).toContain('var(--sk-glow)');
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,6}|rgba?\(/);
  });
});

describe('chrome state rules do not leak into Radix primitives', () => {
  it("the checked tint targets only menu check items, never Switch tracks (data-state='checked' elsewhere)", () => {
    expect(css).not.toMatch(/\.sk-pop \[data-state='checked'\]/);
    expect(css).toMatch(/\.sk-pop \[role='menuitemcheckbox'\]\[data-state='checked'\]/);
  });
  it("no rule keys on aria-current='true' (nothing in the app sets that value)", () => {
    expect(css).not.toContain("[aria-current='true']");
  });
});
