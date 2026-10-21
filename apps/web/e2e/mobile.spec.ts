import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(node(page, 'Kafka')).toBeVisible();
});

test('settings stack: tablist above full-width content', async ({ page }) => {
  await page.getByRole('button', { name: /configurações/i }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Configurações' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tablist')).toBeVisible();
  const content = page.getByTestId('settings-content');
  expect((await content.boundingBox())!.width).toBeGreaterThan(300);
  const tabs = dialog.getByRole('tablist');
  expect((await tabs.boundingBox())!.width).toBeGreaterThan(300);
  await dialog.getByRole('tab', { name: 'Atalhos' }).click();
  await expect(dialog.getByRole('tab', { name: 'Atalhos' })).toHaveAttribute('aria-selected', 'true');
});

test('the inspector is a bottom sheet that leaves the canvas visible and interactive', async ({ page }) => {
  await node(page, 'Kafka').click();
  const panel = page.getByRole('complementary', { name: 'Propriedades' });
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(844 * 0.53);
  expect(box.y + box.height).toBeGreaterThan(844 - 80);
  // The canvas pans the node above the sheet (animated).
  await expect.poll(async () => {
    const nodeBox = (await node(page, 'Kafka').boundingBox())!;
    return nodeBox.y + nodeBox.height;
  }).toBeLessThan(box.y);
  // The canvas still takes clicks: selecting another node swaps the selection.
  await node(page, 'Kafka').click();
  await expect(panel).toBeVisible();
});

test('the top bar has a Painéis menu and does not overflow', async ({ page }) => {
  const header = page.locator('header').first();
  expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Fluxos guiados', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Painéis' }).click();
  await page.getByRole('menuitemcheckbox', { name: /Fluxos/ }).click();
  await expect(page.getByRole('complementary', { name: 'Fluxos guiados' })).toBeVisible();
});

test('no horizontal scroll and the minimap starts hidden', async ({ page }) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Aumentar zoom' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Ajustar à tela' })).toBeVisible();
});

test('the sidebar closes after picking an item and rows keep a menu without hover', async ({ page }) => {
  await page.getByRole('button', { name: 'Mostrar/ocultar barra lateral (⌘\\)' }).click();
  const sidebar = page.getByRole('navigation', { name: 'Workspace' });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole('button', { name: /^Ações de/ }).first()).toBeVisible();
  await sidebar.getByRole('button', { name: 'Overview' }).click();
  await expect(sidebar).toHaveCount(0);
});
