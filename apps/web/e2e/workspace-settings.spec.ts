import { expect, test } from '@playwright/test';
import { axeFindings } from './support/axe';
test.use({ storageState: { cookies: [], origins: [] } });
const logo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAE0lEQVR4nGNY/N/2Pz7MMDIUAACaSreBI9QyoQAAAABJRU5ErkJggg==', 'base64');

test('English is the default and an explicit Portuguese preference persists', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('combobox', { name: 'Language' })).toHaveValue('en');
  await page.getByRole('link', { name: 'Open app', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Workspace menu' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('pt-BR');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await page.goto('/app/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
});

test('identity persists, exports, and supports removing the logo', async ({ page }, info) => {
  await page.goto('/app/');
  async function open() {
    await page.getByRole('button', { name: 'Workspace menu' }).click();
    await page.getByRole('menuitem', { name: 'Workspace settings', exact: true }).click();
  }
  await open();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('textbox', { name: 'Workspace name' }).fill('Joinlet Platform');
  await dialog.getByRole('textbox', { name: 'Workspace description' }).fill('Architecture and decisions for our team.');
  await dialog.getByLabel('Logo file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: logo });
  await expect(dialog.getByRole('img', { name: 'Logo preview' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Workspace updated.');
  await dialog.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByRole('button', { name: 'Workspace menu' })).toContainText('Joinlet Platform');
  await expect(page.getByRole('img', { name: 'Workspace logo' })).toBeVisible();
  await open();
  const saved = await page.evaluate(async () => {
    const { workspace } = await import('/src/workspace/appWorkspace.ts');
    return JSON.parse(workspace.files()['strukt.json'] as string);
  });
  expect(saved).toMatchObject({ name: 'Joinlet Platform', description: 'Architecture and decisions for our team.' });
  expect(saved.logo).toMatch(/^data:image\/(webp|png);base64,/);
  await expect.poll(() => dialog.locator('form').evaluate(el => getComputedStyle(el.parentElement!).opacity)).toBe('1');
  await expect.poll(() => dialog.evaluate(el => { let opacity = 1; for (let node: Element | null = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity); return opacity; })).toBe(1);
  expect(await axeFindings(page)).toEqual([]);
  await page.screenshot({ path: info.outputPath('workspace-settings-en.png'), animations: 'disabled' });
  await page.reload(); await open();
  await expect(dialog.getByRole('textbox', { name: 'Workspace name' })).toHaveValue('Joinlet Platform');
  await expect(dialog.getByRole('textbox', { name: 'Workspace description' })).toHaveValue(saved.description);
  await expect(dialog.getByRole('img', { name: 'Logo preview' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove logo' }).click();
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Workspace updated.');
  await dialog.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByRole('img', { name: 'Workspace logo' })).toHaveCount(0);
});

test('invalid uploads, unsaved edits and read-only state', async ({ page }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await page.getByRole('menuitem', { name: 'Workspace settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  const original = await dialog.getByRole('textbox', { name: 'Workspace name' }).inputValue();
  await dialog.getByLabel('Logo file').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(dialog.getByRole('alert')).toHaveText('Choose a valid PNG, JPG or WebP image.');
  await dialog.getByLabel('Logo file').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a PNG') });
  await expect(dialog.getByRole('alert')).toHaveText('Could not open this image. Choose another file.');
  await dialog.getByRole('textbox', { name: 'Workspace name' }).fill('Unsaved');
  await dialog.getByRole('button', { name: 'Discard changes' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Workspace name' })).toHaveValue(original);
  await page.evaluate(async () => { const { diagramStore } = await import('/src/state/appStore.ts'); diagramStore.getState().setReadOnly('Read-only workspace'); });
  await expect(dialog.getByRole('textbox', { name: 'Workspace name' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeDisabled();
});

test('mobile workspace settings support Portuguese', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/?lang=pt-BR');
  await expect(page.locator('.react-flow')).toBeVisible();
  await page.evaluate(async () => { const { openSettings } = await import('/src/settings/store.ts'); openSettings('workspace'); });
  const dialog = page.getByRole('dialog', { name: 'Configurações', exact: true });
  await expect(dialog.getByRole('textbox', { name: 'Nome do workspace' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Salvar alterações' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await expect.poll(() => dialog.evaluate(el => { let opacity = 1; for (let node: Element | null = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity); return opacity; })).toBe(1);
  expect(await axeFindings(page)).toEqual([]);
  await page.screenshot({ path: info.outputPath('workspace-settings-mobile-pt.png'), animations: 'disabled' });
});

test('switching workspaces resets drafts and external changes are not overwritten', async ({ page }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await page.getByRole('menuitem', { name: 'Workspace settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('textbox', { name: 'Workspace description' }).fill('Draft for first workspace');
  await page.evaluate(async () => { const { createBrowserWorkspace } = await import('/src/workspace/projects.ts'); await createBrowserWorkspace('Second workspace'); });
  await expect(dialog.getByRole('textbox', { name: 'Workspace name' })).toHaveValue('Second workspace');
  await expect(dialog.getByRole('textbox', { name: 'Workspace description' })).toHaveValue('');
  await dialog.getByRole('textbox', { name: 'Workspace description' }).fill('My draft');
  await page.evaluate(async () => { const { workspace } = await import('/src/workspace/appWorkspace.ts'); workspace.setName('External rename'); await workspace.flush(); });
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Workspace details have changed. Reopen this section before saving.');
  const name = await page.evaluate(async () => (await import('/src/workspace/appWorkspace.ts')).workspace.store.getState().data!.manifest.name);
  expect(name).toBe('External rename');
});
