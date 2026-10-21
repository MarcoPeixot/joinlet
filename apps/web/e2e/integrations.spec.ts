import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

type View = {
  webhooks: Record<'slack' | 'teams' | 'discord', { configured: boolean; host: string | null; hint: string | null; events: string[] }>;
  notion: { configured: boolean; hint: string | null; parentPageId: string | null };
  atlassian: { configured: boolean; site: string | null; email: string | null; hint: string | null };
  confluence: { spaceKey: string | null; parentId: string | null };
  jira: { projectKey: string | null; issueType: string | null };
};

/** A fake local server for /api/integrations*: keeps the view and records every request body (no network, no secrets). */
async function fakeServer(page: Page) {
  const bodies: { path: string; body: unknown }[] = [];
  const empty = { configured: false, host: null, hint: null, events: [] as string[] };
  const view: View = {
    webhooks: { slack: { ...empty }, teams: { ...empty }, discord: { ...empty } },
    notion: { configured: false, hint: null, parentPageId: null },
    atlassian: { configured: false, site: null, email: null, hint: null },
    confluence: { spaceKey: null, parentId: null },
    jira: { projectKey: null, issueType: null },
  };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/integrations', async (route) => {
    if (route.request().method() === 'POST') {
      const patch = route.request().postDataJSON() as { webhooks?: Record<string, { url?: string; events?: string[] } | null>; notion?: { token?: string; parentPageId?: string | null } | null; atlassian?: { site?: string; email?: string; token?: string } | null; confluence?: { spaceKey?: string } | null; jira?: { projectKey?: string; issueType?: string } | null };
      bodies.push({ path: '/api/integrations', body: patch });
      for (const [kind, hook] of Object.entries(patch.webhooks ?? {})) {
        const slot = view.webhooks[kind as 'slack'];
        if (hook === null) Object.assign(slot, empty);
        else {
          if (hook.url) Object.assign(slot, { configured: true, host: new URL(hook.url).hostname, hint: `…${hook.url.slice(-4)}`, events: slot.events.length ? slot.events : ['version', 'pr', 'drift'] });
          if (hook.events) slot.events = hook.events;
        }
      }
      if (patch.notion?.token) view.notion = { configured: true, hint: `…${patch.notion.token.slice(-4)}`, parentPageId: patch.notion.parentPageId ?? view.notion.parentPageId };
      else if (patch.notion?.parentPageId) view.notion.parentPageId = patch.notion.parentPageId;
      if (patch.atlassian?.token) view.atlassian = { configured: true, site: `https://${patch.atlassian.site}`, email: patch.atlassian.email ?? null, hint: `…${patch.atlassian.token.slice(-4)}` };
      if (patch.confluence?.spaceKey) view.confluence.spaceKey = patch.confluence.spaceKey;
      if (patch.jira?.projectKey) view.jira = { projectKey: patch.jira.projectKey, issueType: patch.jira.issueType ?? 'Task' };
    }
    await json(route, view);
  });
  await page.route('**/api/integrations/test', async (route) => {
    bodies.push({ path: '/api/integrations/test', body: route.request().postDataJSON() });
    await json(route, { ok: true, detail: 'Aviso enviado ao Slack.' });
  });
  await page.route('**/api/integrations/publish', async (route) => {
    bodies.push({ path: '/api/integrations/publish', body: route.request().postDataJSON() });
    await json(route, { ok: true, url: 'https://www.notion.so/Pagina-abc', warnings: ['Listas aninhadas além de 2 níveis foram achatadas.'] });
  });
  await page.route('**/api/integrations/notify', (route) => json(route, { sent: 0, failed: 0 }));
  return { bodies, view };
}

const SLACK = 'https://hooks.slack.com/services/T000/B000/XXXXXXXXabcd';

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
});

