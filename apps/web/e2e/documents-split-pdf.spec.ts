import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from './storage';
import { axeFindings } from './support/axe';

const side = (page: Page) => page.getByRole('navigation', { name: 'Workspace' });
async function create(page: Page, title: string, text = '') {
  await side(page).getByRole('button', { name: 'Novo documento' }).click();
  await page.getByRole('textbox', { name: 'Nome do documento', exact: true }).fill(title);
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-content')).toHaveCount(1);
  await page.locator('.cm-content').fill(text);
}
async function openSplit(page: Page, title: string) {
  await page.getByRole('button', { name: 'Dividir documentos', exact: true }).click();
  await page.getByRole('menuitem', { name: title, exact: true }).click();
  await expect(page.locator('.cm-content')).toHaveCount(2);
}
test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
});

test('two documents edit, save and undo independently; focus follows the chat target', async ({ page }, info) => {
  await page.addStyleTag({ content: '* { animation-duration: 0s !important; transition-duration: 0s !important; }' });
  await create(page, 'Segundo', 'Segundo original');
  await create(page, 'Terceiro', 'Terceiro original');
  await create(page, 'Primeiro', 'Primeiro original');
  // Begin an undo history before opening the split: the first editor must survive.
  const first = page.getByRole('region', { name: 'Documento: Primeiro', exact: true });
  await first.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' editado');
  await openSplit(page, 'Segundo');
  const second = page.getByRole('region', { name: 'Documento: Segundo', exact: true });
  await expect(second).toHaveAttribute('data-active', 'true');
  await second.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' também');
  await expect.poll(() => readFile(page, 'docs/segundo.md')).toBe('Segundo original também');
  await first.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => readFile(page, 'docs/primeiro.md')).toBe('Primeiro original');
  await expect(second.locator('.cm-content')).toContainText('também');
  await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
  const chat = page.getByRole('complementary', { name: 'Chat com a IA', exact: true });
  await expect(chat).toContainText('Lendo: Primeiro');
  await second.locator('.cm-content').click();
  await expect(chat).toContainText('Lendo: Segundo');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => readFile(page, 'docs/segundo.md')).toBe('Segundo original');
  await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
  const separator = page.getByRole('separator', { name: 'Redimensionar documentos' });
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '55');
  await first.getByRole('button', { name: 'Trocar documento: Primeiro', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Terceiro', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Documento: Terceiro', exact: true })).toBeVisible();
  await expect(second).toBeVisible();
  expect(await axeFindings(page)).toEqual([]);
  await page.screenshot({ path: info.outputPath('two-documents.png'), animations: 'disabled' });
  await second.getByRole('button', { name: 'Fechar divisão', exact: true }).click();
  await expect(page.locator('.cm-content')).toHaveCount(1);
  await expect(second).toBeVisible();
  await second.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => readFile(page, 'docs/segundo.md')).toBe('Segundo original também');
});

test('sidebar navigation replaces the focused slot, and deleting the other document collapses the split', async ({ page }) => {
  await create(page, 'Um', 'Texto um');
  await create(page, 'Dois', 'Texto dois');
  await create(page, 'Tres', 'Texto tres');
  await side(page).getByRole('button', { name: 'Um', exact: true }).click();
  await openSplit(page, 'Dois');
  await side(page).getByRole('button', { name: 'Tres', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Documento: Um', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Documento: Tres', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Documento: Dois', exact: true })).toHaveCount(0);
  await side(page).getByRole('button', { name: 'Um', exact: true }).hover();
  await side(page).getByRole('button', { name: 'Excluir Um', exact: true }).click();
  await expect(page.locator('.cm-content')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Documento: Tres', exact: true })).toBeVisible();
});

test('split stacks two editable documents on mobile without horizontal page overflow', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 960 });
  await create(page, 'Um');
  // Creation inside the split works even when there is no second document yet.
  await page.getByRole('button', { name: 'Dividir documentos', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Criar documento ao lado', exact: true }).click();
  await expect(page.locator('.cm-content')).toHaveCount(2);
  const panels = page.locator('.sk-doc-pane');
  const a = (await panels.nth(0).boundingBox())!;
  const b = (await panels.nth(1).boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
  expect(await page.locator('body').evaluate((el) => el.scrollWidth <= innerWidth)).toBe(true);
  await panels.last().locator('.cm-content').fill('Texto do segundo documento');
  await expect.poll(() => readFile(page, 'docs/sem-titulo.md')).toBe('Texto do segundo documento');
  await page.screenshot({ path: info.outputPath('mobile-two-documents.png'), animations: 'disabled' });
});

test('exports the latest document as a downloadable paginated PDF without editor chrome', async ({ page }, info) => {
  test.setTimeout(90_000);
  const content = '# Arquitetura de pagamentos\n\nDecisões técnicas, integração e observabilidade.\n\n' + Array.from({ length: 12 }, (_, index) => `## ${index + 1}. Componentes e responsabilidades\n\nO **serviço de pagamentos** autentica a transação e publica eventos. A integração mantém idempotência, rastreabilidade e recuperação de falhas.\n\n| Componente | Responsabilidade |\n| --- | --- |\n| API Gateway | Autenticação e autorização |\n| Pagamentos | Processamento e confirmação |\n| Fila | Entrega assíncrona e retentativas |\n\n> Decisão: manter a consistência das transações.\n\n- Monitorar a latência.\n- Registrar falhas e tentativas.\n\n\`\`\`typescript\nconst payment = await client.create({ currency: "BRL" });\n\`\`\`\n\n`).join('') + 'MARCADOR FINAL: conteúdo atualizado antes de salvar.\n';
  await create(page, 'Pagamentos PDF', content);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar PDF', exact: true }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe('pagamentos-pdf.pdf');
  await file.saveAs(info.outputPath('pagamentos-pdf.pdf'));
  expect(await file.failure()).toBeNull();
  await expect(page.getByRole('button', { name: 'Exportar PDF', exact: true })).toBeEnabled();
  // Exporting is non-destructive and leaves the editor available.
  await expect.poll(() => readFile(page, 'docs/pagamentos-pdf.md')).toBe(content);
  await expect(page.locator('.cm-content')).toBeVisible();
});
