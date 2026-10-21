import { expect, test } from '@playwright/test';
import { readFile } from './storage';
import { togglePanel } from './panelMenu';
import { diagramUiHtml } from '../../mcp/src/view';

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
});

test('a guided flow records a selected connection and survives reload', async ({ page }) => {
  await togglePanel(page, 'Fluxos');
  page.once('dialog', (dialog) => void dialog.accept('Checkout'));
  await page.getByRole('button', { name: 'Novo fluxo' }).click();
  await page.getByRole('combobox', { name: 'Conexão para adicionar' }).selectOption('Web App→API Gateway');
  await page.getByRole('button', { name: 'Adicionar conexão selecionada' }).click();
  await expect(page.getByRole('complementary', { name: 'Fluxos guiados' })).toContainText('Web App → API Gateway');
  await expect.poll(async () => JSON.parse((await readFile(page, 'diagrams/exemplo.flows.json')) ?? '[]')[0]?.steps?.length).toBe(1);
  await page.reload();
  await togglePanel(page, 'Fluxos');
  await expect(page.getByRole('complementary', { name: 'Fluxos guiados' })).toContainText('Checkout');
});

test('imports a Mermaid file as a new diagram', async ({ page }) => {
  await page.getByRole('button', { name: 'Mostrar/ocultar código' }).click();
  await page.locator('input[type="file"][accept*=".mmd"]').setInputFiles({
    name: 'checkout.mmd',
    mimeType: 'text/plain',
    buffer: Buffer.from('flowchart LR\nWeb[Frontend] -->|HTTPS| API[Backend]\n'),
  });
  await expect(page.locator('.react-flow__node[data-id="Web"]')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="API"]')).toBeVisible();
  await expect.poll(async () => JSON.parse((await readFile(page, 'diagrams/checkout.strukt.json')) ?? '{}').connections?.length).toBe(1);
});

test('drill-down and shared entities connect two diagrams', async ({ page }) => {
  const sidebar = page.getByRole('navigation', { name: 'Workspace' });
  await sidebar.getByRole('button', { name: 'Novo diagrama' }).click();
  await page.getByRole('textbox', { name: 'Nome do diagrama' }).fill('Detalhes');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /Adicionar nó/ }).first().click();
  await page.keyboard.type('Interna');
  await page.keyboard.press('Enter');
  await page.locator('.react-flow__node[data-id="Interna"]').click();
  await page.getByRole('tab', { name: 'Editar' }).click();
  await page.getByRole('button', { name: 'Compartilhar', exact: true }).click();
  await expect.poll(() => readFile(page, 'model.json')).not.toBeNull();
  const shared = JSON.parse((await readFile(page, 'model.json'))!);
  const entityId = Object.keys(shared.entities)[0]!;
  await sidebar.getByRole('button', { name: 'Exemplo', exact: true }).click();
  await page.locator('.react-flow__node[data-id="Pedidos"]').click();
  await page.getByRole('tab', { name: 'Editar' }).click();
  await page.getByRole('combobox', { name: 'Entidade compartilhada' }).selectOption(entityId);
  await page.getByRole('combobox', { name: 'Detalhar em' }).selectOption('detalhes');
  await expect.poll(async () => JSON.parse((await readFile(page, 'model.json'))!).views?.exemplo?.Pedidos).toBe(entityId);
  await page.locator('.react-flow__node[data-id="Pedidos"]').getByRole('button', { name: 'Abrir diagrama detalhado' }).click();
  await expect(page.locator('.react-flow__node[data-id="Interna"]')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Caminho dos diagramas' })).toContainText('Exemplo');
});

test('an element keeps its repository evidence in the workspace', async ({ page }) => {
  await page.locator('.react-flow__node[data-id="Pedidos"]').click();
  await page.getByRole('tab', { name: 'Editar' }).click();
  const evidence = page.getByRole('textbox', { name: 'Evidência no código' });
  await evidence.fill('src/pedidos.ts#L12');
  await evidence.press('Tab');
  await expect.poll(async () => JSON.parse((await readFile(page, 'evidence.json')) ?? '{}').exemplo?.Pedidos?.[0]?.line).toBe(12);
  await expect(page.locator('.react-flow__node[data-id="Pedidos"]').getByLabel('1 evidência no código')).toBeVisible();
});

