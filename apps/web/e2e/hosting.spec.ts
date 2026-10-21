import { expect, test } from '@playwright/test';

test('keeps the landing to editor flow in local development', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Abrir o app', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/$/);
  await expect(page.locator('.react-flow')).toBeVisible();
});

test('uses runtime app origin for landing calls to action and AI settings', async ({ page }) => {
  await page.route('**/', async route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('</head>', '<meta name="joinlet-app-url" content="https://app.joinlet.co/"><meta name="joinlet-site-url" content="https://joinlet.co/"></head>') });
  });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Abrir o app', exact: true })).toHaveAttribute('href', 'https://app.joinlet.co/?lang=pt-BR');
  await expect(page.getByRole('link', { name: 'Escolha sua conexão' })).toHaveAttribute('href', 'https://app.joinlet.co/?settings=ai&lang=pt-BR');
  await expect(page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Documentação' })).toHaveAttribute('href', 'https://joinlet.co/docs/pt-BR/introduction/');
});

test('links from the editor back to the public site on split hosting', async ({ page }) => {
  await page.route('**/app/', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('</head>', '<meta name="joinlet-app-url" content="https://app.joinlet.co/"><meta name="joinlet-site-url" content="https://joinlet.co/"></head>') });
  });
  await page.goto('/app/');
  await expect(page.locator('.react-flow')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Joinlet, início' })).toHaveAttribute('href', 'https://joinlet.co/');
});
