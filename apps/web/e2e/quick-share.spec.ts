import { expect, test } from '@playwright/test';
import { startShareStack } from './support/shareStack';
import type { ShareStack } from './support/shareStack';

let stack: ShareStack;
test.afterEach(async () => { await stack?.dispose(); });

test('a browser workspace becomes a live session: owner and link guest edit together, reload and stop safely', async ({ browser }) => {
  test.setTimeout(90_000);
  stack = await startShareStack();
  const ownerContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await owner.goto(`${stack.owner}/app/?lang=en`);
  await expect(owner.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  // Start from browser storage: no repository path or GitHub setup.
  await owner.getByRole('button', { name: 'Share workspace', exact: true }).click();
  const dialog = owner.getByRole('dialog', { name: 'Share workspace' });
  await expect(dialog.getByText('Invite with a link. Build together.')).toBeVisible();
  await owner.route('**/api/share/tunnel/start', route => route.fulfill({ status: 400, json: { error: 'Tunnel temporarily unavailable.' } }));
  await dialog.getByRole('button', { name: 'Enable collaboration link' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Tunnel temporarily unavailable.', { timeout: 20_000 });
  await expect(dialog.getByRole('textbox', { name: 'Join link' })).toHaveCount(0);
  await owner.unroute('**/api/share/tunnel/start');
  await dialog.getByLabel('Link availability').selectOption('network');
  const link = dialog.getByRole('textbox', { name: 'Join link' });
  await expect(link).toBeVisible({ timeout: 20_000 });
  const url = await link.inputValue();
  await owner.screenshot({ path: '/tmp/joinlet-share-dialog.png' });
  await owner.getByRole('button', { name: 'Close sharing' }).click();
  const guest = await guestContext.newPage();
  await guest.goto(url);
  await expect(guest.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  // Both see the same initial diagram and a live edit from either side.
  const nodes = (page: typeof owner) => page.locator('.react-flow__node');
  const count = await nodes(owner).count();
  expect(count).toBeGreaterThan(0);
  await expect(nodes(guest)).toHaveCount(count);
  await expect(owner.getByRole('button', { name: 'Add node (N)' })).toBeEnabled();
  await owner.getByRole('button', { name: 'Add node (N)' }).click();
  await expect(nodes(owner)).toHaveCount(count + 1);
  await expect(nodes(guest)).toHaveCount(count + 1);
  await guest.getByRole('button', { name: 'Add node (N)' }).click();
  await expect(nodes(owner)).toHaveCount(count + 2);
  await owner.reload();
  await expect(nodes(owner)).toHaveCount(count + 2);
  await expect(owner.getByRole('button', { name: 'Add node (N)' })).toBeEnabled();
  await owner.getByRole('button', { name: 'Add node (N)' }).click();
  await expect(nodes(guest)).toHaveCount(count + 3);
  await owner.getByRole('button', { name: 'Share workspace', exact: true }).click();
  // The external-link action reuses the session and exposes the public address returned by the tunnel.
  await dialog.getByRole('button', { name: 'Enable collaboration link' }).click();
  await expect(link).toHaveValue(/https:\/\/e2e-demo\.trycloudflare\.com\/join\?token=/);
  await dialog.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(dialog.getByRole('button', { name: 'Enable collaboration link' })).toBeVisible();
  await owner.getByRole('button', { name: 'Close sharing' }).click();
  await expect(nodes(owner)).toHaveCount(count + 3);
  await owner.reload();
  await expect(nodes(owner)).toHaveCount(count + 3);
  await ownerContext.close();
  await guestContext.close();
});