test('the MCP App view handshakes and lets a user inspect a node', async ({ page }) => {
  await page.setContent('<main></main>');
  await page.evaluate((html) => {
    const frame = document.createElement('iframe');
    frame.title = 'MCP App';
    window.addEventListener('message', (event) => {
      if (event.source !== frame.contentWindow) return;
      if (event.data?.method === 'ui/initialize') frame.contentWindow?.postMessage({ jsonrpc: '2.0', id: event.data.id, result: { protocolVersion: '2026-01-26', hostInfo: { name: 'test', version: '1' }, hostCapabilities: {}, hostContext: {} } }, '*');
      if (event.data?.method === 'ui/notifications/initialized') frame.contentWindow?.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [], structuredContent: { title: 'Loja', nodes: [{ id: 'API', description: 'Recebe pedidos' }], edges: [], layout: { API: { x: 10, y: 10, w: 160, h: 64 } } } } }, '*');
    });
    frame.srcdoc = html;
    document.body.append(frame);
  }, diagramUiHtml);
  const view = page.frameLocator('iframe[title="MCP App"]');
  await expect(view.locator('h1')).toHaveText('Loja');
  await view.getByRole('button', { name: 'API' }).click();
  await expect(view.locator('#details')).toContainText('Recebe pedidos');
});

test('model explorer finds dependencies and tag lenses focus a shared component', async ({ page }) => {
  await page.locator('.react-flow__node[data-id="Pedidos"]').click();
  await page.getByRole('tab', { name: 'Editar' }).click();
  await page.getByRole('button', { name: 'Compartilhar', exact: true }).click();
  const tags = page.getByRole('textbox', { name: 'Tags da entidade' });
  await tags.fill('risco:alto');
  await tags.press('Tab');
  await togglePanel(page, 'Modelo');
  const panel = page.getByRole('complementary', { name: 'Modelo de arquitetura' });
  await panel.getByRole('combobox', { name: 'Lente de tags' }).selectOption('risco:alto');
  await expect(page.locator('.react-flow__node[data-id="Pedidos"]')).toHaveClass(/sk-focus-origin/);
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toHaveClass(/sk-dim/);
  await panel.getByRole('button', { name: /Pedidos/ }).click();
  await expect(panel).toContainText('Impacto potencial');
  await expect(panel).toContainText('API Gateway');
});

test('guided flow plays a process and two parallel connections', async ({ page }) => {
  await togglePanel(page, 'Fluxos');
  page.once('dialog', (dialog) => void dialog.accept('Compra'));
  await page.getByRole('button', { name: 'Novo fluxo' }).click();
  const panel = page.getByRole('complementary', { name: 'Fluxos guiados' });
  await panel.getByRole('combobox', { name: 'Tipo do novo passo' }).selectOption('process');
  await panel.getByRole('combobox', { name: 'Componente do processo' }).selectOption('Pedidos');
  await panel.getByRole('button', { name: 'Adicionar passo' }).click();
  await expect(panel).toContainText('Processo em Pedidos');
  await panel.getByRole('combobox', { name: 'Tipo do novo passo' }).selectOption('parallel');
  await panel.getByRole('button', { name: 'Adicionar passo' }).click();
  await panel.getByRole('combobox', { name: 'Conexão para adicionar' }).selectOption('Web App→API Gateway');
  await panel.getByRole('button', { name: 'Adicionar conexão ao ramo' }).nth(0).click();
  await panel.getByRole('combobox', { name: 'Conexão para adicionar' }).selectOption('API Gateway→Pedidos');
  await panel.getByRole('button', { name: 'Adicionar conexão ao ramo' }).nth(1).click();
  await panel.getByRole('button', { name: 'Próximo' }).click();
  await expect(page.locator('.react-flow__edge.sk-focus-edge')).toHaveCount(2);
  await expect.poll(async () => JSON.parse((await readFile(page, 'diagrams/exemplo.flows.json')) ?? '[]')[0]?.steps?.[1]?.branches?.[1]?.steps?.length).toBe(1);
});

