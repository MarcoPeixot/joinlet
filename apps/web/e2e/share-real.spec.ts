import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { startShareStack } from './support/shareStack';
import type { ShareStack, StackInvite, StackStatus } from './support/shareStack';

// The real thing: the owner's /api/share routes and a collaboration host (a real process, real sockets), a clock the
// test moves for expiry, and browsers as guests. Needs the web build (see support/collabHost.ts).
let stack: ShareStack;
test.beforeEach(async () => {
  stack = await startShareStack();
  const started = await stack.api<StackStatus>('/api/share/start', { dir: stack.root });
  expect(started.status).toBe(200);
});
test.afterEach(async () => { await stack?.dispose(); });

async function invite(name: string, role: 'edit' | 'comment' | 'view', ttl: '1h' | '24h' | '7d' | 'never'): Promise<StackInvite> {
  const { status, body } = await stack.api<StackStatus>('/api/share/invites', { name, role, ttl });
  expect(status).toBe(200);
  return body.invites.find((entry) => entry.name === name)!;
}
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Workspace' });
const editor = (page: Page) => page.getByLabel('Editor do documento').locator('.cm-content');

async function guest(browser: Browser, link: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  await expect(sidebar(page)).toBeVisible();
  return { page, context };
}

async function openNotes(page: Page) {
  await sidebar(page).getByRole('button', { name: 'Notas' }).click();
  await expect(editor(page)).toContainText('Olá');
}

test('revoking an invite cuts its guest off at once, and the other guests carry on', async ({ browser }) => {
  const ana = await invite('Ana', 'edit', '24h');
  const bia = await invite('Bia', 'edit', '24h');
  const a = await guest(browser, ana.url);
  const b = await guest(browser, bia.url);
  await openNotes(a.page);
  await openNotes(b.page);
  // Both edit while their invites live.
  await editor(a.page).click();
  await a.page.keyboard.press('End');
  await a.page.keyboard.type(' da Ana');
  await expect(editor(b.page)).toContainText('Olá da Ana');

  await stack.api('/api/share/invites/revoke', { id: ana.id });
  await expect(a.page.getByText('Seu acesso a este compartilhamento terminou')).toBeVisible({ timeout: 10_000 });
  await expect(a.page.getByRole('status').filter({ hasText: 'Erro na colaboração' })).toBeVisible();
  // Her REST access is over as well (the host answers with the code the app recognizes).
  const session = await a.page.evaluate(async () => { const r = await fetch('/api/remote/session'); return { status: r.status, body: await r.json() }; });
  expect(session.status).toBe(401);
  expect(session.body).toMatchObject({ code: 'invite_ended' });
  // Nothing she types reaches the others; Bia keeps working and Ana's reload says why she is out.
  await editor(a.page).click({ timeout: 3_000 }).catch(() => {});
  await a.page.keyboard.type(' invasora').catch(() => {});
  await editor(b.page).click();
  await b.page.keyboard.press('End');
  await b.page.keyboard.type(' e a Bia');
  await expect(editor(b.page)).toContainText('Olá da Ana e a Bia');
  await expect(editor(b.page)).not.toContainText('invasora');
  // Her browser, back at the link, gets a plain page (the app does not even load without a live invite).
  await a.page.reload();
  await expect(a.page.getByRole('heading', { name: 'Este convite foi revogado ou expirou.' })).toBeVisible();
  await expect(a.page.getByText('Peça um novo link a quem compartilhou.')).toBeVisible();
  expect(await a.page.getByRole('navigation', { name: 'Workspace' }).count()).toBe(0);
  await a.context.close();
  await b.context.close();
});

test('an invite that expires ends its guest\'s session on the clock', async ({ browser }) => {
  const dani = await invite('Dani', 'view', '1h');
  const d = await guest(browser, dani.url);
  await openNotes(d.page);
  await stack.advance(3_600_000 + 2_000);
  await expect(d.page.getByText('Seu acesso a este compartilhamento terminou')).toBeVisible({ timeout: 10_000 });
  await d.page.reload();
  await expect(d.page.getByRole('heading', { name: 'Este convite foi revogado ou expirou.' })).toBeVisible();
  const status = (await stack.api<StackStatus>('/api/share')).body;
  expect(status.invites.map((entry) => entry.name)).toEqual(['Link para editar', 'Link só para ver']);
  await d.context.close();
});

