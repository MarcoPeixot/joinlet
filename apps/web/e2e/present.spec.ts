import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const viewport = (page: Page) => page.locator('.react-flow__viewport').getAttribute('style');

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(node(page, 'Kafka')).toBeVisible();
});

test('P presents the diagram step by step and Esc gives the editor back', async ({ page }) => {
  await page.locator('#canvas').focus();
  await page.keyboard.press('p');

  const caption = page.getByRole('region', { name: 'Apresentação' });
  await expect(caption).toBeVisible();
  await expect(caption).toContainText(/1 \/ \d+/);
  await expect(page.getByRole('banner')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Aumentar zoom' })).toHaveCount(0);
  await expect(caption).toBeFocused();
  await page.waitForTimeout(900);
  const overview = await viewport(page);

  await page.keyboard.press('ArrowRight');
  await expect(caption).toContainText(/2 \/ \d+/);
  await expect.poll(() => viewport(page)).not.toBe(overview);
  await expect(page.locator('.react-flow__node.sk-dim').first()).toBeAttached();

  // Locked: a drag moves nothing (once the camera has settled).
  await page.waitForTimeout(900);
  const web = (await node(page, 'Web App').boundingBox())!;
  await page.mouse.move(web.x + web.width / 2, web.y + web.height / 2);
  await page.mouse.down();
  await page.mouse.move(web.x + web.width / 2 + 60, web.y + web.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  const still = (await node(page, 'Web App').boundingBox())!;
  expect(Math.abs(still.x - web.x)).toBeLessThan(2);

  await page.keyboard.press('Escape');
  await expect(caption).toHaveCount(0);
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aumentar zoom' })).toBeVisible();

  // Editing works again: drag, then undo.
  await page.waitForTimeout(300);
  const before = (await node(page, 'Web App').boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 80, before.y + before.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  const moved = (await node(page, 'Web App').boundingBox())!;
  expect(Math.abs(moved.x - before.x)).toBeGreaterThan(30);
  await page.getByRole('button', { name: 'Desfazer (⌘Z)' }).click();
  await expect.poll(async () => Math.abs((await node(page, 'Web App').boundingBox())!.x - before.x)).toBeLessThan(2);
});

test('the palette starts the presentation and the caption buttons navigate', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox').fill('apresent');
  await page.keyboard.press('Enter');
  const caption = page.getByRole('region', { name: 'Apresentação' });
  await expect(caption).toContainText(/1 \/ \d+/);
  await caption.getByRole('button', { name: /Próximo passo/ }).click();
  await expect(caption).toContainText(/2 \/ \d+/);
  await caption.getByRole('button', { name: /Sair da apresentação/ }).click();
  await expect(caption).toHaveCount(0);
});
