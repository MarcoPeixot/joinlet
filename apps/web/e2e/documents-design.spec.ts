import { axeFindings } from './support/axe';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from './storage';

const sample = `# Arquitetura de pagamentos

Uma visão do fluxo de pagamentos, das responsabilidades de cada serviço e das decisões que mantêm o sistema confiável.

## Visão geral

O **API Gateway** autentica as requisições e encaminha cada pagamento para o serviço responsável. Eventos assíncronos mantêm os sistemas integrados.

> Cada transação usa uma chave de idempotência para evitar cobranças duplicadas.

## Componentes

| Componente | Responsabilidade | Tecnologia |
| --- | --- | --- |
| API Gateway | Autenticação e roteamento | Nginx |
| Pagamentos | Processamento das transações | Node.js |
| Fila de eventos | Entrega assíncrona e retentativas | Kafka |

## Contrato da API

\`\`\`typescript
const payment = await client.payments.create({
  amount: 12900,
  currency: "BRL",
  idempotencyKey: request.id,
});
\`\`\`

## Decisões

- Eventos desacoplam o processamento da confirmação.
- O banco registra o estado de cada transação.
- Retentativas usam backoff exponencial.

## Próximos passos

Documentar os indicadores de operação e a estratégia de recuperação.
`;

async function openDoc(page: Page, content = sample) {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
  const create = page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Novo documento' });
  if (!(await create.isVisible())) await page.getByRole('button', { name: 'Mostrar/ocultar barra lateral (⌘\\)' }).click();
  await create.click();
  await page.getByRole('textbox', { name: /documento/i }).fill('Arquitetura de pagamentos');
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fechar barra lateral', exact: true })).toHaveCount(0);
  await page.locator('.cm-content').fill(content);
}

test.use({ reducedMotion: 'reduce' });
for (const config of [{ name: 'desktop-light', theme: 'light', width: 1680 }, { name: 'desktop-dark', theme: 'dark', width: 1440 }, { name: 'tablet', theme: 'light', width: 768 }, { name: 'mobile', theme: 'dark', width: 390 }, { name: 'small-mobile', theme: 'light', width: 320 }]) {
  test(`${config.name}: document reading and writing fit the available space`, async ({ page }, info) => {
    await page.setViewportSize({ width: config.width, height: 960 });
    await page.addInitScript((theme) => localStorage.setItem('strukt:theme', theme), config.theme);
    await openDoc(page);
    await expect(page.getByRole('button', { name: 'Editar tabela', exact: true })).toBeVisible();
    await page.locator('.sk-doc-editor .cm-scroller').evaluate((el) => { el.scrollTop = 0; });
    await page.screenshot({ path: info.outputPath('document-write.png'), animations: 'disabled' });
    const document = page.locator('.sk-document');
    expect(await document.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.locator('body').evaluate((el) => el.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'Exportar PDF', exact: true })).toBeVisible();

  });
}

