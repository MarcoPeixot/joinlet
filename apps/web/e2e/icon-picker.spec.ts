import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { savedDiagram } from './storage';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const savedIcon = async (page: Page, id: string) => (await savedDiagram(page))?.model.elements[id]?.icon;

test.beforeEach(async ({ page }) => {
  // Brand icons are lightened for legibility on the dark default; this spec asserts the brand fill itself.
  await page.addInitScript(() => localStorage.setItem('strukt:theme', 'light'));
  await page.goto('/app/');
  await expect(node(page, 'Kafka')).toBeVisible();
});

test('icon picker: search "postgres" + Enter applies it as one undo step; the AWS category lists its icons', async ({ page }) => {
  await node(page, 'Pagamentos').click();
  // Propriedades opens on "Visão" (the passport); the fields live under "Editar".
  await page.getByRole('tab', { name: 'Editar' }).click();
  await page.getByRole('button', { name: 'Ícone: server' }).click();
  const picker = page.getByRole('dialog', { name: 'Escolher ícone' });
  await expect(picker.getByRole('combobox', { name: 'Buscar ícones' })).toBeFocused();
  await expect(picker.getByRole('option', { name: 'Server (server)' }).first()).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.type('postgres');
  await expect(picker.getByRole('option').first()).toHaveAccessibleName('PostgreSQL (postgresql)');
  await expect(picker.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ícone: postgresql' })).toBeFocused();
  await expect(node(page, 'Pagamentos').locator('svg[fill="#4169E1"]')).toBeVisible();
  await expect.poll(() => savedIcon(page, 'Pagamentos')).toBe('postgresql');

  await page.getByRole('button', { name: 'Desfazer (⌘Z)' }).click();
  await expect.poll(() => savedIcon(page, 'Pagamentos')).toBe('server');

  // Keyboard: Enter on the field opens the picker (it never renames the node); the sidebar filters by category.
  await page.getByRole('button', { name: 'Ícone: server' }).focus();
  await page.keyboard.press('Enter');
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: /^AWS,/ }).click();
  const aws = picker.getByRole('listbox', { name: 'AWS' });
  await expect(aws.getByRole('option').first()).toHaveAccessibleName('AWS (aws)');
  await expect(aws.getByRole('option', { name: 'API Gateway (aws-api-gateway)' })).toBeVisible();
  // Thousands of icons, but only the rows in view are rendered.
  await expect.poll(() => picker.getByRole('option').count()).toBeLessThan(65);
  await page.keyboard.type('lambda');
  await expect(picker.getByRole('listbox', { name: 'AWS' }).getByRole('option', { name: 'Lambda (aws-lambda)', exact: true })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ícone: server' })).toBeFocused();
});
