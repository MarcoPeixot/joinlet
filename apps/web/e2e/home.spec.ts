import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { panelsTrigger } from './panelMenu';
import { zoomIn } from './zoom';

// The first screen stays calm: few controls in the bar, one onboarding surface, and what left the bar is still
// reachable from a menu or ⌘K.

const kafka = (page: Page) => page.locator('.react-flow__node[data-id="Kafka"]');
const chip = (page: Page) => page.getByRole('status', { name: 'Primeiro acesso' });
const checklist = (page: Page) => page.getByRole('region', { name: 'Primeiros passos' });

async function paletteRun(page: Page, title: string) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type(title);
  await expect(page.getByRole('option', { name: new RegExp(title) }).first()).toBeVisible();
  await page.keyboard.press('Enter');
}

const overlap = async (a: Locator, b: Locator) => {
  const [x, y] = [(await a.boundingBox())!, (await b.boundingBox())!];
  return x.x < y.x + y.width && y.x < x.x + x.width && x.y < y.y + y.height && y.y < x.y + x.height;
};

test.describe('desktop first load', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/app/');
    await expect(kafka(page)).toBeVisible();
  });

  test('the top bar keeps at most ten action buttons and leaves identity to the sidebar', async ({ page }) => {
    const buttons = page.locator('header button:visible');
    expect(await buttons.count()).toBeLessThanOrEqual(10);
    for (const gone of ['Fluxos guiados', 'Explorar modelo', 'Precisão da arquitetura', 'Alternar tema']) {
      await expect(page.getByRole('button', { name: gone, exact: true })).toHaveCount(0);
    }
    // Nothing pending on a fresh workspace: no dot on Painéis, and the save state is a quiet dot.
    await expect(panelsTrigger(page)).toHaveAccessibleName('Painéis');
    await expect(page.getByRole('navigation', { name: 'Workspace' }).getByRole('status').first()).toHaveText('Salvo');
  });

  test('one onboarding surface: the first-run note, and no checklist beside it', async ({ page }) => {
    await expect(chip(page)).toBeVisible();
    await expect(checklist(page)).toHaveCount(0);
    await expect(chip(page).getByRole('button')).toHaveCount(3);
  });

  test('the sidebar owns its collapse button and its + buttons stay quiet until hovered', async ({ page }) => {
    const sidebar = page.getByRole('navigation', { name: 'Workspace' });
    await expect(sidebar.getByRole('button', { name: /barra lateral/ })).toHaveCount(1);
    await expect(page.getByRole('banner').getByRole('button', { name: /barra lateral/ })).toHaveCount(0);
    const plus = sidebar.getByRole('button', { name: 'Novo diagrama' });
    await page.mouse.move(800, 450);
    await expect(plus).toHaveCSS('opacity', '0');
    await sidebar.getByRole('button', { name: 'Overview' }).hover();
    await expect(plus).toHaveCSS('opacity', '1');
  });

  test('every panel is one menu away, grouped, and the trigger names the open one', async ({ page }) => {
    await panelsTrigger(page).click();
    const menu = page.getByRole('menu', { name: 'Painéis' });
    // Fluxos, Modelo, Perspectivas, Precisão, Comentários, Versões, Linha do tempo, GitHub.
    await expect(menu.getByRole('menuitemcheckbox')).toHaveCount(8);
    await menu.getByRole('menuitemcheckbox', { name: /^Versões/ }).click();
    await expect(page.getByRole('complementary', { name: 'Versões' })).toBeVisible();
    await expect(panelsTrigger(page)).toHaveAccessibleName('Painéis: Versões');
  });

  test('Exportar keeps its four formats behind the icon', async ({ page }) => {
    await page.getByRole('button', { name: 'Exportar' }).click();
    const menu = page.getByRole('menu', { name: 'Exportar' });
    for (const item of ['Exportar SVG', 'Exportar PNG', 'Copiar como Mermaid', 'Copiar como PlantUML']) await expect(menu.getByRole('menuitem', { name: new RegExp(item) })).toBeVisible();
  });

  test('the theme and the minimap left the chrome but answer from ⌘K', async ({ page }) => {
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    await paletteRun(page, 'Alternar tema claro/escuro');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(theme);

    await expect(page.getByRole('button', { name: 'Mostrar/ocultar minimapa' })).toHaveCount(0);
    await zoomIn(page, 5);
    await expect(page.locator('.react-flow__minimap')).toHaveCount(1);
    await paletteRun(page, 'Mostrar/ocultar minimapa');
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
  });

  test('Apresentar is an icon in the bar and still enters the presentation', async ({ page }) => {
    await page.getByRole('button', { name: 'Apresentar (P)' }).click();
    await expect(page.locator('header')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('header')).toHaveCount(1);
  });
});

test.describe('phone first load', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ page }) => {
    await page.goto('/app/');
    await expect(kafka(page)).toBeVisible();
  });

  test('the bar keeps seven controls and the Painéis menu carries Código and Apresentar', async ({ page }) => {
    expect(await page.locator('header button:visible').count()).toBeLessThanOrEqual(7);
    await panelsTrigger(page).click();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Código' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Apresentar/ })).toBeVisible();
  });

  test('the canvas has no bottom trigger and leaves the zoom controls uncovered and the first-run note fits one line', async ({ page }) => {
    const pill = page.getByRole('button', { name: 'Visualizar detalhes' });
    const fit = page.getByRole('button', { name: 'Ajustar à tela' });
    await expect(pill).toHaveCount(0);
    await expect(fit).toBeVisible();
    const box = (await chip(page).boundingBox())!;
    expect(box.height).toBeLessThan(60);
  });
});
