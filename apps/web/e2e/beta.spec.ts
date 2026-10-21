import { expect, test } from '@playwright/test';
import { startShareStack } from './support/shareStack';
import { axeFindings } from './support/axe';

test.use({ storageState: { cookies: [], origins: [] } });
// A developer may enable local admin; these two browser-only tests explicitly exercise the regular plan.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/plan', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan: { id: 'free-beta' }, accountPlan: { id: 'free-beta' } }) }));
});

test('beta usage is visible, the 21st diagram is refused, and existing data survives reload', async ({ page }) => {
  await page.goto('/app/?lang=en');
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  const result = await page.evaluate(async () => {
    const { workspace } = await import('/src/workspace/appWorkspace.ts');
    while (workspace.store.getState().data!.manifest.diagrams.length < 20) {
      await workspace.create('diagram', `Beta ${workspace.store.getState().data!.manifest.diagrams.length}`);
    }
    let error = '';
    try { await workspace.create('diagram', 'Too many'); } catch (cause) { error = (cause as { code: string }).code; }
    await workspace.create('doc', 'Beta notes');
    await workspace.flush();
    return { error, count: workspace.store.getState().data!.manifest.diagrams.length };
  });
  expect(result).toEqual({ error: 'DIAGRAM_LIMIT_REACHED', count: 20 });
  await page.reload();
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await page.getByRole('menuitem', { name: 'Workspace settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('button', { name: 'Plan and usage', exact: true }).click();
  await expect(settings.getByRole('progressbar', { name: 'Diagrams in this workspace' })).toHaveAttribute('value', '20');
  await expect(settings.getByRole('progressbar', { name: 'Owned workspaces' })).toHaveAttribute('value', '1');
  await expect(settings.getByText('Free', { exact: true })).toBeVisible();
  await expect(settings.getByText(/In local mode/)).toBeVisible();
  await expect.poll(() => settings.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
  expect(await axeFindings(page)).toEqual([]);
  await page.screenshot({ path: '/tmp/joinlet-beta-plan.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(settings.getByRole('tab', { name: 'Plan and usage' })).toBeVisible();
  expect(await settings.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: '/tmp/joinlet-beta-plan-mobile.png', animations: 'disabled' });
});

test('two tabs cannot reserve two owned workspaces', async ({ page, context }) => {
  await page.goto('/app/?lang=en');
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  const second = await context.newPage();
  await second.goto('/app/?lang=en');
  await expect(second.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  for (const tab of [page, second]) await expect.poll(() => tab.evaluate(async () => {
    const { catalogStore } = await import('/src/workspace/catalog.ts');
    const state = catalogStore.getState();
    return !state.busy && state.catalog?.entries.length === 1;
  })).toBe(true);
  await page.evaluate(async () => {
    const { updateCatalog } = await import('/src/workspace/catalog.ts');
    await updateCatalog(() => ({ version: 1, activeId: null, entries: [] }));
  });
  const create = async (tab: typeof page, name: string) => tab.evaluate(async name => {
    const { createBrowserWorkspace } = await import('/src/workspace/projects.ts');
    try { await createBrowserWorkspace(name); return 'created'; }
    catch (error) { return (error as { code?: string }).code ?? String(error); }
  }, name);
  const results = await Promise.all([create(page, 'First'), create(second, 'Second')]);
  expect(results).toContain('created');
  expect(results.filter(result => result === 'created')).toHaveLength(1);
  expect(await page.evaluate(async () => (await (await import('/src/workspace/catalog.ts')).loadCatalog())?.entries.length)).toBe(1);
});

test('one share link admits four distinct guest browsers and refuses a fifth without blocking the owner', async ({ browser }) => {
  const stack = await startShareStack({ cloud: true });
  const contexts = [];
  try {
    const start = await stack.api<{ invites: Array<{ role: string; url: string }> }>('/api/share/start', { dir: stack.root });
    expect(start.status).toBe(200);
    const url = start.body.invites.find(invite => invite.role === 'edit')!.url;
    for (let i = 0; i < 5; i++) {
      const context = await browser.newContext(); contexts.push(context);
      const page = await context.newPage();
      const response = await page.goto(url);
      if (i < 4) {
        await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
        // Same session across reloads must not take a second slot.
        await page.reload();
        await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
      } else {
        expect(response?.status()).toBe(403);
        await expect(page.getByText(/Joinlet Beta limit of 5/)).toBeVisible();
      }
    }
    const ownerPlan = await stack.api<{ participants: number }>('/api/share/live/remote/plan');
    expect(ownerPlan.status).toBe(200);
    expect(ownerPlan.body.participants).toBe(5);
  } finally { await Promise.all(contexts.map(context => context.close())); await stack.dispose(); }
});