test('accuracy inbox records and resolves a concern', async ({ page }) => {
  await page.locator('.react-flow__node[data-id="Pedidos"]').click();
  await page.getByRole('tab', { name: 'Editar' }).click();
  await page.getByRole('textbox', { name: 'Apontar imprecisão' }).fill('Falta o cache de pedidos.');
  await page.getByRole('button', { name: 'Registrar pendência' }).click();
  await togglePanel(page, 'Precisão');
  const inbox = page.getByRole('complementary', { name: 'Precisão da arquitetura' });
  await expect(inbox).toContainText('Falta o cache de pedidos.');
  await inbox.getByRole('button', { name: 'Marcar como resolvido' }).click();
  await expect(inbox).toContainText('Nenhum apontamento aberto');
  await expect.poll(async () => JSON.parse((await readFile(page, 'concerns.json')) ?? '[]')[0]?.status).toBe('resolved');
});

test('guided flow switches a choice and opens a flow in another diagram', async ({ page }) => {
  const sidebar = page.getByRole('navigation', { name: 'Workspace' });
  await sidebar.getByRole('button', { name: 'Novo diagrama' }).click();
  await page.getByRole('textbox', { name: 'Nome do diagrama' }).fill('Detalhes');
  await page.keyboard.press('Enter');
  await togglePanel(page, 'Fluxos');
  page.once('dialog', (dialog) => void dialog.accept('Interno'));
  await page.getByRole('button', { name: 'Novo fluxo' }).click();
  await sidebar.getByRole('button', { name: 'Exemplo', exact: true }).click();
  page.once('dialog', (dialog) => void dialog.accept('Compra'));
  await page.getByRole('button', { name: 'Novo fluxo' }).click();
  const panel = page.getByRole('complementary', { name: 'Fluxos guiados' });
  await panel.getByRole('combobox', { name: 'Tipo do novo passo' }).selectOption('choice');
  await panel.getByRole('button', { name: 'Adicionar passo' }).click();
  await panel.getByRole('combobox', { name: 'Conexão para adicionar' }).selectOption('Web App→API Gateway');
  await panel.getByRole('button', { name: 'Adicionar conexão ao ramo' }).nth(0).click();
  await panel.getByRole('combobox', { name: 'Conexão para adicionar' }).selectOption('API Gateway→Pedidos');
  await panel.getByRole('button', { name: 'Adicionar conexão ao ramo' }).nth(1).click();
  await panel.getByRole('combobox', { name: 'Ramo ativo do passo 1' }).selectOption('1');
  await expect(page.locator('.react-flow__edge[data-id="API Gateway→Pedidos"]')).toHaveClass(/sk-focus-edge/);
  await panel.getByRole('combobox', { name: 'Tipo do novo passo' }).selectOption('goto');
  await panel.getByRole('combobox', { name: 'Diagrama de destino' }).selectOption('detalhes');
  await expect.poll(() => readFile(page, 'diagrams/detalhes.flows.json')).not.toBeNull();
  const target = JSON.parse((await readFile(page, 'diagrams/detalhes.flows.json'))!)[0].id as string;
  await panel.getByRole('combobox', { name: 'Fluxo de destino' }).selectOption(target);
  await panel.getByRole('button', { name: 'Adicionar passo' }).click();
  await panel.getByRole('button', { name: 'Próximo' }).click();
  await panel.getByRole('button', { name: 'Abrir fluxo' }).click();
  await expect(sidebar.getByRole('button', { name: 'Detalhes', exact: true })).toBeVisible();
  await expect(panel).toContainText('Interno');
});

test('model panel fits a narrow viewport without widening the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  // On a phone the Painéis menu is icon-only and also carries Código and Apresentar.
  await page.getByRole('button', { name: 'Painéis' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Modelo' }).click();
  const panel = page.getByRole('complementary', { name: 'Modelo de arquitetura' });
  await expect(panel).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect.poll(async () => {
    const box = await panel.boundingBox();
    return (box?.x ?? 0) + (box?.width ?? 0);
  }).toBeLessThanOrEqual(390);
});
