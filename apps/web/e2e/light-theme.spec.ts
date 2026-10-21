import { expect, test } from '@playwright/test';
import { printDiagramJson } from '@strukt/json';
import { streamingFixture } from '../../../packages/layout/src/nestedComposition.fixture';
import { axeFindings } from './support/axe';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('strukt:theme', 'light'));
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
});

test('light editor keeps readable layers, distinct surfaces and accessible settings', async ({ page }, info) => {
  await page.goto('/app/?lang=en');
  await page.getByRole('button', { name: 'Show/hide code', exact: true }).click();
  await page.locator('.cm-content').click(); await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(printDiagramJson(streamingFixture()));
  await expect(page.locator('.react-flow__node-icon')).toHaveCount(10);
  await page.getByRole('button', { name: 'Show/hide code', exact: true }).click();
  await expect(page.locator('.strukt-icon-node > svg')).toHaveCount(10);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return new Set(['--sk-bg', '--sk-canvas', '--sk-panel', '--sk-panel-2'].map(key => style.getPropertyValue(key).trim())).size;
  })).toBe(4);
  await page.screenshot({ path: info.outputPath('light-editor.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Settings (⌘,)', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(settings).toBeVisible();
  await expect(settings).toHaveCSS('opacity', '1');
  await expect(settings.locator('[data-testid="settings-content"] > div')).toHaveCSS('opacity', '1');
  expect(await axeFindings(page)).toEqual([]);
  await page.screenshot({ path: info.outputPath('light-settings.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(settings).toBeHidden();
  await page.getByRole('button', { name: 'AI chat', exact: true }).click();
  await page.screenshot({ path: info.outputPath('light-chat.png'), animations: 'disabled' });
  await page.evaluate(async () => {
    const { workspace } = await import('/src/workspace/appWorkspace.ts');
    await workspace.create('doc', 'Architecture decisions', '# Architecture decisions\n\nKeep the system understandable as it grows.\n\n## Data ownership\n\n| Component | Responsibility |\n| --- | --- |\n| Playback | Session and catalogue |\n| Queue | Background processing |\n\n> Each boundary has a clear purpose.');
    await workspace.flush();
  });
  await expect(page.locator('.sk-document')).toBeVisible();
  await page.screenshot({ path: info.outputPath('light-document.png'), animations: 'disabled' });
  await page.evaluate(async () => { const { workspace } = await import('/src/workspace/appWorkspace.ts'); await workspace.show({ kind: 'board' }); });
  await expect(page.locator('.strukt-card').first()).toBeVisible();
  await expect(page.locator('.strukt-card__thumb').first()).toBeVisible();
  await page.locator('.strukt-card__thumb').first().evaluate(async (image: HTMLImageElement) => image.decode());
  await page.screenshot({ path: info.outputPath('light-overview.png'), animations: 'disabled' });
});

test('light landing and public docs keep readable actions and responsive navigation', async ({ page }, info) => {
  await page.goto('/?lang=en');
  await expect(page.locator('.jo-illustration')).toBeVisible();
  await page.locator('.jo-illustration').evaluate(async (image: HTMLImageElement) => image.decode());
  expect(await axeFindings(page)).toEqual([]);
  await page.screenshot({ path: info.outputPath('light-landing.png'), animations: 'disabled' });
  await page.locator('#recursos').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('light-features.png'), animations: 'disabled' });
  await page.goto('/docs/en/introduction/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.screenshot({ path: info.outputPath('light-docs.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?lang=en');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath('light-mobile.png'), animations: 'disabled' });
});
