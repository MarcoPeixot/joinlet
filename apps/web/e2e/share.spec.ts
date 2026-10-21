import { axeFindings } from './support/axe';
import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

/** The owner's /api/share routes, simulated: a small state machine behind page.route (the real ones are in share-real.spec.ts). */
interface Invite { id: string; name: string; role: 'edit' | 'comment' | 'view'; createdAt: number; expiresAt: number | null; url: string; publicUrl: string | null }
interface Entry { t: string; type: string; invite?: string; role?: string; path?: string; op?: string; reason?: string }

function fakeServer(page: Page) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const state = {
    active: false,
    tunnel: null as { url: string; expiresAt: number } | null,
    invites: [] as Invite[],
    people: [] as Array<{ name: string; color: string }>,
    audit: [] as Entry[],
    refuse: null as string | null,
  };
  let counter = 0;
  const link = (token: string, base = 'http://192.168.0.5:8790') => `${base}/join?token=${token}`;
  const make = (name: string, role: Invite['role'], ttlMs: number | null): Invite => {
    const id = `i${++counter}`;
    return { id, name, role, createdAt: Date.now(), expiresAt: ttlMs === null ? null : Date.now() + ttlMs, url: link(`tok${id}`), publicUrl: null };
  };
  const log = (entry: Omit<Entry, 't'>) => state.audit.unshift({ t: new Date().toISOString(), ...entry });
  const view = () => {
    if (!state.active) return { active: false };
    const base = state.tunnel ? new URL(state.tunnel.url).origin : null;
    const invites = state.invites.map((invite) => ({ ...invite, publicUrl: base ? link(`tok${invite.id}`, base) : null }));
    return { active: true, root: '/repo', people: state.people, startedAt: 1, invites, tunnel: state.tunnel ? { active: true, provider: 'cloudflared', ...state.tunnel } : { active: false } };
  };
  const TTLS: Record<string, number | null> = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000, never: null };
  const TUNNEL_TTLS: Record<string, number> = { '30m': 1_800_000, '2h': 7_200_000, '24h': 86_400_000 };
  const handle = async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.method() === 'POST' ? (request.postDataJSON() ?? {}) as Record<string, unknown> : {};
    if (request.method() === 'POST') calls.push({ path, body });
    if (state.refuse && request.method() === 'POST') return route.fulfill({ status: 400, json: { error: state.refuse } });
    if (path === '/api/share/audit') return route.fulfill({ json: { entries: state.audit.slice(0, 100) } });
    if (path === '/api/share/start') {
      state.active = true;
      state.invites = [make('Link para editar', 'edit', null), make('Link só para ver', 'view', null)];
      log({ type: 'share.start' });
    } else if (path === '/api/share/stop') {
      state.active = false;
      state.tunnel = null;
      log({ type: 'share.stop' });
    } else if (path === '/api/share/invites') {
      state.invites.push(make(String(body.name), body.role as Invite['role'], TTLS[String(body.ttl)] ?? null));
      log({ type: 'invite.create', invite: String(body.name), role: String(body.role) });
    } else if (path === '/api/share/invites/revoke') {
      const gone = state.invites.find((invite) => invite.id === body.id);
      state.invites = state.invites.filter((invite) => invite.id !== body.id);
      if (gone) log({ type: 'invite.revoke', invite: gone.name });
    } else if (path === '/api/share/tunnel/start') {
      if (body.acknowledged !== true) return route.fulfill({ status: 400, json: { error: 'Confirme o aviso antes de ligar o acesso público.' } });
      state.tunnel = { url: 'https://demo-demo.trycloudflare.com', expiresAt: Date.now() + (TUNNEL_TTLS[String(body.ttl)] ?? 0) };
      log({ type: 'tunnel.start' });
    } else if (path === '/api/share/tunnel/stop') {
      state.tunnel = null;
      log({ type: 'tunnel.stop', reason: 'manual' });
    }
    return route.fulfill({ json: view() });
  };
  return { state, calls, install: () => page.route('**/api/share**', handle), log };
}

