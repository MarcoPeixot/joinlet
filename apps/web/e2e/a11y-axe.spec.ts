import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { axeFindings } from './support/axe';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(node(page, 'Kafka')).toBeVisible();
});

/** Dialogs fade in: axe would read the half-transparent colors of the animation. */
async function settled(page: Page) {
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].every((el) => getComputedStyle(el).opacity === '1'))).toBe(true);
  await page.waitForTimeout(150);
}

test('axe finds nothing on the first screen (connection labels, headings, landmarks)', async ({ page }) => {
  expect(await axeFindings(page)).toEqual([]);
});

test('axe finds nothing with Configurações open (one banner, named landmarks)', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+Comma');
  await expect(page.getByRole('dialog', { name: 'Configurações' })).toBeVisible();
  await settled(page);
  expect(await axeFindings(page)).toEqual([]);
});

// Light (paper) is the default theme, so the first-screen test above already audits it.
for (const theme of ['dark', 'contrast']) {
  test(`axe finds nothing on the first screen in the ${theme} theme`, async ({ page }) => {
    await page.evaluate((value) => localStorage.setItem('strukt:theme', value), theme);
    await page.reload();
    await expect(node(page, 'Kafka')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.waitForTimeout(400);
    expect(await axeFindings(page)).toEqual([]);
  });
}

test('the app has one main landmark, one banner and one level-one heading', async ({ page }) => {
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('banner')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Joinlet');
  await page.keyboard.press('ControlOrMeta+Comma');
  await expect(page.getByRole('dialog', { name: 'Configurações' })).toBeVisible();
  // A modal hides the background from assistive technology; the document still owns one app banner.
  await expect(page.getByRole('banner', { includeHidden: true })).toHaveCount(1);
});

test('connections are named in Portuguese and are not Tab stops', async ({ page }) => {
  const edges = page.locator('.react-flow__edge');
  expect(await edges.count()).toBeGreaterThan(0);
  for (const label of await edges.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))) {
    expect(label).toMatch(/^Conexão de .+ para .+/);
  }
  await expect(page.locator('.react-flow__edge[tabindex]')).toHaveCount(0);
});

test('Tab walks the nodes and never stops on a connection', async ({ page }) => {
  await node(page, 'Kafka').focus();
  const seen = new Set<string>();
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.closest('.react-flow__edge') ? 'edge' : (el?.closest('.react-flow__node')?.getAttribute('data-id') ?? '');
    });
    seen.add(stop);
  }
  expect(seen.has('edge')).toBe(false);
  expect(seen.size).toBeGreaterThan(1);
});

test('Esc on Configurações returns focus to where it was (the canvas when nothing had it)', async ({ page }) => {
  await node(page, 'Kafka').focus();
  await page.keyboard.press('ControlOrMeta+Comma');
  await expect(page.getByRole('dialog', { name: 'Configurações' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Configurações' })).toHaveCount(0);
  await expect(node(page, 'Kafka')).toBeFocused();

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ControlOrMeta+Comma');
  await expect(page.getByRole('dialog', { name: 'Configurações' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Configurações' })).toHaveCount(0);
  await expect(page.locator('#canvas')).toBeFocused();
});
