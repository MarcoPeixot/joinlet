import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { THEME_PREFS, themeAttribute } from './theme';

const html = readFileSync(new URL('../../app/index.html', import.meta.url), 'utf8');
const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;

function boot(pref: string | null, systemDark: boolean): string | undefined {
  const root: { dataset: { theme?: string } } = { dataset: {} };
  new Function('localStorage', 'window', 'document', script)(
    { getItem: () => pref },
    { matchMedia: () => ({ matches: systemDark }) },
    { documentElement: root },
  );
  return root.dataset.theme;
}

describe('inline theme boot script (index.html)', () => {
  for (const pref of THEME_PREFS) {
    for (const systemDark of [false, true]) {
      it(`${pref} / systemDark=${systemDark} matches themeAttribute`, () => {
        expect(boot(pref, systemDark)).toBe(themeAttribute(pref, systemDark));
      });
    }
  }
  it('no saved preference defaults to dark, whatever the system says', () => {
    expect(boot(null, true)).toBe('dark');
    expect(boot(null, false)).toBe('dark');
  });
  it('an unknown saved value also falls back to dark', () => {
    expect(boot('banana', true)).toBe('dark');
  });
  it('blocked storage still ends on dark, matching the default', () => {
    const root: { dataset: { theme?: string } } = { dataset: {} };
    new Function('localStorage', 'window', 'document', script)(undefined, {}, { documentElement: root });
    expect(root.dataset.theme).toBe('dark');
  });
  it('never throws when storage is unavailable', () => {
    expect(() => new Function('localStorage', 'window', 'document', script)(undefined, {}, { documentElement: { dataset: {} } })).not.toThrow();
  });
});
