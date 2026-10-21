import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Workspace' });

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(node(page, 'Kafka')).toBeVisible();
});

test('the first Tab reaches "Pular para o canvas" and Enter moves focus to the canvas', async ({ page }) => {
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Pular para o canvas' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#canvas')).toBeFocused();
});

test('canvas nodes have accessible names with their connection count', async ({ page }) => {
  await expect(node(page, 'Kafka')).toHaveAttribute('aria-label', /Kafka.*\d+ conex/);
  await node(page, 'Kafka').focus();
  await expect(node(page, 'Kafka')).toBeFocused();
});

test('deleting a diagram offers "Desfazer" and undoing restores title and nodes', async ({ page }) => {
  await sidebar(page).getByRole('button', { name: 'Novo diagrama' }).click();
  await page.getByRole('textbox', { name: 'Nome do diagrama' }).fill('Pagamentos');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Adicionar nó (N)' }).click();
  await page.keyboard.type('Stripe');
  await page.keyboard.press('Enter');
  await expect(node(page, 'Stripe')).toBeVisible();
  const item = sidebar(page).getByRole('button', { name: 'Pagamentos', exact: true });
  await page.waitForTimeout(800);
  await item.hover();
  await sidebar(page).getByRole('button', { name: 'Excluir Pagamentos' }).click();
  await expect(item).toHaveCount(0);
  const undo = page.getByRole('button', { name: 'Desfazer', exact: true });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(item).toBeVisible();
  await expect(node(page, 'Stripe')).toBeVisible();
});

test('keyboard only: deleting via the item buttons focuses "Desfazer"; Enter restores and focus returns to the list', async ({ page }) => {
  await sidebar(page).getByRole('button', { name: 'Novo diagrama' }).click();
  await page.getByRole('textbox', { name: 'Nome do diagrama' }).fill('Pagamentos');
  await page.keyboard.press('Enter');
  await expect(node(page, 'Kafka')).toHaveCount(0);
  const item = sidebar(page).getByRole('button', { name: 'Pagamentos', exact: true });
  await page.waitForTimeout(800);
  await item.focus();
  await page.keyboard.press('Tab'); // Renomear
  await page.keyboard.press('Tab'); // Mover para uma pasta
  await page.keyboard.press('Tab'); // Excluir
  await expect(sidebar(page).getByRole('button', { name: 'Excluir Pagamentos' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(item).toHaveCount(0);
  const undo = page.getByRole('button', { name: 'Desfazer', exact: true });
  await expect(undo).toBeFocused();
  // Focus on the toast keeps it open (WCAG 2.2.1): still there after longer than its 8 s window would allow.
  await page.waitForTimeout(9000);
  await expect(undo).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(item).toBeVisible();
  await expect(undo).toHaveCount(0);
  await expect(sidebar(page).locator(':focus')).toHaveCount(1);
});

test('the command palette exposes combobox, listbox and option roles', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+k');
  const combo = page.getByRole('combobox', { name: 'Buscar comandos' });
  await expect(combo).toBeFocused();
  await expect(combo).toHaveAttribute('aria-expanded', 'true');
  const list = page.getByRole('listbox', { name: 'Comandos' });
  await expect(list).toBeVisible();
  expect(await list.getByRole('option').count()).toBeGreaterThan(0);
  const first = await combo.getAttribute('aria-activedescendant');
  expect(first).toBeTruthy();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => combo.getAttribute('aria-activedescendant')).not.toBe(first);
  await combo.fill('zzzzzz');
  await expect(page.getByRole('status').filter({ hasText: 'Nenhum comando' })).toBeVisible();
  await expect(combo).toHaveAttribute('aria-expanded', 'false');
});
