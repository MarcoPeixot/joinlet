import { expect, test } from '@playwright/test';
import { startShareStack } from './support/shareStack';
import { axeFindings } from './support/axe';

test.use({ storageState: { cookies: [], origins: [] } });

test('administrator can create multiple workspaces, exceed diagram and guest quotas, and see unlimited usage', async ({ page, browser }) => {
  const stack = await startShareStack({ admin: true });
  const contexts = [];
  try {
    const entitlement = await stack.api('/api/plan');
    expect(entitlement.status).toBe(200);
    await page.route('**/api/plan', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(entitlement.body) }));
    await page.goto('/app/?lang=en');
    await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
    await page.evaluate(async () => {
      const { createBrowserWorkspace } = await import('/src/workspace/projects.ts');
      const { workspace } = await import('/src/workspace/appWorkspace.ts');
      await createBrowserWorkspace('Admin second workspace');
      for (let i = 0; i < 25; i++) await workspace.create('diagram', `Admin ${i}`);
      await workspace.flush();
    });
    await page.reload();
    await page.getByRole('button', { name: 'Workspace menu' }).click();
    await page.getByRole('menuitem', { name: 'Workspace settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await settings.getByRole('button', { name: 'Plan and usage', exact: true }).click();
    await expect(settings.getByText('Administrator', { exact: true })).toBeVisible();
    await expect(settings.getByText('25 / Unlimited', { exact: true })).toBeVisible();
    await expect(settings.getByText('2 / Unlimited', { exact: true })).toBeVisible();
    await expect(settings.getByRole('progressbar')).toHaveCount(0);
    await expect.poll(() => settings.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
    expect(await axeFindings(page)).toEqual([]);
    await page.screenshot({ path: '/tmp/joinlet-admin-plan.png', animations: 'disabled' });
    const start = await stack.api<{ invites: Array<{ role: string; url: string }> }>('/api/share/start', { dir: stack.root });
    const link = start.body.invites.find(invite => invite.role === 'edit')!.url;
    for (let i = 0; i < 6; i++) {
      const guest = await browser.newContext(); contexts.push(guest);
      expect((await guest.request.get(link, { maxRedirects: 0 })).status()).toBe(302);
    }
    const plan = await contexts[0]!.request.get(`${stack.collab}/api/remote/plan`);
    expect(await plan.json()).toMatchObject({ plan: { id: 'administrator', limits: { participants: null } }, participants: 7 });
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    await stack.dispose();
  }
});