test.describe('compartilhar: convites, papéis, acesso público e atividade', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/app/');
    await expect(page.locator('.react-flow__node').first()).toBeVisible();
  });

  async function openDialog(page: Page) {
    await page.evaluate(() => fetch('/api/share/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: '/repo' }) }));
    await page.getByRole('button', { name: 'Compartilhar workspace' }).click();
    const dialog = page.getByRole('dialog', { name: 'Compartilhar workspace' });
    await dialog.getByText('Permissões e opções avançadas').click();
    await expect(dialog.getByRole('textbox', { name: 'Link para editar' })).toBeVisible();
    return dialog;
  }

  test('the two default links appear as invites, and a named invite is created with its role and validity', async ({ page }) => {
    const server = fakeServer(page);
    await server.install();
    const dialog = await openDialog(page);
    const rows = dialog.getByRole('list', { name: 'Convites ativos' }).getByRole('listitem');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Editar');
    await expect(rows.nth(0)).toContainText('Sem prazo');
    await expect(rows.nth(1)).toContainText('Só ver');

    const form = dialog.getByRole('form', { name: 'Novo convite' });
    await expect(form.getByRole('button', { name: 'Criar convite' })).toBeDisabled();
    await form.getByRole('textbox', { name: 'Nome (quem vai usar)' }).fill('Ana Souza');
    await form.getByRole('combobox', { name: 'Papel' }).selectOption('edit');
    await form.getByRole('combobox', { name: 'Validade' }).selectOption('7d');
    await form.getByRole('button', { name: 'Criar convite' }).click();

    const created = rows.filter({ hasText: 'Ana Souza' });
    await expect(created).toHaveCount(1);
    await expect(created).toContainText('Editar');
    await expect(created).toContainText('Expira em 7 dias');
    expect(server.calls.at(-1)).toEqual({ path: '/api/share/invites', body: { name: 'Ana Souza', role: 'edit', ttl: '7d' } });
    // The form is clean for the next one, and each invite has its own link.
    await expect(form.getByRole('textbox', { name: 'Nome (quem vai usar)' })).toHaveValue('');
    const links = await dialog.getByRole('textbox', { name: /^(Link|Ana)/ }).evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    expect(new Set(links).size).toBe(3);
    await dialog.getByRole('button', { name: 'Copiar ana souza' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(links[2]);
  });

  test('the comment role says what it does today, and the server\'s refusal reaches the person', async ({ page }) => {
    const server = fakeServer(page);
    await server.install();
    const dialog = await openDialog(page);
    const form = dialog.getByRole('form', { name: 'Novo convite' });
    await form.getByRole('combobox', { name: 'Papel' }).selectOption('comment');
    await expect(form).toContainText('Vê ao vivo e comenta');
    await form.getByRole('textbox', { name: 'Nome (quem vai usar)' }).fill('Bia');
    server.state.refuse = 'Limite de 50 convites ativos. Revogue algum antes de criar outro.';
    await form.getByRole('button', { name: 'Criar convite' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Limite de 50 convites ativos. Revogue algum antes de criar outro.');
    // Nothing was created, and what was typed is kept.
    await expect(form.getByRole('textbox', { name: 'Nome (quem vai usar)' })).toHaveValue('Bia');
    server.state.refuse = null;
    await form.getByRole('button', { name: 'Criar convite' }).click();
    await expect(dialog.locator('[data-invite="Bia"]')).toContainText('Comentar');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
  });

  test('revoking removes the invite at once and the activity records it', async ({ page }) => {
    const server = fakeServer(page);
    await server.install();
    const dialog = await openDialog(page);
    await dialog.getByRole('textbox', { name: 'Nome (quem vai usar)' }).fill('Caio');
    await dialog.getByRole('button', { name: 'Criar convite' }).click();
    await expect(dialog.locator('[data-invite="Caio"]')).toBeVisible();
    await dialog.getByRole('button', { name: 'Revogar caio' }).click();
    await expect(dialog.locator('[data-invite="Caio"]')).toHaveCount(0);
    expect(server.calls.at(-1)!.path).toBe('/api/share/invites/revoke');
    const activity = dialog.getByRole('list', { name: 'Eventos recentes' });
    await expect(activity.getByRole('listitem').first()).toContainText('Convite "Caio" revogado');
    await expect(activity).toContainText('Convite "Caio" criado (Só ver)');
    await expect(activity).toContainText('Compartilhamento iniciado');
  });

  test('advanced invite links follow public access and return to the LAN when it ends', async ({ page }) => {
    const server = fakeServer(page);
    await server.install();
    const dialog = await openDialog(page);
    await page.evaluate(async () => {
      await fetch('/api/share/tunnel/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ttl: '24h', acknowledged: true }) });
      const { shareStore } = await import('/src/share/session.ts');
      await shareStore.getState().refresh();
    });
    const editLink = dialog.getByRole('textbox', { name: 'Link para editar' });
    await expect(editLink).toHaveValue(/^https:\/\/demo-demo\.trycloudflare\.com\/join\?token=/);
    await dialog.getByRole('button', { name: 'Copiar link para editar' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^https:\/\/demo-demo\.trycloudflare\.com\/join\?token=/);
    await dialog.getByRole('button', { name: 'Desligar acesso público' }).click();
    await expect(editLink).toHaveValue(/^http:\/\/192\.168\.0\.5:8790\/join\?token=/);
    await expect(dialog.getByRole('list', { name: 'Eventos recentes' })).toContainText('Acesso público desligado');
  });

  test('sharing starts with one link action and explains who can edit', async ({ page }) => {
    const server = fakeServer(page);
    await server.install();
    await page.goto('/app/');
    await page.getByRole('button', { name: 'Compartilhar workspace' }).click();
    const dialog = page.getByRole('dialog', { name: 'Compartilhar workspace' });
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    await expect(dialog.getByText('Quem abrir o link entra no workspace e pode editar com você, sem cadastro ou aprovação.')).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Alcance do link' })).toHaveValue('internet');
    server.state.refuse = 'Não foi possível iniciar o compartilhamento.';
    await dialog.getByRole('button', { name: 'Liberar link de colaboração' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(server.state.refuse);
    await expect(dialog.getByRole('button', { name: 'Liberar link de colaboração' })).toBeEnabled();
  });

  test('the activity lists who joined and what was refused, newest first, and refreshes by itself and by button', async ({ page }) => {
    const server = fakeServer(page);
    await server.install();
    const dialog = await openDialog(page);
    const activity = dialog.getByRole('region', { name: 'Atividade' });
    server.log({ type: 'join', invite: 'Ana Souza', role: 'edit' });
    server.log({ type: 'write', invite: 'Ana Souza', path: 'docs/notas.md', op: 'write' });
    server.log({ type: 'denied', reason: 'read_only', invite: 'Bia' });
    await activity.getByRole('button', { name: 'Atualizar atividade' }).click();
    const items = activity.getByRole('listitem');
    await expect(items.nth(0)).toContainText('"Bia" tentou alterar com acesso só de leitura');
    await expect(items.nth(0)).toContainText('Recusado');
    await expect(items.nth(1)).toContainText('"Ana Souza" alterou docs/notas.md');
    await expect(items.nth(2)).toContainText('"Ana Souza" entrou (Editar)');
    // The dialog keeps following the log without a click.
    server.log({ type: 'invite.expire', invite: 'Dani' });
    await expect(items.first()).toContainText('Convite "Dani" expirou', { timeout: 20_000 });
  });

  test('sharing is available on mobile with an accessible dialog', async ({ page }) => {
    const server = fakeServer(page);
    await server.install();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/');
    await page.getByRole('button', { name: 'Compartilhar workspace' }).click();
    const dialog = page.getByRole('dialog', { name: 'Compartilhar workspace' });
    await expect(dialog.getByRole('button', { name: 'Liberar link de colaboração' })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Alcance do link' })).toBeVisible();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await axeFindings(page)).toEqual([]);
    await page.screenshot({ path: '/tmp/joinlet-share-mobile.png' });
  });

  test('stopping the share ends it and the dialog goes back to generating the links', async ({ page }) => {
    const server = fakeServer(page);
    await server.install();
    const dialog = await openDialog(page);
    await dialog.getByRole('button', { name: 'Parar de compartilhar' }).click();
    await expect(dialog.getByRole('button', { name: 'Liberar link de colaboração' })).toBeVisible();
    expect(server.calls.at(-1)!.path).toBe('/api/share/stop');
    await expect(dialog.getByRole('list', { name: 'Convites ativos' })).toHaveCount(0);
  });
});
