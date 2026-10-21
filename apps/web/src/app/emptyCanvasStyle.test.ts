import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./EmptyCanvas.tsx', import.meta.url), 'utf8');

describe('EmptyCanvas', () => {
  it('the send button uses the accent tokens, not white on the brand gradient (3:1 non-text contrast)', () => {
    const start = source.indexOf('aria-label={uiText("Gerar com IA")}');
    const button = source.slice(start, source.indexOf('</button>', start));
    expect(button).toContain('bg-accent-strong');
    expect(button).toContain('text-accent-ink');
    expect(button).not.toContain('text-white');
  });
  it('a tall card stays scrollable from its top: safe centering, not items-center', () => {
    expect(source).toContain('overflow-y-auto');
    expect(source).not.toMatch(/flex items-center justify-center overflow-y-auto/);
    expect(source).toContain('m-auto');
  });
  it('Enter during IME composition does not send', () => {
    expect(source).toContain('isComposing');
  });
});
