import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';

// Text is read, not typed: no text cursor over a node title, a label or a button's text; only fields show it.

const cursor = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).cursor);

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
});

test('the canvas keeps the arrow over its empty space, nodes and titles (no text cursor, no hand flicker)', async ({ page }) => {
  const title = page.locator('.react-flow__node .strukt-label').first();
  await expect(title).toBeVisible();
  expect(await cursor(title)).toBe('default');
  expect(await cursor(page.locator('.react-flow__node').first())).toBe('default');
  expect(await cursor(page.locator('.react-flow__pane').first())).toBe('default');
});

test('button text points, plain chrome text is the arrow, fields show the text cursor', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Workspace' });
  const item = nav.getByRole('button', { name: 'Exemplo', exact: true });
  expect(await cursor(item.locator('span').first())).toBe('pointer');
  // The whole row points, its padding included: no arrow at the edges flickering with the hand in the middle.
  expect(await cursor(item.locator('xpath=..'))).toBe('pointer');
  expect(await cursor(page.locator('body'))).toBe('default');

  await item.hover();
  await nav.getByRole('button', { name: 'Ações de Exemplo', exact: true }).click();
  expect(await cursor(page.getByRole('menuitem', { name: 'Renomear', exact: true }))).toBe('pointer');
  await page.getByRole('menuitem', { name: 'Renomear', exact: true }).click();
  expect(await cursor(nav.getByRole('textbox'))).toBe('text');
});
