import { expect, test } from '@playwright/test';
import { togglePanel } from './panelMenu';

// The dev server serves every lazy chunk as its own module URL, so aborting that URL simulates a failed chunk load.
test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
});

test('a lazy panel that fails to load keeps the app alive and can be retried', async ({ page }) => {
  const chunk = '**/src/panels/FlowsPanel.tsx*';
  await page.route(chunk, (route) => route.abort());
  await togglePanel(page, 'Fluxos');
  await expect(page.getByText('Não foi possível carregar este painel. Verifique a conexão e tente de novo.')).toBeVisible();
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Fluxos guiados' })).toHaveCount(0);

  // Chromium keeps a failed module fetch for the life of the page, so the retry may fail again: the toast then offers a reload.
  await page.unroute(chunk);
  await page.getByRole('button', { name: 'Tentar de novo' }).click();
  const panel = page.getByRole('complementary', { name: 'Fluxos guiados' });
  const reload = page.getByRole('button', { name: 'Recarregar a página' });
  await expect(panel.or(reload)).toBeVisible();
  if (await reload.isVisible()) {
    await reload.click();
    await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
    await togglePanel(page, 'Fluxos');
  }
  await expect(panel).toBeVisible();
});

test('importing a file while the importers chunk is unavailable toasts instead of failing silently', async ({ page }) => {
  await page.getByRole('button', { name: 'Mostrar/ocultar código' }).click();
  await page.route('**/packages/dsl/src/import.ts*', (route) => route.abort());
  await page.locator('input[type="file"][accept*=".mmd"]').setInputFiles({
    name: 'checkout.mmd',
    mimeType: 'text/plain',
    buffer: Buffer.from('flowchart LR\nWeb[Frontend] -->|HTTPS| API[Backend]\n'),
  });
  await expect(page.getByText('Não foi possível carregar o conversor.')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
});
