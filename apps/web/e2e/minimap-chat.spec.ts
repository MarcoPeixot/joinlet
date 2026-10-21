import { expect, test } from '@playwright/test';
import { zoomIn } from './zoom';

test.use({ reducedMotion: 'reduce' });

for (const theme of ['light', 'dark'] as const) {
  test(`the ${theme} minimap renders the topology and keeps its scale while navigating`, async ({ page }, info) => {
    await page.addInitScript((value) => localStorage.setItem('strukt:theme', value), theme);
    await page.goto('/app/');
    await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
    await zoomIn(page, 5);
    const map = page.locator('.sk-minimap');
    const svg = page.getByRole('img', { name: 'Minimapa', exact: true });
    await expect(svg).toBeVisible();
    const preview = map.locator('image[data-diagram-preview]');
    const source = await preview.getAttribute('href');
    const markup = decodeURIComponent(source!.split(',').slice(1).join(','));
    expect(markup).toContain('Kafka');
    expect(markup).toContain('<path');
    expect(markup).toContain('<text');
    const appearance = await preview.getAttribute('href');
    const viewport = map.locator('.sk-minimap-viewport');
    const before = await viewport.getAttribute('x');
    await svg.focus();
    await page.keyboard.press('ArrowRight');
    await expect(viewport).not.toHaveAttribute('x', before!);
    expect(await preview.getAttribute('href')).toEqual(appearance);
    const zoom = await page.getByRole('button', { name: 'Zoom em 100%' }).innerText();
    await svg.dispatchEvent('wheel', { deltaY: -80, bubbles: true, cancelable: true });
    await expect(page.getByRole('button', { name: 'Zoom em 100%' })).not.toHaveText(zoom);
    await map.screenshot({ path: info.outputPath('minimap.png'), animations: 'disabled' });
    const bounds = (await svg.boundingBox())!;
    const x = bounds.x + Number(await viewport.getAttribute('x')) + Number(await viewport.getAttribute('width')) / 2;
    const y = bounds.y + Number(await viewport.getAttribute('y')) + Number(await viewport.getAttribute('height')) / 2;
    const previous = await viewport.getAttribute('x');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 12, y + 6, { steps: 5 });
    await page.mouse.up();
    await expect(viewport).not.toHaveAttribute('x', previous!);
  });
}

for (const width of [1440, 1024, 768]) {
  test(`the integrated chat starts below the workspace header at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/app/');
    await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
    const chat = page.getByRole('complementary', { name: 'Chat com a IA', exact: true });
    await expect(chat.getByRole('textbox', { name: 'Mensagem para a IA' })).toBeVisible();
    const canvas = (await page.locator('#canvas').boundingBox())!;
    const panel = (await chat.boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(canvas.x + canvas.width);
    expect(panel.y).toBe(canvas.y);
    expect(panel.width).toBeGreaterThanOrEqual(320);
    expect(panel.x + panel.width).toBeLessThanOrEqual(width);
    expect(panel.y + panel.height).toBeLessThanOrEqual(900);
    await page.screenshot({ path: info.outputPath('chat.png'), animations: 'disabled' });
  });
}
