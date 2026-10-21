import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('local use without an API exceeds Cloud quotas and identifies itself as self-hosted', async ({ page }) => {
  await page.route('**/api/plan', route => route.abort());
  await page.goto('/app/?lang=en');
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  expect(await page.evaluate(async () => {
    const { workspace } = await import('/src/workspace/appWorkspace.ts');
    while (workspace.store.getState().data!.manifest.diagrams.length < 25) {
      await workspace.create('diagram', `Local ${workspace.store.getState().data!.manifest.diagrams.length}`);
    }
    await workspace.flush();
    return workspace.store.getState().data!.manifest.diagrams.length;
  })).toBe(25);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  expect(await page.evaluate(async () => {
    const { workspace } = await import('/src/workspace/appWorkspace.ts');
    return workspace.store.getState().data!.manifest.diagrams.length;
  })).toBe(25);
  expect(await page.evaluate(async () => {
    const { createBrowserWorkspace } = await import('/src/workspace/projects.ts');
    const { loadCatalog } = await import('/src/workspace/catalog.ts');
    await createBrowserWorkspace('Second local project');
    await createBrowserWorkspace('Third local project');
    return (await loadCatalog())!.entries.length;
  })).toBe(3);
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await page.getByRole('menuitem', { name: 'Workspace settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('button', { name: 'Plan and usage', exact: true }).click();
  await expect(settings.getByText('Self-hosted', { exact: true })).toBeVisible();
  await expect(settings.getByText(/No commercial workspace/)).toBeVisible();
  await expect(settings.getByRole('progressbar')).toHaveCount(0);
  await expect(settings.getByRole('link', { name: 'Source code and AGPL-3.0 license' })).toHaveAttribute('href', 'https://github.com/MarcoPeixot/joinlet');
  await page.screenshot({ path: '/tmp/joinlet-self-hosted-policy.png', animations: 'disabled' });
});
