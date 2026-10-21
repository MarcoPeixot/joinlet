import { expect, test } from '@playwright/test';
import { axeFindings } from './support/axe';

for (const theme of ['light', 'dark']) test(`visual stories are readable and interactive in ${theme}`, async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(value => localStorage.setItem('strukt:theme', value), theme);
  await page.goto('/?lang=en');
  const features = page.locator('.feature-showcase');
  await features.scrollIntoViewIfNeeded();
  await features.getByRole('button', { name: 'Preview API', exact: true }).click();
  await expect(features.locator('.component-result strong')).toHaveText('API');
  await features.screenshot({ path: info.outputPath(`features-${theme}.png`) });
  await page.locator('#repositorio > summary').click();
  const repo = page.locator('.repo-story');
  await repo.getByRole('button', { name: '02 Review the impact' }).click();
  await expect(repo.getByRole('heading', { name: 'Know exactly what you are approving.' })).toBeVisible();
  await expect(repo).not.toHaveAttribute('data-applied');
  await repo.screenshot({ path: info.outputPath(`repository-${theme}.png`) });
  await repo.locator('.repo-technical summary').click();
  await repo.getByRole('button', { name: 'Layout', exact: true }).click();
  await expect(repo.locator('.diff-file-bar')).toContainText('layout.json');
  await page.locator('#agentes > summary').click();
  const agent = page.locator('.agent-story');
  await agent.getByRole('button', { name: /03 Propose a clear change/ }).click();
  await expect(agent.getByRole('heading', { name: 'A proposal you can review.' })).toBeVisible();
  await agent.screenshot({ path: info.outputPath(`agents-${theme}.png`) });
  await agent.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  await expect(repo).toHaveAttribute('data-applied', 'true');
  await expect(agent.locator('.event-scene')).toHaveAttribute('data-applied', 'true');
  await agent.locator('.agent-setup summary').click();
  await expect(agent.locator('.snippet pre').first()).toHaveText('claude mcp add joinlet -- \\\n  bun <repo>/apps/mcp/src/main.ts --dir .');
  expect(await axeFindings(page)).toEqual([]);
});

test('stories can pause and advance manually without applying changes', async ({ page }) => {
  await page.goto('/?lang=en');
  await page.locator('#repositorio > summary').click();
  const repo = page.locator('.repo-story');
  await repo.scrollIntoViewIfNeeded();
  await repo.getByRole('button', { name: 'Pause demo' }).click();
  await expect(repo).not.toHaveAttribute('data-playing');
  await repo.getByRole('button', { name: '03 Keep it together' }).click();
  await expect(repo.getByRole('heading', { name: 'Your system and its history, together.' })).toBeVisible();
  await expect(repo).not.toHaveAttribute('data-applied');
  await repo.getByRole('button', { name: 'Play demo' }).click();
  await expect(repo).toHaveAttribute('data-playing', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(repo).not.toHaveAttribute('data-playing');
  await expect(repo.getByRole('button', { name: 'Play demo' })).toBeDisabled();
});

for (const width of [320,390]) test(`visual stories fit ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?lang=pt-BR');
  await page.locator('#repositorio > summary').click();
  await page.locator('#agentes > summary').click();
  for (const selector of ['.feature-showcase','.repo-story','.agent-story']) {
    const section = page.locator(selector); await section.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await section.screenshot({ path: info.outputPath(`${selector.slice(1)}-${width}.png`) });
  }
});

test('Overview minimap shows real contents and neither canvas shows attribution', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('strukt:theme','dark'));
  await page.goto('/app/?lang=en');
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
  await expect(page.locator('.react-flow__attribution')).toHaveCount(0);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  const minimap = page.locator('.sk-board-minimap');
  await expect(minimap.locator('image[data-card-thumbnail]').first()).toBeVisible();
  const source = await minimap.locator('image[data-card-thumbnail]').first().getAttribute('href');
  expect(decodeURIComponent(source!)).toContain('Kafka');
  expect(decodeURIComponent(source!)).toContain('<path');
  await expect(page.locator('.react-flow__attribution')).toHaveCount(0);
  const content = minimap.locator('[data-overview-content]');
  const framing = await content.getAttribute('transform');
  const viewport = minimap.locator('.sk-minimap-viewport');
  const before = await viewport.getAttribute('x');
  await minimap.getByRole('img', { name: 'Minimap', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(viewport).not.toHaveAttribute('x', before!);
  expect(await content.getAttribute('transform')).toBe(framing);
  await minimap.screenshot({ path: info.outputPath('overview-minimap.png') });
  await page.screenshot({ path: info.outputPath('overview-dots.png') });
});
