import { expect, test } from '@playwright/test';

// A sidebar item's actions live in one "…" menu (rename, move to a folder, delete), and every menu has one
// highlight that glides between its items (ui/Glide.tsx) instead of each item lighting up on its own.

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
});

const nav = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Workspace' });

test('an item shows one "…" menu on hover instead of three loose buttons', async ({ page }) => {
  const item = nav(page).getByRole('button', { name: 'Exemplo', exact: true });
  await item.hover();
  const more = nav(page).getByRole('button', { name: 'Ações de Exemplo', exact: true });
  await expect(more).toBeVisible();
  await expect(nav(page).getByRole('button', { name: 'Renomear Exemplo' })).toHaveCount(0);
  await expect(nav(page).getByRole('button', { name: 'Excluir Exemplo' })).toHaveCount(0);

  await more.click();
  const menu = page.getByRole('menu', { name: 'Ações de Exemplo' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Renomear', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Sem pasta', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Excluir', exact: true })).toBeVisible();
  // While the menu is open the "…" stays visible, even with the pointer on the menu.
  await expect(more).toBeVisible();
});

test('the "…" sits at the right end of the row and its menu grows past the sidebar', async ({ page }) => {
  const item = nav(page).getByRole('button', { name: 'Exemplo', exact: true });
  await item.hover();
  const more = nav(page).getByRole('button', { name: 'Ações de Exemplo', exact: true });
  const row = (await item.locator('xpath=..').boundingBox())!;
  const button = (await more.boundingBox())!;
  // Flush with the row's right edge, a square as tall as the row, rounded like it.
  expect(Math.abs(row.x + row.width - (button.x + button.width))).toBeLessThanOrEqual(1);
  expect(Math.round(button.width)).toBe(Math.round(button.height));
  expect(Math.round(button.height)).toBe(Math.round(row.height));
  const radius = (el: Element) => getComputedStyle(el).borderTopRightRadius;
  expect(await more.evaluate(radius)).toBe(await item.locator('xpath=..').evaluate(radius));

  await more.click();
  const menu = (await page.getByRole('menu', { name: 'Ações de Exemplo' }).boundingBox())!;
  const sidebar = (await nav(page).boundingBox())!;
  // Opens from the button's left edge, below it, and is not clipped to the sidebar.
  expect(Math.abs(menu.x - button.x)).toBeLessThanOrEqual(2);
  expect(menu.y).toBeGreaterThan(button.y + button.height);
  expect(menu.x + menu.width).toBeGreaterThan(sidebar.x + sidebar.width);
});

test('one highlight glides between the menu items, tinted on Excluir', async ({ page }) => {
  await nav(page).getByRole('button', { name: 'Exemplo', exact: true }).hover();
  await nav(page).getByRole('button', { name: 'Ações de Exemplo', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Ações de Exemplo' });
  const glide = menu.locator('.sk-glide');
  await expect(glide).toHaveCount(1);

  await menu.getByRole('menuitem', { name: 'Renomear', exact: true }).hover();
  await expect(glide).toHaveAttribute('data-visible', '');
  const onRename = await glide.evaluate((el) => (el as HTMLElement).style.transform);

  await menu.getByRole('menuitem', { name: 'Excluir', exact: true }).hover();
  await expect.poll(() => glide.evaluate((el) => (el as HTMLElement).style.transform)).not.toBe(onRename);
  await expect(glide).toHaveAttribute('data-tone', 'danger');

  // Items carry no fill of their own: the glide is the only highlight.
  const fill = await menu.getByRole('menuitem', { name: 'Excluir', exact: true }).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(fill).toBe('rgba(0, 0, 0, 0)');
});

test('Renomear from the menu edits the title in place', async ({ page }) => {
  await nav(page).getByRole('button', { name: 'Exemplo', exact: true }).hover();
  await nav(page).getByRole('button', { name: 'Ações de Exemplo', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Renomear', exact: true }).click();
  const input = nav(page).getByRole('textbox');
  await expect(input).toBeFocused();
  await input.fill('Exemplo renomeado');
  await input.press('Enter');
  await expect(nav(page).getByRole('button', { name: 'Exemplo renomeado', exact: true })).toBeVisible();
});
