import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ACCENTS, resolveAccent } from './accent';

const html = readFileSync(new URL('../../app/index.html', import.meta.url), 'utf8');
const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;

function boot(saved: string | null): string | undefined {
  const root: { dataset: { theme?: string; accent?: string } } = { dataset: {} };
  new Function('localStorage', 'window', 'document', script)(
    { getItem: (key: string) => (key === 'strukt:accent' ? saved : null) },
    { matchMedia: () => ({ matches: false }) },
    { documentElement: root },
  );
  return root.dataset.accent;
}

describe('inline accent boot script (index.html)', () => {
  for (const accent of ACCENTS) it(`${accent} matches resolveAccent`, () => expect(boot(accent)).toBe(resolveAccent(accent)));
  for (const junk of [null, '', 'purple', '__proto__', 'constructor']) it(`${String(junk)} falls back to lime`, () => expect(boot(junk)).toBe(resolveAccent(junk)));
  it('never throws when storage is unavailable', () => {
    expect(() => new Function('localStorage', 'window', 'document', script)(undefined, {}, { documentElement: { dataset: {} } })).not.toThrow();
  });
});
