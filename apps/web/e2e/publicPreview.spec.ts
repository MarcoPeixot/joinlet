import { expect, test, type BrowserContext } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

async function preview(context: BrowserContext, requests: string[] = []) {
  await context.route('**/app/**', async route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><meta name="strukt-mode" content="browser-preview">') });
  });
  await context.route('**/api/**', route => {
    requests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Online services are not available in this preview."}' });
  });
}

test('public preview opens without accounts, preserves a draft and gates a second workspace', async ({ page, context }) => {
  const requests: string[] = [];
  await preview(context, requests);
  await page.goto('/app/?lang=en');
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await import('/src/workspace/catalog.ts')).catalogStore.getState().catalog?.entries.length)).toBe(1);
  await page.evaluate(async () => {
    const { workspace } = await import('/src/workspace/appWorkspace.ts');
    workspace.setName('Public draft');
    await workspace.create('doc', 'Saved decision', '# Keep this decision');
    await workspace.flush();
  });
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  expect(await page.evaluate(async () => (await import('/src/workspace/appWorkspace.ts')).workspace.store.getState().data?.manifest.name)).toBe('Public draft');
  await expect.poll(() => page.evaluate(async () => (await import('/src/workspace/catalog.ts')).catalogStore.getState().catalog?.entries.length)).toBe(1);
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await page.getByRole('menuitem', { name: 'New workspace', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'One workspace for now' });
  await expect(dialog.getByText(/Sign-in, registration and new workspaces are paused/)).toBeVisible();
  await expect(dialog.getByText(/saved in this browser/)).toBeVisible();
  await expect(dialog.locator('a, input[type=password]')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Continue in my workspace' }).click();
  expect(await page.evaluate(async () => {
    try { await (await import('/src/workspace/projects.ts')).createBrowserWorkspace('Second'); return 'created'; }
    catch (error) { return (error as { code: string }).code; }
  })).toBe('WORKSPACE_LIMIT_REACHED');
  expect(requests).not.toContain('/api/remote/session');
  expect(requests).not.toContain('/api/plan');
  expect(requests.filter(path=>/^\/api\/(auth|remote)\//.test(path))).toEqual([]);
});

test('another visitor gets an isolated first workspace', async ({ page, context, browser, baseURL }) => {
  await preview(context);
  await page.goto('/app/?lang=en');
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  await page.evaluate(async () => {
    const { workspace } = await import('/src/workspace/appWorkspace.ts');
    workspace.setName('Private visitor draft');
    await workspace.flush();
  });
  const other = await browser.newContext();
  try {
    await preview(other);
    const guest = await other.newPage();
    await guest.goto(`${baseURL}/app/?lang=en`);
    await expect(guest.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
    expect(await guest.evaluate(async () => (await import('/src/workspace/appWorkspace.ts')).workspace.store.getState().data?.manifest.name)).not.toBe('Private visitor draft');
  } finally { await other.close(); }
});

test('public preview explains why AI providers cannot be configured and offers local setup', async ({ page, context }) => {
  const requests: string[] = [];
  await preview(context, requests);
  await page.goto('/app/?lang=en');
  await page.evaluate(async () => (await import('/src/settings/store.ts')).openSettings('ai'));
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog.getByRole('heading', { name: 'AI is not enabled in this preview' })).toBeVisible();
  await expect(dialog.getByText(/does not provide the AI service/)).toBeVisible();
  await expect(dialog.locator('pre')).toContainText('git clone https://github.com/MarcoPeixot/joinlet.git');
  await expect(dialog.getByRole('link', { name: 'Installation guide' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(dialog.locator('input[type=password]')).toHaveCount(0);
  expect(requests).not.toContain('/api/settings');
  await dialog.getByRole('button', { name: 'Continue editing' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.react-flow')).toBeVisible();
});
