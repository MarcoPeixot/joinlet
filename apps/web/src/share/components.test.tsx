import { Tooltip } from 'radix-ui';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { ActivityList } from './ActivitySection';
import type { InviteView } from './client';
import { InviteList, NewInviteForm, linkOf } from './InviteSection';
import { PublicAccess } from './PublicAccess';

const NOW = Date.parse('2026-10-03T12:00:00.000Z');
const html = (element: ReactElement) => renderToStaticMarkup(<Tooltip.Provider>{element}</Tooltip.Provider>);
const invite = (overrides: Partial<InviteView> = {}): InviteView => ({ id: 'a', name: 'Ana Souza', role: 'comment', createdAt: NOW, expiresAt: NOW + 3 * 3_600_000, url: 'http://192.168.0.5:8790/join?token=aaa', publicUrl: null, ...overrides });
const noop = () => {};

describe('invite list', () => {
  it('shows each invite with its name, role, expiry and link, named so a screen reader can tell them apart', () => {
    const out = html(<InviteList invites={[invite(), invite({ id: 'b', name: 'Link para editar', role: 'edit', expiresAt: null, url: 'http://192.168.0.5:8790/join?token=bbb' })]} now={NOW} busy={false} onCopy={noop} onRevoke={noop} />);
    expect(out).toContain('aria-label="Convites ativos"');
    expect(out).toContain('data-invite="Ana Souza"');
    expect(out).toContain('aria-label="Ana Souza"');
    expect(out).toContain('value="http://192.168.0.5:8790/join?token=aaa"');
    expect(out).toContain('Comentar');
    expect(out).toContain('Expira em 3 h');
    expect(out).toContain('Sem prazo');
    expect(out).toContain('aria-label="Copiar ana souza"');
    expect(out).toContain('aria-label="Revogar ana souza"');
    expect(out).toContain('aria-label="Copiar link para editar"');
    expect(out).toContain('Vê ao vivo e comenta');
  });

  it('hands out the public link while public access is on, the local one otherwise', () => {
    const local = invite();
    const published = invite({ publicUrl: 'https://demo.trycloudflare.com/join?token=aaa' });
    expect(linkOf(local)).toBe(local.url);
    expect(linkOf(published)).toBe('https://demo.trycloudflare.com/join?token=aaa');
    expect(html(<InviteList invites={[published]} now={NOW} busy={false} onCopy={noop} onRevoke={noop} />)).toContain('value="https://demo.trycloudflare.com/join?token=aaa"');
  });

  it('escapes what the owner typed as a name and opens links safely', () => {
    const out = html(<InviteList invites={[invite({ name: '<img src=x onerror=alert(1)>' })]} now={NOW} busy={false} onCopy={noop} onRevoke={noop} />);
    expect(out).not.toContain('<img');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('says so when there is none, and locks the revoke buttons while busy', () => {
    expect(html(<InviteList invites={[]} now={NOW} busy={false} onCopy={noop} onRevoke={noop} />)).toContain('Nenhum convite ativo');
    expect(html(<InviteList invites={[invite()]} now={NOW} busy onCopy={noop} onRevoke={noop} />)).toMatch(/aria-label="Revogar ana souza"[^>]*disabled/);
  });
});

describe('new invite form', () => {
  it('offers the three roles and the four validities, defaults to read-only for a day, and cannot be sent without a name', () => {
    const out = html(<NewInviteForm busy={false} onCreate={async () => true} />);
    expect(out).toContain('aria-label="Novo convite"');
    for (const label of ['Editar', 'Comentar', 'Só ver', '1 hora', '24 horas', '7 dias', 'Sem prazo']) expect(out).toContain(`>${label}</option>`);
    expect(out).toContain('maxLength="60"');
    expect(out).toMatch(/<option value="view" selected/);
    expect(out).toMatch(/<option value="24h" selected/);
    expect(out).toMatch(/<button[^>]*disabled[^>]*>.*Criar convite/);
  });
});

describe('public access', () => {
  it('warns before offering the switch, and keeps it off until the warning is acknowledged', () => {
    const out = html(<PublicAccess tunnel={{ active: false }} now={NOW} busy={false} onStart={noop} onStop={noop} />);
    expect(out).toContain('role="note"');
    expect(out).toContain('Qualquer pessoa na internet');
    expect(out).toContain('cloudflared');
    expect(out).toContain('Entendo os riscos');
    for (const label of ['30 minutos', '2 horas', '24 horas']) expect(out).toContain(`>${label}</option>`);
    expect(out).toMatch(/<option value="2h" selected/);
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Ligar acesso público/);
    expect(out).not.toContain('Desligar');
  });

  it('shows the public address (host only) and the time left while it is on', () => {
    const out = html(<PublicAccess tunnel={{ active: true, provider: 'cloudflared', url: 'https://demo-demo.trycloudflare.com', expiresAt: NOW + 90 * 60_000 }} now={NOW} busy={false} onStart={noop} onStop={noop} />);
    expect(out).toContain('demo-demo.trycloudflare.com');
    expect(out).toContain('1 h 30 min');
    expect(out).toContain('Desligar acesso público');
    expect(out).not.toContain('Entendo os riscos');
  });
});

describe('activity', () => {
  it('lists the events newest first with a text for each, marking refusals', () => {
    const out = html(<ActivityList error={null} onRefresh={noop} entries={[
      { t: '2026-10-03T12:05:00.000Z', type: 'denied', reason: 'invalid_token' },
      { t: '2026-10-03T12:00:00.000Z', type: 'join', invite: 'Ana', role: 'view' },
    ]} />);
    expect(out).toContain('Atividade · 2');
    expect(out.indexOf('Convite inválido recusado')).toBeLessThan(out.indexOf('&quot;Ana&quot; entrou (Só ver)'));
    expect(out).toContain('Recusado: ');
    expect(out).toContain('aria-label="Atualizar atividade"');
  });

  it('has an empty state and shows a failure instead of the list', () => {
    expect(html(<ActivityList error={null} onRefresh={noop} entries={[]} />)).toContain('Nada registrado ainda');
    const out = html(<ActivityList error="Conecte um repositório." onRefresh={noop} entries={[{ t: '2026-10-03T12:00:00.000Z', type: 'join' }]} />);
    expect(out).toContain('Conecte um repositório.');
    expect(out).not.toContain('Eventos recentes');
  });

  it('escapes a name that came from an invite', () => {
    const out = html(<ActivityList error={null} onRefresh={noop} entries={[{ t: '2026-10-03T12:00:00.000Z', type: 'join', invite: '<script>alert(1)</script>' }]} />);
    expect(out).not.toContain('<script>');
  });
});