test('Integrações: save a Slack webhook (only the hint comes back), pick events, test and remove', async ({ page }) => {
  const server = await fakeServer(page);
  await page.getByRole('button', { name: 'Configurações (⌘,)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Configurações' });
  await dialog.getByRole('button', { name: 'Integrações' }).click();
  await expect(dialog.getByRole('heading', { name: 'Integrações' })).toBeVisible();

  const slack = dialog.getByRole('region', { name: 'Slack' });
  await expect(slack.getByText('Não configurada')).toBeVisible();
  await slack.getByLabel('Endereço do webhook (Slack)').fill(SLACK);
  await slack.getByRole('button', { name: 'Salvar' }).click();
  await expect(slack.getByText(/Salva neste computador …abcd/)).toBeVisible();
  // The URL is a secret: the field is cleared and the page never shows it again.
  await expect(slack.getByLabel('Endereço do webhook (Slack)')).toHaveValue('');
  await expect(dialog).not.toContainText('XXXXXXXX');
  await expect(slack.getByLabel('Endereço do webhook (Slack)')).toHaveAttribute('type', 'password');

  await slack.getByRole('switch', { name: /Deriva encontrada/ }).click();
  await expect.poll(() => server.view.webhooks.slack.events).toEqual(['version', 'pr']);

  await slack.getByRole('button', { name: 'Testar' }).click();
  await expect(slack.getByText('Aviso enviado ao Slack.')).toBeVisible();

  await slack.getByRole('button', { name: 'Remover' }).click();
  await expect(slack.getByText('Não configurada')).toBeVisible();
  expect(server.bodies.find((b) => b.path === '/api/integrations/test')?.body).toEqual({ target: 'slack' });
});

test('Integrações: configure Notion, then publish a doc with a diagram attached', async ({ page }) => {
  const server = await fakeServer(page);
  await page.getByRole('button', { name: 'Configurações (⌘,)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Configurações' });
  await dialog.getByRole('button', { name: 'Integrações' }).click();
  await dialog.getByRole('button', { name: /Notion, Confluence e Jira/ }).click();

  const notion = dialog.getByRole('region', { name: 'Notion' });
  await notion.getByLabel('Token da integração').fill('ntn_supersecret9876');
  await notion.getByLabel('Página-mãe (ID ou link)').fill('0123456789abcdef0123456789abcdef');
  await notion.getByRole('button', { name: 'Salvar' }).click();
  await expect(notion.getByText(/…9876/)).toBeVisible();
  await expect(dialog).not.toContainText('supersecret');

  await expect(dialog.getByText(/ainda não tem documentos/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Publicar no Notion' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Novo documento' }).click();
  await page.getByRole('textbox', { name: /documento/i }).fill('Pagamentos');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Configurações (⌘,)' }).click();
  await dialog.getByRole('button', { name: /Notion, Confluence e Jira/ }).click();
  const publish = dialog.getByRole('button', { name: 'Publicar no Notion' });
  await expect(dialog.getByLabel('Documento')).toHaveValue(/pagamentos/);
  await dialog.getByLabel('Diagrama anexado').selectOption({ index: 1 });
  await publish.click();
  await expect(dialog.getByText('Publicado no Notion.')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Abrir a página' })).toHaveAttribute('href', 'https://www.notion.so/Pagina-abc');
  await expect(dialog.getByText(/achatadas/)).toBeVisible();
  const sent = server.bodies.find((b) => b.path === '/api/integrations/publish')?.body as { target: string; svg?: string };
  expect(sent.target).toBe('notion');
  expect(sent.svg?.startsWith('<svg')).toBe(true);
});

test('Integrações: a server that is off is explained, not a blank panel', async ({ page }) => {
  await page.route('**/api/integrations', (route) => route.abort());
  await page.getByRole('button', { name: 'Configurações (⌘,)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Configurações' });
  await dialog.getByRole('button', { name: 'Integrações' }).click();
  await expect(dialog.getByRole('alert')).toContainText('servidor local');
});
