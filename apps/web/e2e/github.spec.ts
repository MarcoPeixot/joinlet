import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { panelsTrigger, togglePanel } from './panelMenu';

const repo = {
  root: '/Users/ana/loja',
  archDir: '/Users/ana/loja/.arch',
  nameWithOwner: 'ana/loja',
  branch: 'feat/arch',
  defaultBase: 'main',
  ghReady: true,
};

/** The local server endpoints, stubbed: no git, no gh, no network. */
async function stubGit(page: Page, options: { changes?: number; publishFails?: boolean; authConnected?: boolean; needsInit?: boolean; onCopy?: (files: Record<string, string>) => void; healthIssues?: boolean } = {}) {
  const changes = options.changes ?? 2;
  const authConnected = options.authConnected ?? true;
  const calls: string[] = [];
  let authPolls = 0;
  await page.route('**/api/git/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push(`${request.method()} ${url.pathname}`);
    if (url.pathname === '/api/git/auth') {
      return route.fulfill({ json: { configured: true, connected: authConnected, login: authConnected ? 'ana' : null } });
    }
    if (url.pathname === '/api/git/auth/device' && request.method() === 'POST') {
      return route.fulfill({ json: { id: 'flow-1', userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device', intervalSeconds: 0 } });
    }
    if (url.pathname === '/api/git/auth/device/flow-1') {
      authPolls++;
      return route.fulfill({ json: authPolls < 2 ? { state: 'pending', retryAfter: 0 } : { state: 'connected', login: 'ana' } });
    }
    if (url.pathname === '/api/git/auth/disconnect') {
      return route.fulfill({ json: { configured: true, connected: false, login: null } });
    }
    if (url.pathname === '/api/git/status') {
      const list = [
        { status: 'M', path: '.arch/diagrams/exemplo.strukt.json' },
        { status: '??', path: '.arch/docs/decisoes.md' },
      ].slice(0, changes);
      return route.fulfill({ json: { ok: true, repo, changes: list } });
    }
    if (url.pathname === '/api/git/connect') {
      const body = request.postDataJSON() as { files?: Record<string, string> };
      if (options.needsInit && !body.files) return route.fulfill({ status: 409, json: { needsInit: true, root: repo.root } });
      if (body.files) options.onCopy?.(body.files);
      return route.fulfill({ json: { repo, changed: ['.mcp.json'], conflicts: [], initialized: !!body.files } });
    }
    if (url.pathname === '/api/git/diff') {
      return route.fulfill({ json: { ok: true, markdown: '## Arquitetura — `main` → `árvore de trabalho`\n\n### Exemplo (`exemplo`)\n\n- Adicionados: `Cache`' } });
    }
    if (url.pathname === '/api/git/diagram') {
      return route.fulfill({ json: { ok: true, ref: 'main', json: '{"version":1,"nodes":[],"connections":[]}', layout: null, shared: '{"version":1,"entities":{"old":{"id":"old"}},"views":{}}', flows: '[{"id":"f","title":"Antigo","steps":[]}]' } });
    }
    if (url.pathname === '/api/git/health') {
      return route.fulfill({ json: { ok: true, concerns: [], evidence: options.healthIssues ? [{ diagram: 'exemplo', id: 'API', path: 'src/api.ts', message: 'Arquivo não encontrado.' }] : [] } });
    }
    if (url.pathname === '/api/git/publish') {
      if (options.publishFails) return route.fulfill({ status: 400, json: { ok: false, error: 'Nada para publicar: .arch/ não tem mudanças.' } });
      return route.fulfill({ json: { ok: true, url: 'https://github.com/ana/loja/pull/12', branch: 'strukt/atualiza-a-arquitetura' } });
    }
    if (url.pathname === '/api/git/pr') {
      return route.fulfill({ json: { ok: true, text: 'PR https://github.com/ana/loja/pull/12\nreview: pendente' } });
    }
    return route.fulfill({ status: 404, json: { error: 'nope' } });
  });
  await page.route('**/api/workspace*', async (route) => {
    const path = new URL(route.request().url()).searchParams.get('path');
    if (path === 'strukt.json') return route.fulfill({ json: { text: '{"version":1,"name":"Loja","diagrams":[{"slug":"exemplo","title":"Exemplo"}],"docs":[],"sketches":[]}' } });
    if (path === 'diagrams/exemplo.strukt.json') return route.fulfill({ json: { text: '{"version":1,"nodes":[{"id":"API"}],"connections":[]}' } });
    if (path) return route.fulfill({ json: { text: null } });
    return route.fulfill({ json: { files: ['strukt.json', 'diagrams/exemplo.strukt.json'], stamps: { 'strukt.json': 1, 'diagrams/exemplo.strukt.json': 1 }, root: repo.root } });
  });
  return calls;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
});

test('GitHub panel: connect a repo, see the changes and the semantic diff, publish the PR', async ({ page }) => {
  const calls = await stubGit(page);
  await togglePanel(page, 'GitHub');
  const panel = page.getByRole('complementary', { name: 'GitHub' });

  // No path yet: the panel explains and asks for the repository folder.
  await expect(panel.getByText('Escolha o repositório local cujo .arch/ você quer revisar e publicar.')).toBeVisible();
  await panel.getByPlaceholder('/caminho/do/repositório').fill('/Users/ana/loja');
  await panel.getByRole('button', { name: 'Conectar repositório' }).click();

  await expect(panel.getByText('ana/loja', { exact: true })).toBeVisible();
  await expect(panel.getByText('GitHub autenticado')).toBeVisible();
  await expect(panel.getByText('.arch/diagrams/exemplo.strukt.json')).toBeVisible();
  await expect(panel.getByText('2 arquivos')).toBeVisible();

  await panel.getByRole('button', { name: 'Ver diff semântico' }).click();
  await expect(panel.getByRole('heading', { name: /Arquitetura/ })).toBeVisible();
  await expect(panel.getByText('Adicionados:')).toBeVisible();

  await panel.getByRole('button', { name: 'Publicar PR' }).click();
  await expect(panel.getByRole('link', { name: 'https://github.com/ana/loja/pull/12' })).toBeVisible();
  await expect(page.getByText('PR aberto: https://github.com/ana/loja/pull/12')).toBeVisible();

  await panel.getByRole('button', { name: 'Ver status do PR' }).click();
  await expect(panel.getByText('review: pendente')).toBeVisible();
  expect(calls).toContain('POST /api/git/publish');
  await panel.getByRole('button', { name: 'Fechar' }).click();
  await expect(panel).toHaveCount(0);
});

test('GitHub panel initializes .arch from the current browser workspace', async ({ page }) => {
  let copied: Record<string, string> | null = null;
  await stubGit(page, { needsInit: true, onCopy: (files) => { copied = files; } });
  page.on('dialog', (dialog) => void dialog.accept());
  await togglePanel(page, 'GitHub');
  const panel = page.getByRole('complementary', { name: 'GitHub' });
  await panel.getByPlaceholder('/caminho/do/repositório').fill('/Users/ana/loja');
  await panel.getByRole('button', { name: 'Conectar repositório' }).click();
  await expect(panel.getByText(/Workspace copiado para \.arch\//)).toBeVisible();
  expect(copied?.['strukt.json']).toContain('diagrams');
  expect(Object.keys(copied ?? {}).some((path) => path.startsWith('diagrams/'))).toBe(true);
});

test('GitHub panel: the Painéis trigger signals the pending .arch/ changes and the menu counts them', async ({ page }) => {
  await stubGit(page);
  await expect(panelsTrigger(page)).toHaveAccessibleName('Painéis');
  await togglePanel(page, 'GitHub');
  const panel = page.getByRole('complementary', { name: 'GitHub' });
  await panel.getByPlaceholder('/caminho/do/repositório').fill('/Users/ana/loja');
  await panel.getByRole('button', { name: 'Conectar repositório' }).click();
  await expect(panel.getByText('ana/loja', { exact: true })).toBeVisible();
  await expect(panelsTrigger(page)).toHaveAccessibleName('Painéis: GitHub (2 mudanças pendentes no .arch/)');
  await panel.getByRole('button', { name: 'Fechar' }).click();
  await expect(panel).toHaveCount(0);
  await expect(panelsTrigger(page)).toHaveAccessibleName('Painéis (2 mudanças pendentes no .arch/)');
  await panelsTrigger(page).click();
  await expect(page.getByRole('menuitemcheckbox', { name: /^GitHub/ })).toContainText('2');
});

test('GitHub panel compares the current diagram with a Git ref on the canvas', async ({ page }) => {
  const calls = await stubGit(page);
  await togglePanel(page, 'GitHub');
  const dialog = page.getByRole('complementary', { name: 'GitHub' });
  await dialog.getByPlaceholder('/caminho/do/repositório').fill('/Users/ana/loja');
  await dialog.getByRole('button', { name: 'Conectar repositório' }).click();
  await expect(page.locator('.react-flow__node[data-id="API"]')).toBeVisible();
  await dialog.getByRole('button', { name: 'Comparar no canvas' }).click();
  const compare = page.getByRole('complementary', { name: 'Comparação com Git' });
  await expect(compare).toContainText('API');
  await expect(compare).toContainText('Modelo e fluxos');
  await expect(page.locator('.react-flow__node[data-id="API"]')).toHaveClass(/sk-diff-added/);
  await compare.getByRole('button', { name: 'Encerrar comparação' }).click();
  await expect(page.locator('.react-flow__node[data-id="API"]')).not.toHaveClass(/sk-diff-added/);
  expect(calls).toContain('POST /api/git/diagram');
});

test('accuracy panel shows broken evidence from the connected repository', async ({ page }) => {
  await stubGit(page, { healthIssues: true });
  await togglePanel(page, 'GitHub');
  const dialog = page.getByRole('complementary', { name: 'GitHub' });
  await dialog.getByPlaceholder('/caminho/do/repositório').fill('/Users/ana/loja');
  await dialog.getByRole('button', { name: 'Conectar repositório' }).click();
  await expect(dialog.getByText('ana/loja', { exact: true })).toBeVisible();
  await togglePanel(page, 'Precisão');
  const panel = page.getByRole('complementary', { name: 'Precisão da arquitetura' });
  await expect(panel).toContainText('src/api.ts');
  await expect(panel).toContainText('Arquivo não encontrado.');
});

test('GitHub panel: a publish error shows in pt-BR and keeps the form', async ({ page }) => {
  await stubGit(page, { publishFails: true });
  await togglePanel(page, 'GitHub');
  const panel = page.getByRole('complementary', { name: 'GitHub' });
  await panel.getByPlaceholder('/caminho/do/repositório').fill('/Users/ana/loja');
  await panel.getByRole('button', { name: 'Conectar repositório' }).click();
  await expect(panel.getByText('ana/loja', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Publicar PR' }).click();
  await expect(panel.getByText('Nada para publicar: .arch/ não tem mudanças.')).toBeVisible();
});

test('GitHub panel: without the local server it explains instead of failing silently', async ({ page }) => {
  await page.route('**/api/git/**', (route) => route.abort());
  await togglePanel(page, 'GitHub');
  const panel = page.getByRole('complementary', { name: 'GitHub' });
  await panel.getByPlaceholder('/caminho/do/repositório').fill('/Users/ana/loja');
  await panel.getByRole('button', { name: 'Conectar repositório' }).click();
  await expect(panel.getByText(/Servidor local indisponível/).first()).toBeVisible();
});

test('GitHub panel: direct OAuth shows the device code, then confirms the signed-in account', async ({ page }) => {
  const calls = await stubGit(page, { authConnected: false });
  await togglePanel(page, 'GitHub');
  const panel = page.getByRole('complementary', { name: 'GitHub' });

  await panel.getByRole('button', { name: 'Conectar com GitHub' }).click();
  await expect(panel.getByText('ABCD-EFGH')).toBeVisible();
  await expect(panel.getByRole('link', { name: /Abrir GitHub/ })).toHaveAttribute('href', 'https://github.com/login/device');
  await expect(panel.getByText('Conectado como @ana')).toBeVisible({ timeout: 4000 });
  expect(calls).toContain('POST /api/git/auth/device');
  expect(calls).toContain('GET /api/git/auth/device/flow-1');
});

test('GitHub panel: it will not publish through another gh account before OAuth login', async ({ page }) => {
  await stubGit(page, { authConnected: false });
  await togglePanel(page, 'GitHub');
  const panel = page.getByRole('complementary', { name: 'GitHub' });
  await panel.getByPlaceholder('/caminho/do/repositório').fill('/Users/ana/loja');
  await panel.getByRole('button', { name: 'Conectar repositório' }).click();
  await expect(panel.getByRole('button', { name: 'Publicar PR' })).toBeDisabled();
  await expect(panel.getByText('Entre com o GitHub primeiro')).toBeVisible();
});

test('GitHub panel is a lateral stepper: OAuth setup is collapsed and connect needs only the folder', async ({ page }) => {
  await page.route('**/api/git/auth', (route) => route.fulfill({ json: { configured: false, connected: false, login: null } }));
  await togglePanel(page, 'GitHub');
  const panel = page.getByRole('complementary', { name: 'GitHub' });
  await expect(panel.getByRole('list', { name: 'Etapas' })).toContainText('1. Conta GitHub');
  await expect(panel.getByRole('list', { name: 'Etapas' })).toContainText('2. Pasta do repositório');
  const setup = panel.locator('details', { hasText: 'Configurar OAuth (servidor)' });
  await expect(setup).toBeVisible();
  await expect(setup).not.toHaveAttribute('open', '');
  await expect(panel.getByText('opcional para uso local')).toBeVisible();
  // Connecting needs only the folder path: disabled, with the reason, until one is typed.
  const connect = panel.getByRole('button', { name: 'Conectar repositório' });
  await expect(connect).toBeDisabled();
  await expect(connect).toHaveAttribute('aria-describedby', 'connect-reason');
  await expect(panel.getByText('Informe o caminho da pasta')).toBeVisible();
  await panel.getByPlaceholder('/caminho/do/repositório').fill('/Users/ana/loja');
  await expect(connect).toBeEnabled();
  // It shares the exclusive right slot with the other panels.
  await togglePanel(page, 'Fluxos');
  await expect(panel).toHaveCount(0);
});

test('the Painéis menu groups the panels by intent and explains Precisão', async ({ page }) => {
  await panelsTrigger(page).click();
  const menu = page.getByRole('menu', { name: 'Painéis' });
  for (const name of ['Explorar', 'Publicar']) await expect(menu.getByRole('group', { name })).toBeVisible();
  await expect(menu.getByRole('group', { name: 'Explorar' }).getByRole('menuitemcheckbox', { name: /^Precisão/ })).toContainText('Apontamentos e evidências');
  await expect(menu.getByRole('group', { name: 'Publicar' }).getByRole('menuitemcheckbox', { name: /^GitHub/ })).toBeVisible();
});