test('roles: edit changes the workspace; comment and view see it live but change nothing', async ({ browser }) => {
  const editorInvite = await invite('Edu', 'edit', 'never');
  const commentInvite = await invite('Cris', 'comment', 'never');
  const viewInvite = await invite('Vera', 'view', 'never');
  const e = await guest(browser, editorInvite.url);
  const c = await guest(browser, commentInvite.url);
  const v = await guest(browser, viewInvite.url);
  for (const { page } of [e, c, v]) await openNotes(page);
  await expect(e.page.getByRole('note').filter({ hasText: 'Somente leitura' })).toHaveCount(0);
  for (const { page } of [c, v]) await expect(page.getByRole('note').filter({ hasText: 'Somente leitura' })).toBeVisible();

  await editor(e.page).click();
  await e.page.keyboard.press('End');
  await e.page.keyboard.type(' mundo');
  await expect(editor(c.page)).toContainText('Olá mundo');
  await expect(editor(v.page)).toContainText('Olá mundo');
  for (const { page } of [c, v]) {
    await editor(page).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' intruso');
    await expect(editor(page)).not.toContainText('intruso');
  }
  await expect(editor(e.page)).not.toContainText('intruso');
  // The host itself refuses a hand-made write of a doc from a comment invite (it writes comments, nothing else: see comments.spec.ts).
  const refused = await c.page.evaluate(async () => {
    const { repo, csrf } = await (await fetch('/api/remote/session')).json();
    const r = await fetch('/api/remote/workspace', { method: 'POST', headers: { 'content-type': 'application/json', 'x-strukt-csrf': csrf }, body: JSON.stringify({ repo, path: 'docs/notas.md', text: 'x', expected: null }) });
    return r.status;
  });
  expect(refused).toBe(403);
  await e.context.close();
  await c.context.close();
  await v.context.close();
});

test('the audit says who joined with which role and what they wrote and were refused, without any content', async ({ browser }) => {
  const writer = await invite('Gabi', 'edit', 'never');
  const reader = await invite('Hugo', 'view', 'never');
  const w = await guest(browser, writer.url);
  const r = await guest(browser, reader.url);
  await openNotes(w.page);
  await openNotes(r.page);
  await w.page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Mapa' }).click();
  await expect(w.page.locator('.react-flow__node')).toHaveCount(3);
  await expect(w.page.getByRole('button', { name: 'Adicionar nó (N)' })).toBeEnabled();
  await w.page.getByRole('button', { name: 'Adicionar nó (N)' }).click();
  await expect(w.page.locator('.react-flow__node')).toHaveCount(4);
  await r.page.evaluate(async () => {
    const { repo, csrf } = await (await fetch('/api/remote/session')).json();
    await fetch('/api/remote/workspace', { method: 'POST', headers: { 'content-type': 'application/json', 'x-strukt-csrf': csrf }, body: JSON.stringify({ repo, path: 'docs/notas.md', text: 'segredo-do-hugo', expected: null }) });
  });
  await expect.poll(async () => {
    const entries = (await stack.api<{ entries: Array<{ type: string; invite?: string; role?: string; path?: string }> }>('/api/share/audit')).body.entries;
    return {
      joins: entries.filter((entry) => entry.type === 'join').map((entry) => `${entry.invite}:${entry.role}`).sort(),
      wrote: entries.some((entry) => entry.type === 'write' && entry.invite === 'Gabi' && entry.path === 'diagrams/mapa.strukt.json'),
      refused: entries.some((entry) => entry.type === 'denied' && entry.invite === 'Hugo'),
    };
  }, { timeout: 15_000 }).toEqual({ joins: ['Gabi:edit', 'Hugo:view'], wrote: true, refused: true });
  const raw = JSON.stringify((await stack.api('/api/share/audit')).body);
  for (const secret of ['segredo-do-hugo', writer.url.split('token=')[1]!, reader.url.split('token=')[1]!, '127.0.0.1']) expect(raw).not.toContain(secret);
  await w.context.close();
  await r.context.close();
});
