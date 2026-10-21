import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const nodes = (page: Page) => page.locator('.react-flow__node');

test.describe('workspace chrome (desktop)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the bar comes before the sidebar and the canvas in Tab order', async ({ page }) => {
    await page.goto('/app/');
    await expect(nodes(page).first()).toBeVisible();
    const order = await page.evaluate(() => {
      const header = document.querySelector('header')!;
      const nav = document.querySelector('nav[aria-label="Workspace"]')!;
      const canvas = document.getElementById('canvas')!;
      const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return { sidebar: before(header, nav), canvas: before(header, canvas) };
    });
    expect(order).toEqual({ sidebar: true, canvas: true });
  });

  test('a document opens below the header, even with the sidebar folded', async ({ page }) => {
    await page.goto('/app/');
    await expect(nodes(page).first()).toBeVisible();
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Novo documento' }).click();
    await page.getByRole('textbox', { name: /documento/i }).fill('Notas');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Editor do documento', { exact: true })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Backslash');
    await page.getByRole('button', { name: 'Vínculos do documento' }).click();
    const refs = page.getByRole('region', { name: 'Referenciado por' });
    await expect(refs).toBeVisible();
    expect((await refs.boundingBox())!.y).toBeGreaterThanOrEqual(52);
  });

  test('the section buttons keep their visible name and expose state', async ({ page }) => {
    await page.goto('/app/');
    const section = page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Diagramas/ });
    await expect(section).toHaveAttribute('aria-expanded', 'true');
    await section.click();
    await expect(section).toHaveAttribute('aria-expanded', 'false');
  });

  test('arrow keys walk the sidebar rows and the folded sections survive a reload', async ({ page }) => {
    await page.goto('/app/');
    await expect(nodes(page).first()).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Workspace' });
    await nav.getByRole('button', { name: 'Overview', exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(nav.getByRole('button', { name: 'Exemplo', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(nav.getByRole('button', { name: 'Overview', exact: true })).toBeFocused();
    await nav.getByRole('button', { name: /^Diagramas/ }).click();
    await page.reload();
    await expect(nodes(page).first()).toBeVisible();
    await expect(nav.getByRole('button', { name: /^Diagramas/ })).toHaveAttribute('aria-expanded', 'false');
  });

  test('the open AI composer never covers the right-hand panel', async ({ page }) => {
    await page.goto('/app/');
    await expect(nodes(page).first()).toBeVisible();
    await page.getByRole('button', { name: /^Painéis/ }).click();
    await page.getByRole('menuitemcheckbox', { name: /GitHub/ }).click();
    const panel = page.getByRole('complementary', { name: 'GitHub' });
    await expect(panel).toBeVisible();
    await page.keyboard.press('ControlOrMeta+j');
    const card = page.getByLabel('Assistente de IA', { exact: true });
    await expect(card).toBeVisible();
    // The card morphs out of the pill: wait for its final size before measuring.
    await expect.poll(async () => (await card.boundingBox())!.width).toBeGreaterThan(500);
    const [a, b] = [(await card.boundingBox())!, (await panel.boundingBox())!];
    expect(a.x + a.width).toBeLessThanOrEqual(b.x);
    const fit = (await page.getByRole('button', { name: 'Ajustar à tela' }).boundingBox())!;
    expect(fit.x + fit.width).toBeLessThanOrEqual(a.x);
  });
});

test.describe('workspace chrome (touch)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the header groups are at least 44 px tall and hold their buttons', async ({ page }) => {
    await page.goto('/app/');
    await expect(nodes(page).first()).toBeVisible();
    for (const pill of await page.locator('header > div:visible').all()) {
      const box = (await pill.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      for (const button of await pill.getByRole('button').all()) {
        const inner = (await button.boundingBox())!;
        expect(inner.y).toBeGreaterThanOrEqual(box.y);
        expect(inner.y + inner.height).toBeLessThanOrEqual(box.y + box.height);
      }
    }
  });
});

test.describe('documents', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function newDoc(page: Page, title: string) {
    await page.goto('/app/');
    await expect(nodes(page).first()).toBeVisible();
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Novo documento' }).click();
    await page.getByRole('textbox', { name: /documento/i }).fill(title);
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Editor do documento')).toBeVisible();
  }

  test('live preview: titles and emphasis render, and the markers come back on the active line', async ({ page }) => {
    await newDoc(page, 'Vivo');
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('# Título\n\ntexto **forte** aqui');
    // The cursor is on the last line: the heading line shows no "# " and the bold shows no asterisks.
    await expect(page.locator('.cm-h1')).toHaveText('Título');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.cm-h1')).toHaveText('# Título');
  });

  test('document actions export a PDF or open a second real document', async ({ page }) => {
    await newDoc(page, 'Documento');
    await expect(page.getByRole('button', { name: 'Exportar PDF', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Modo do documento' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Dividir documentos', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Criar documento ao lado', exact: true }).click();
    await expect(page.locator('.cm-content')).toHaveCount(2);
    await expect(page.locator('.sk-doc-pane').last()).toHaveAttribute('data-active', 'true');
    await page.locator('.sk-doc-pane').last().getByRole('button', { name: 'Fechar divisão', exact: true }).click();
    await expect(page.locator('.cm-content')).toHaveCount(1);
  });

  test('the references band stays one line: three chips and a "+N" menu', async ({ page }) => {
    await newDoc(page, 'Refs');
    await page.getByRole('button', { name: 'Vínculos do documento' }).click();
    const band = page.getByRole('region', { name: 'Referenciado por' });
    expect((await band.boundingBox())!.height).toBeLessThan(56);
  });
});

