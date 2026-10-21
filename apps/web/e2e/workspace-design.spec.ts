import { expect, test } from '@playwright/test';

// Exercise real layout constraints as well as producing reviewable captures of the new UI.
for (const view of [
  { name: 'light-desktop', width: 1440, height: 900, theme: 'light', touch: false },
  { name: 'dark-desktop', width: 1440, height: 900, theme: 'dark', touch: false },
  { name: 'tablet', width: 768, height: 1024, theme: 'light', touch: false },
  { name: 'phone', width: 390, height: 844, theme: 'light', touch: true },
  { name: 'small-phone', width: 320, height: 740, theme: 'dark', touch: true },
]) {
  test.describe(view.name, () => {
    test.use({ viewport: { width: view.width, height: view.height }, hasTouch: view.touch, isMobile: view.touch, reducedMotion: 'reduce' });

    test('header actions remain reachable without overflowing', async ({ page }, info) => {
      await page.addInitScript((theme) => localStorage.setItem('strukt:theme', theme), view.theme);
      await page.goto('/app/');
      await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
      const header = page.getByRole('banner');
      const box = (await header.boundingBox())!;
      expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      for (const button of await header.getByRole('button').all()) {
        if (!await button.isVisible()) continue;
        const action = (await button.boundingBox())!;
        expect(action.x).toBeGreaterThanOrEqual(0);
        expect(action.x + action.width).toBeLessThanOrEqual(view.width);
        expect(action.y + action.height).toBeLessThanOrEqual(box.y + box.height);
      }
      const tools = (await page.getByRole('toolbar', { name: 'Ferramentas do diagrama' }).boundingBox())!;
      expect(tools.x).toBeGreaterThanOrEqual(0);
      expect(tools.x + tools.width).toBeLessThanOrEqual(view.width);
      await page.screenshot({ path: info.outputPath('workspace.png'), animations: 'disabled' });
      if (view.touch) {
        await page.keyboard.press('ControlOrMeta+j');
        const composer = page.getByRole('region', { name: 'Assistente de IA', exact: true });
        await expect(composer.getByRole('textbox', { name: 'Instrução para a IA' })).toBeVisible();
        expect(await composer.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
        await expect.poll(async () => {
          const card = (await composer.boundingBox())!;
          const zoom = (await page.getByRole('button', { name: 'Ajustar à tela' }).boundingBox())!;
          return card.y + card.height <= zoom.y;
        }).toBe(true);
        const card = (await composer.boundingBox())!;
        const zoom = (await page.getByRole('button', { name: 'Ajustar à tela' }).boundingBox())!;
        expect(card.x).toBeGreaterThanOrEqual(0);
        expect(card.x + card.width).toBeLessThanOrEqual(view.width);
        expect(card.y + card.height).toBeLessThanOrEqual(zoom.y);
        await page.screenshot({ path: info.outputPath('ai-composer.png'), animations: 'disabled' });
      }
    });
  });
}

test.describe('workspace flows', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  test('review shortcuts open the matching panel beside the canvas', async ({ page }, info) => {
    await page.goto('/app/');
    const review = page.getByRole('region', { name: 'Revisão do diagrama' });
    await review.getByRole('button', { name: 'Versões', exact: true }).click();
    const versions = page.getByRole('complementary', { name: 'Versões' });
    await expect(versions).toBeVisible();
    await expect(versions.getByRole('heading', { name: 'Versões', exact: true })).toBeVisible();
    // A width transition and then fitView settle independently of reduced transform motion.
    await expect.poll(async () => { const panel = (await versions.boundingBox())!; const canvas = (await page.locator('#canvas').boundingBox())!; return panel.x >= canvas.x + canvas.width; }).toBe(true);
    await expect.poll(async () => {
      const node = (await page.locator('.react-flow__node[data-id="PostgreSQL"]').boundingBox())!;
      const canvas = (await page.locator('.react-flow').boundingBox())!;
      return node.x + node.width <= canvas.x + canvas.width;
    }).toBe(true);
    const canvas = (await page.locator('.react-flow').boundingBox())!;
    const panel = (await versions.boundingBox())!;
    expect(canvas.x + canvas.width).toBeLessThanOrEqual(panel.x);
    await expect(review.getByRole('button', { name: 'Versões' })).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: info.outputPath('versions.png'), animations: 'disabled' });
    await review.getByRole('button', { name: 'Comentários', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Comentários', exact: true })).toBeVisible();
    await expect(versions).toHaveCount(0);
  });

  test('a new diagram offers models, manual editing and an actionable AI setup', async ({ page }, info) => {
    await page.goto('/app/');
    const sidebar = page.getByRole('navigation', { name: 'Workspace' });
    await sidebar.getByRole('button', { name: 'Novo diagrama' }).click();
    await page.getByRole('textbox', { name: 'Nome do diagrama' }).fill('Arquitetura do projeto');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Descreva sua arquitetura' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Adicionar nó', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Modelos' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Modelos' }).getByRole('img')).toHaveCount(4);
    await page.screenshot({ path: info.outputPath('empty-diagram.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Configurar IA', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Configurações' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'IA e providers' })).toBeVisible();
  });
});
