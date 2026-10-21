import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from './storage';

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Workspace' });

async function createDoc(page: Page, title: string) {
  await sidebar(page).getByRole('button', { name: 'Novo documento' }).click();
  await page.getByRole('textbox', { name: 'Nome do documento' }).fill(title);
  await page.keyboard.press('Enter');
  await page.getByLabel('Editor do documento').locator('.cm-content').click();
}

/** Use the clipboard event handled by CodeMirror, as real paste does, avoiding a giant native DOM mutation. */
async function paste(page: Page, size: number) {
  await page.evaluate((chars) => {
    const section = (i: number) => `## Seção ${i}\n\nTexto com **negrito**, *itálico* e [um link](https://example.com/${i}) para encher a prévia.\n\n- item um\n- item dois\n\n`;
    let text = '';
    for (let i = 0; text.length < chars; i++) text += section(i);
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  }, size);
}

/** Mean milliseconds per keystroke: each key is inserted, then the page gets a task to settle (React work included). */
function typeKeys(page: Page, count: number): Promise<number> {
  return page.evaluate(async (n) => {
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    await settle();
    const start = performance.now();
    for (let i = 0; i < n; i++) {
      document.execCommand('insertText', false, 'x');
      await settle();
    }
    return (performance.now() - start) / n;
  }, count);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
});

for (const [label, size, limit] of [['100 KB', 100_000, 40], ['1 MB', 1_000_000, 60]] as const) {
  test(`typing in a ${label} document in the live editor costs little per key`, async ({ page }) => {
    test.setTimeout(120_000);
    await createDoc(page, 'Grande');
    await paste(page, size);
    const perKey = await typeKeys(page, 12);
    console.log(`[doc-typing] Live ${label}: ${perKey.toFixed(1)} ms/tecla`);
    expect(perKey).toBeLessThan(limit);
  });
}

test('a 100 KB document remains responsive beside a second editor', async ({ page }) => {
  test.setTimeout(120_000);
  await createDoc(page, 'Dividido');
  await paste(page, 100_000);
  await page.getByRole('button', { name: 'Dividir documentos', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Criar documento ao lado', exact: true }).click();
  await expect(page.locator('.cm-content')).toHaveCount(2);
  const editor = page.getByRole('region', { name: 'Documento: Dividido', exact: true }).locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  const perKey = await typeKeys(page, 12);
  console.log(`[doc-typing] Two documents 100 KB: ${perKey.toFixed(1)} ms/tecla`);
  expect(perKey).toBeLessThan(60);
  await page.keyboard.type('\n\n## Fim do documento');
  await expect(editor.locator('.cm-h2').last()).toHaveText('## Fim do documento');
  await expect.poll(() => readFile(page, 'docs/sem-titulo.md')).toBe('');
});

test('the live document updates its heading while typing', async ({ page }) => {
  await createDoc(page, 'Pequeno');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('# Olá');
  await expect(page.locator('.cm-h1').last()).toHaveText('# Olá');
  await page.keyboard.type(' mundo');
  await expect(page.locator('.cm-h1').last()).toHaveText('# Olá mundo', { timeout: 500 });
});
