import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] }, colorScheme: 'light' });

test('a new visitor gets dark and English across the public site and editor', async ({ page }) => {
  for (const path of ['/', '/app/', '/docs/', '/setup/']) {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    if (path === '/') await expect(page.getByRole('heading', { level: 1 })).toContainText('clear diagrams.');
    if (path === '/app/') await expect(page.locator('.react-flow')).toBeVisible();
  }
});

test('explicit light and Portuguese preferences survive navigation and reload', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('strukt:theme', 'light');
    localStorage.setItem('joinlet:locale', 'pt-BR');
  });
  for (const path of ['/', '/app/', '/docs/pt-BR/installation/', '/setup/?lang=pt-BR']) {
    await page.goto(path);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  }
});

test('an explicit system theme still follows the light OS', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('strukt:theme', 'system'));
  for (const path of ['/', '/app/', '/docs/', '/setup/']) {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  }
});
