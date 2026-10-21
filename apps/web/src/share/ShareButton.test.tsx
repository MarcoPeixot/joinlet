import { Tooltip } from 'radix-ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ShareStatus } from './client';
import { ShareButtonView } from './ShareButton';

const render = (status: ShareStatus) => renderToStaticMarkup(<Tooltip.Provider><ShareButtonView status={status} /></Tooltip.Provider>);
const status = (tunnel: boolean): ShareStatus => ({
  active: true, root: '/repo', people: [], startedAt: 1, invites: [],
  tunnel: tunnel ? { active: true, provider: 'cloudflared', url: 'https://demo-demo.trycloudflare.com', expiresAt: 2 } : { active: false },
});
describe('share button', () => {
  it('shows nothing extra while nothing is shared', () => {
    const out = render({ active: false });
    expect(out).toContain('data-share="off"');
    expect(out).not.toContain('Acesso público ligado');
  });

  it('shows the link is live without calling it public', () => {
    const out = render(status(false));
    expect(out).toContain('data-share="on"');
    expect(out).toContain('Link ativo, ninguém conectado');
    expect(out).not.toContain('Acesso público ligado');
  });

  it('keeps a visible mark in the top bar while the workspace is reachable from the internet', () => {
    const out = render(status(true));
    expect(out).toContain('aria-label="Acesso público ligado"');
    expect(out).toContain('Abra Compartilhar para desligar');
  });
});