test('rendered tables and code keep the original Markdown and can be edited in place', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openDoc(page);
  await expect(page.locator('.sk-doc-editor table')).toContainText('Fila de eventos');
  await expect(page.locator('.sk-doc-editor pre')).toContainText('idempotencyKey');
  await expect.poll(() => readFile(page, 'docs/arquitetura-de-pagamentos.md')).toBe(sample);
  await page.getByRole('button', { name: 'Editar tabela', exact: true }).click();
  await expect(page.locator('.sk-doc-editor table')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toContainText('| Componente |');
  await page.getByRole('button', { name: 'Copiar código', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('const payment');
});

test('a blank document accepts typing directly and offers useful starters', async ({ page }) => {
  await openDoc(page, '');
  await expect(page.getByRole('button', { name: 'Visão da arquitetura' })).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.type('Primeiro parágrafo.');
  await expect(page.getByRole('button', { name: 'Visão da arquitetura' })).toHaveCount(0);
  await expect.poll(() => readFile(page, 'docs/arquitetura-de-pagamentos.md')).toBe('Primeiro parágrafo.');
});

test('heading formatting preserves the selection and undo remains available', async ({ page }) => {
  await openDoc(page, 'Uma decisão');
  await page.getByRole('button', { name: 'Mostrar formatação', exact: true }).click();
  await page.getByRole('button', { name: 'Texto', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Título 2', exact: true }).click();
  await expect.poll(() => readFile(page, 'docs/arquitetura-de-pagamentos.md')).toBe('## Uma decisão');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => readFile(page, 'docs/arquitetura-de-pagamentos.md')).toBe('Uma decisão');
});

for (const theme of ['light', 'dark', 'contrast']) {
  test(`document controls and rendered content are accessible in ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('strukt:theme', value), theme);
    await openDoc(page);
    await expect(page.locator('.sk-doc-editor table')).toBeVisible();
    expect(await axeFindings(page)).toEqual([]);
      expect(await axeFindings(page)).toEqual([]);
  });
}

test('slash commands filter, insert a block and undo as one change', async ({ page }) => {
  await openDoc(page, '');
  await page.locator('.cm-content').click();
  await page.keyboard.type('/titulo');
  const options = page.locator('.sk-doc-slash-menu').getByRole('option');
  await expect(options).toHaveCount(3);
  await page.screenshot({ path: test.info().outputPath('slash-menu.png'), animations: 'disabled' });
  await options.filter({ hasText: 'Título 2' }).click();
  await expect.poll(() => readFile(page, 'docs/arquitetura-de-pagamentos.md')).toBe('## ');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => readFile(page, 'docs/arquitetura-de-pagamentos.md')).toBe('/titulo');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('/tabela');
  await expect(page.locator('.sk-doc-slash-menu').getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect.poll(() => readFile(page, 'docs/arquitetura-de-pagamentos.md')).toContain('| Coluna 1 | Coluna 2 |');
  await expect(page.locator('.sk-doc-slash-menu')).toHaveCount(0);
});

test('text selection shows contextual formatting while the full toolbar stays out of the page', async ({ page }) => {
  await openDoc(page, 'Uma decisão importante');
  await expect(page.getByRole('toolbar', { name: 'Formatação', exact: true })).toHaveCount(0);
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  const toolbar = page.getByRole('toolbar', { name: 'Formatação da seleção', exact: true });
  await expect(toolbar).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('selection-toolbar.png'), animations: 'disabled' });
  await toolbar.getByRole('button', { name: 'Negrito', exact: true }).click();
  await expect.poll(() => readFile(page, 'docs/arquitetura-de-pagamentos.md')).toBe('**Uma decisão importante**');
  await page.keyboard.press('Escape');
  await expect(toolbar).toHaveCount(0);
  await page.getByRole('button', { name: 'Mostrar formatação' }).click();
  await expect(page.getByRole('toolbar', { name: 'Formatação', exact: true })).toBeVisible();
});

for (const theme of ['light', 'dark']) {
  test(`the ${theme} keeps canvas and document panels distinct from the workspace backdrop`, async ({ page }, info) => {
    await page.addInitScript((value) => localStorage.setItem('strukt:theme', value), theme);
    await page.goto('/app/');
    await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
    await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
    const chat = page.getByRole('complementary', { name: 'Chat com a IA', exact: true });
    await expect(chat).toBeVisible();
    const paintedBackdrop = () => chat.evaluate((el) => {
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const color = getComputedStyle(parent).backgroundColor;
        if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
      }
      return null;
    });
    const backdrop = await page.locator('.sk-workspace-surface').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(await paintedBackdrop()).toBe(backdrop);
    expect(await page.locator('main').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(backdrop);
    await page.screenshot({ path: info.outputPath('diagram-chat-continuous.png'), animations: 'disabled' });
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Novo documento' }).click();
    await page.getByRole('textbox', { name: /documento/i }).fill('Documento contínuo');
    await page.keyboard.press('Enter');
    await expect(page.locator('.sk-document')).toBeVisible();
    const surface = await page.locator('.sk-document').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await page.locator('main').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(surface);
    expect(await paintedBackdrop()).toBe(backdrop);
    expect(surface).not.toBe(backdrop);
    await expect(chat.getByRole('button', { name: 'Resuma este documento', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('document-chat-continuous.png'), animations: 'disabled' });
  });
}


test('contextual formatting fits beside the chat in a narrow document', async ({ page }) => {
  await page.setViewportSize({ width: 668, height: 900 });
  await openDoc(page, 'Uma decisão importante');
  await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Chat com a IA', exact: true })).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  const toolbar = page.locator('.sk-doc-selection-toolbar');
  await expect(toolbar).toBeVisible();
  const main = (await page.locator('main').boundingBox())!;
  const bounds = (await toolbar.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(main.x);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(main.x + main.width);
});
