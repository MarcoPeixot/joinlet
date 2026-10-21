import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReachButton } from './Passport';

describe('ReachButton', () => {
  it('shows an explicit empty state instead of a disabled pill when the count is 0', () => {
    const out = renderToStaticMarkup(<ReachButton direction="upstream" count={0} active={false} onToggle={() => {}} />);
    expect(out).toContain('Sem dependências');
    expect(out).toContain('Antes');
    expect(out).not.toContain('<button');
    expect(out).not.toContain('disabled');
  });
  it('stays a toggle button with the count otherwise', () => {
    const out = renderToStaticMarkup(<ReachButton direction="downstream" count={3} active={false} onToggle={() => {}} />);
    expect(out).toContain('<button');
    expect(out).toContain('Depois');
    expect(out).not.toContain('Sem dependências');
  });
});
