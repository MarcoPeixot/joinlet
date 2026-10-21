import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { panelsTrigger, togglePanel } from './panelMenu';
import { startShareStack } from './support/shareStack';
import type { ShareStack, StackInvite, StackStatus } from './support/shareStack';

// Comments between real sessions: the owner's share routes and a collaboration host (real process, real sockets) with
// browsers as guests (needs the web build, see support/collabHost.ts). Guests have fixed names so the labels are known.
let stack: ShareStack;
test.beforeEach(async () => {
  stack = await startShareStack();
  expect((await stack.api<StackStatus>('/api/share/start', { dir: stack.root })).status).toBe(200);
});
test.afterEach(async () => { await stack?.dispose(); });

async function invite(name: string, role: 'edit' | 'comment' | 'view'): Promise<StackInvite> {
  const { body } = await stack.api<StackStatus>('/api/share/invites', { name, role, ttl: 'never' });
  return body.invites.find((entry) => entry.name === name)!;
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Workspace' });
const pins = (page: Page) => page.locator('[data-comment-pin]');
const COMMENTS = () => join(stack.root, '.arch', 'comments', 'diagram-mapa.json');

async function guest(browser: Browser, link: string, name: string, color: string) {
  const context = await browser.newContext();
  await context.addInitScript(([n, c, col]) => sessionStorage.setItem('strukt:collaborator', JSON.stringify({ name: n, cid: c, color: col })), [name, `${name.toLowerCase()}-00000001`, color]);
  const page = await context.newPage();
  await page.goto(link);
  await expect(sidebar(page)).toBeVisible();
  return { page, context };
}

async function openMap(page: Page) {
  await sidebar(page).getByRole('button', { name: 'Mapa', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
}

/** Comment tool, then a click on a node: the composer opens beside it. */
async function startOnNode(page: Page, id: string) {
  await page.getByRole('button', { name: 'Comentar (C)' }).click();
  await page.locator(`.react-flow__node[data-id="${id}"]`).click();
}

test('a comment reaches the other guest live, is answered and resolved there, and a mention is for whom it names', async ({ browser }) => {
  const ana = await guest(browser, (await invite('Ana', 'edit')).url, 'Ana', '#3972dc');
  const cris = await guest(browser, (await invite('Cris', 'comment')).url, 'Cris', '#319b77');
  await Promise.all([openMap(ana.page), openMap(cris.page)]);
  await expect(cris.page.locator('header [data-person="Ana"]')).toBeVisible();

  // Cris comments on the API node and mentions Ana from the list of who is in the room.
  await startOnNode(cris.page, 'API');
  const composer = cris.page.getByRole('dialog', { name: 'Novo comentário sobre API' });
  await expect(composer).toBeVisible();
  const box = composer.getByRole('combobox', { name: 'Novo comentário' });
  await box.fill('Falta um timeout aqui, @An');
  await expect(composer.getByRole('option', { name: /Ana/ })).toBeVisible();
  await box.press('Enter'); // takes the suggestion
  await expect(box).toHaveValue('Falta um timeout aqui, @Ana ');
  await box.press('Enter'); // sends
  await expect(pins(cris.page)).toHaveCount(1);

  // Ana sees it without doing anything (the file is polled every 3 s), with the "for you" mark on the trigger.
  await expect(pins(ana.page)).toHaveCount(1, { timeout: 10_000 });
  await expect(panelsTrigger(ana.page)).toContainText('@1');
  await togglePanel(ana.page, 'Comentários');
  const panel = ana.page.getByRole('complementary', { name: 'Comentários' });
  const thread = panel.locator('[data-thread]');
  await expect(thread).toContainText('Falta um timeout aqui, @Ana');
  await expect(thread).toContainText('Para você');
  await expect(thread.locator('[data-message] span', { hasText: '@Ana' }).first()).toBeVisible();

  // Ana answers; Cris sees the second message on the pin.
  await thread.getByRole('combobox', { name: 'Responder à conversa' }).fill('Combinado, subo o timeout para 2 s.');
  await thread.getByRole('button', { name: 'Responder', exact: true }).click();
  await expect(thread).toContainText('Combinado, subo o timeout');
  await expect(pins(cris.page).first()).toHaveAttribute('aria-label', /2 mensagens/, { timeout: 10_000 });

  // Ana resolves it: it leaves the open list and the pin goes away for Cris (once he closes the conversation he had open),
  // who finds it under Resolvidos and reopens it.
  await cris.page.getByRole('dialog').getByRole('button', { name: 'Fechar conversa' }).click();
  await thread.getByRole('button', { name: 'Resolver', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Resolvidos (1)' })).toBeVisible();
  await expect(pins(cris.page)).toHaveCount(0, { timeout: 10_000 });
  await togglePanel(cris.page, 'Comentários');
  const crisPanel = cris.page.getByRole('complementary', { name: 'Comentários' });
  await crisPanel.getByRole('button', { name: /^Resolvidos/ }).click();
  const resolved = crisPanel.locator('[data-thread]');
  await expect(resolved).toContainText('Resolvido por Ana');
  await resolved.getByRole('button', { name: 'Reabrir', exact: true }).click();
  await expect(pins(ana.page)).toHaveCount(1, { timeout: 10_000 });

  // What is on disk: the author's name and color, the invite as owner, never a token.
  const saved = await readFile(COMMENTS(), 'utf8');
  expect(saved).toContain('Falta um timeout aqui, @Ana');
  expect(saved).toMatch(/"owner": "i:[0-9a-f-]{36}"/);
  expect(JSON.parse(saved).threads[0].messages.map((message: { author: { name: string } }) => message.author.name)).toEqual(['Cris', 'Ana']);
  for (const link of [ana, cris]) expect(saved).not.toContain(link.page.url().split('token=')[1] ?? 'sem-token');
  await ana.context.close();
  await cris.context.close();
});

test('roles: view only reads, comment writes comments and only as itself, edit moderates', async ({ browser }) => {
  const ana = await guest(browser, (await invite('Ana', 'edit')).url, 'Ana', '#3972dc');
  const cris = await guest(browser, (await invite('Cris', 'comment')).url, 'Cris', '#319b77');
  const vera = await guest(browser, (await invite('Vera', 'view')).url, 'Vera', '#a572d4');
  await Promise.all([openMap(ana.page), openMap(cris.page), openMap(vera.page)]);

  await startOnNode(ana.page, 'Web');
  await ana.page.getByRole('combobox', { name: 'Novo comentário' }).fill('Da Ana, sobre o Web');
  await ana.page.getByRole('button', { name: 'Comentar', exact: true }).click();
  await expect(pins(vera.page)).toHaveCount(1, { timeout: 10_000 });
  await expect(pins(cris.page)).toHaveCount(1, { timeout: 10_000 });

  // Vera reads the conversation and has no way to write one: no tool, no reply box.
  await expect(vera.page.getByRole('button', { name: 'Comentar (C)' })).toHaveCount(0);
  await togglePanel(vera.page, 'Comentários');
  const veraPanel = vera.page.getByRole('complementary', { name: 'Comentários' });
  await expect(veraPanel.locator('[data-thread]')).toContainText('Da Ana, sobre o Web');
  await expect(veraPanel.getByRole('combobox')).toHaveCount(0);
  await expect(veraPanel.getByRole('button', { name: 'Resolver' })).toHaveCount(0);

  // Hand-made requests, as a hostile guest would send them: the host holds the line, not the app.
  const write = (page: Page, body: (current: string | null) => Record<string, unknown>) => page.evaluate(async (make) => {
    const { repo, csrf } = await (await fetch('/api/remote/session')).json();
    const path = 'comments/diagram-mapa.json';
    const current = (await (await fetch(`/api/remote/workspace?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}`)).json()).text as string | null;
    const payload = (0, eval)(`(${make})`)(current);
    const response = await fetch('/api/remote/workspace', { method: 'POST', headers: { 'content-type': 'application/json', 'x-strukt-csrf': csrf }, body: JSON.stringify({ repo, path, expected: current, ...payload }) });
    return { status: response.status, error: (await response.json()).error as string | undefined };
  }, body.toString());
  const forged = (current: string | null) => ({ text: String(current).replace('Da Ana, sobre o Web', 'Ana jamais disse isso') });
  expect((await write(vera.page, forged)).status).toBe(403);
  const refused = await write(cris.page, forged);
  expect(refused).toMatchObject({ status: 403 });
  expect(refused.error).toMatch(/próprios/);
  expect((await write(cris.page, () => ({ remove: true }))).status).toBe(403);
  expect((await readFile(COMMENTS(), 'utf8'))).toContain('Da Ana, sobre o Web');
  const docWrite = await cris.page.evaluate(async () => {
    const { repo, csrf } = await (await fetch('/api/remote/session')).json();
    return (await fetch('/api/remote/workspace', { method: 'POST', headers: { 'content-type': 'application/json', 'x-strukt-csrf': csrf }, body: JSON.stringify({ repo, path: 'docs/notas.md', text: 'invadido', expected: 'Olá' }) })).status;
  });
  expect(docWrite).toBe(403);

  // Cris, who may comment, replies as himself and cannot edit Ana's message in the app either.
  await togglePanel(cris.page, 'Comentários');
  const crisThread = cris.page.getByRole('complementary', { name: 'Comentários' }).locator('[data-thread]');
  await crisThread.getByRole('combobox', { name: 'Responder à conversa' }).fill('Resposta do Cris');
  await crisThread.getByRole('button', { name: 'Responder', exact: true }).click();
  await expect(crisThread).toContainText('Resposta do Cris');
  await expect(crisThread.getByRole('button', { name: 'Ações do comentário de Ana' })).toHaveCount(0);
  await expect(crisThread.getByRole('button', { name: 'Ações do comentário de Cris' })).toBeVisible();

  // Ana (edit) moderates: she deletes Cris's reply and it disappears for him.
  await togglePanel(ana.page, 'Comentários');
  const anaThread = ana.page.getByRole('complementary', { name: 'Comentários' }).locator('[data-thread]');
  await expect(anaThread).toContainText('Resposta do Cris', { timeout: 10_000 });
  await anaThread.getByRole('button', { name: 'Ações do comentário de Cris' }).click();
  await ana.page.getByRole('menuitem', { name: 'Excluir comentário' }).click();
  await expect(anaThread).not.toContainText('Resposta do Cris');
  await expect(crisThread).not.toContainText('Resposta do Cris', { timeout: 10_000 });
  expect(await readFile(COMMENTS(), 'utf8')).not.toContain('Resposta do Cris');
  await Promise.all([ana.context.close(), cris.context.close(), vera.context.close()]);
});

test('a comment on a passage of a doc is marked in the editor for the others and follows the passage when the text is edited', async ({ browser }) => {
  const ana = await guest(browser, (await invite('Ana', 'edit')).url, 'Ana', '#3972dc');
  const cris = await guest(browser, (await invite('Cris', 'comment')).url, 'Cris', '#319b77');
  for (const { page } of [ana, cris]) await sidebar(page).getByRole('button', { name: 'Notas', exact: true }).click();
  const editor = (page: Page) => page.getByLabel('Editor do documento').locator('.cm-content');
  await expect(editor(cris.page)).toContainText('Olá');

  await editor(cris.page).click();
  await cris.page.keyboard.press('ControlOrMeta+a');
  await cris.page.getByRole('button', { name: /^Comentar a seleção/ }).click();
  const draft = cris.page.getByRole('complementary', { name: 'Comentários' }).locator('[data-draft]');
  await expect(draft).toContainText('Novo comentário sobre “Olá”');
  await draft.getByRole('combobox', { name: 'Novo comentário' }).fill('Cumprimento formal demais?');
  await draft.getByRole('button', { name: 'Comentar', exact: true }).click();
  await expect(cris.page.locator('.cm-comment')).toHaveText('Olá');

  await expect(ana.page.locator('.cm-comment')).toHaveText('Olá', { timeout: 10_000 });
  // Ana edits the text before the passage: the mark stays on "Olá".
  await editor(ana.page).click();
  await ana.page.keyboard.press('ControlOrMeta+Home');
  await ana.page.keyboard.type('Bom dia a todos. ');
  await expect(editor(cris.page)).toContainText('Bom dia a todos. Olá');
  await expect(ana.page.locator('.cm-comment')).toHaveText('Olá');
  await expect(cris.page.locator('.cm-comment')).toHaveText('Olá');
  // Clicking the mark opens the conversation in the panel.
  await ana.page.locator('.cm-comment').click();
  const panel = ana.page.getByRole('complementary', { name: 'Comentários' });
  await expect(panel.locator('[data-thread]')).toContainText('Cumprimento formal demais?');
  await ana.context.close();
  await cris.context.close();
});

test('working alone, with no one to share with: it asks for a name once and the comments survive a reload', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
  await startOnNode(page, 'Kafka');
  const dialog = page.getByRole('dialog', { name: 'Novo comentário sobre Kafka' });
  await dialog.getByPlaceholder('Seu nome').fill('Marco');
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await dialog.getByRole('combobox', { name: 'Novo comentário' }).fill('Revisar as partições deste tópico');
  await dialog.getByRole('button', { name: 'Comentar', exact: true }).click();
  await expect(pins(page)).toHaveCount(1);
  await expect(pins(page).first()).toHaveAttribute('aria-label', /Marco/);
  await page.reload();
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
  await expect(pins(page)).toHaveCount(1);
  // The same person, named: no prompt the second time.
  await startOnNode(page, 'Kafka');
  await expect(page.getByRole('dialog', { name: 'Novo comentário sobre Kafka' }).getByRole('combobox', { name: 'Novo comentário' })).toBeVisible();
  await expect(page.getByPlaceholder('Seu nome')).toHaveCount(0);
});
