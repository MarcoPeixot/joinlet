import type { Page } from '@playwright/test';

/** Opens the "…" menu of a sidebar item (rename, move to a folder, delete) and picks `action`. */
export async function itemAction(page: Page, title: string, action: string) {
  const nav = page.getByRole('navigation', { name: 'Workspace' });
  await nav.getByRole('button', { name: title, exact: true }).hover();
  await nav.getByRole('button', { name: `Ações de ${title}`, exact: true }).click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}
