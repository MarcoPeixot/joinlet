import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { zoomIn } from './zoom';
import { togglePanel } from './panelMenu';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

test.describe('selection and hover card', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/');
    await expect(node(page, 'Kafka')).toBeVisible();
  });

  test('a selected node shows a thin double ring in the accent token, not a strong halo', async ({ page }) => {
    await node(page, 'Kafka').click();
    const inner = node(page, 'Kafka').locator('[data-selected]');
    await expect(inner).toHaveCount(1);
    const { shadow, accent, soft } = await inner.evaluate((el) => {
      const probe = document.createElement('i');
      const root = getComputedStyle(document.documentElement);
      probe.style.color = root.getPropertyValue('--sk-accent');
      document.body.append(probe);
      const accentRgb = getComputedStyle(probe).color;
      probe.style.color = root.getPropertyValue('--sk-accent-soft');
      const softRgb = getComputedStyle(probe).color;
      probe.remove();
      return { shadow: getComputedStyle(el, '::after').boxShadow, accent: accentRgb, soft: softRgb };
    });
    expect(shadow.match(/0px 0px 0px \dpx/g)).toHaveLength(2);
    expect(shadow).toContain(accent);
    expect(shadow).toContain(soft);
    expect(shadow).toMatch(/0px 0px 0px 1px/);
    expect(shadow).toMatch(/0px 0px 0px 3px/);
  });

  test('the hover card appears after ~400 ms for a mouse and hides on press', async ({ page }) => {
    const box = (await node(page, 'Kafka').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(150);
    await expect(page.getByTestId('node-hover-card')).toHaveCount(0);
    await expect(page.getByTestId('node-hover-card')).toBeVisible({ timeout: 2000 });
    await expect(page.getByTestId('node-hover-card')).toContainText('Kafka');
    await expect(page.getByTestId('node-hover-card-host')).toHaveAttribute('aria-hidden', 'true');
    await page.mouse.down();
    await expect(page.getByTestId('node-hover-card')).toHaveCount(0);
    await page.mouse.up();
  });
});

test('no hover card on touch emulation', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('/app/');
  await expect(node(page, 'Kafka')).toBeVisible();
  const box = (await node(page, 'Kafka').boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(800);
  await expect(page.getByTestId('node-hover-card')).toHaveCount(0);
  await context.close();
});

const accentToken = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sk-accent').trim());

test.describe('accent themes', () => {
  test('the Configurações selector changes data-accent and --sk-accent, and it persists across reloads without a flash', async ({ page }) => {
    await page.goto('/app/');
    await expect(node(page, 'Kafka')).toBeVisible();
    const iris = await accentToken(page);
    await page.keyboard.press('Control+,');
    const group = page.getByRole('group', { name: 'Cor de destaque' });
    await expect(group).toBeVisible();
    await group.getByRole('button', { name: 'Esmeralda' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'emerald');
    const emerald = await accentToken(page);
    expect(emerald).not.toBe(iris);
    expect(await page.evaluate(() => localStorage.getItem('strukt:accent'))).toBe('emerald');
    await page.reload();
    // The inline boot script applies it before React mounts.
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'emerald');
    expect(await accentToken(page)).toBe(emerald);
  });
});

test('the minimap stays compact, hidden while the diagram fits and shown once it does not', async ({ page }) => {
  await page.goto('/app/');
  await expect(node(page, 'Kafka')).toBeVisible();
  await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
  await zoomIn(page, 5);
  const minimap = page.locator('.react-flow__minimap');
  await expect(minimap).toHaveCount(1);
  const box = (await minimap.boundingBox())!;
  expect(Math.round(box.width)).toBeLessThanOrEqual(170);
  expect(Math.round(box.height)).toBeLessThanOrEqual(122);
});

test.describe('motion', () => {
  test('Salvar versão: the icon becomes a drawn check once a version lands, and the toast shows a progress bar', async ({ page }) => {
    await page.goto('/app/');
    await expect(node(page, 'Kafka')).toBeVisible();
    await togglePanel(page, 'Versões');
    const panel = page.getByRole('complementary', { name: 'Versões' });
    await expect(panel).toBeVisible();
    await page.getByRole('button', { name: 'Salvar a primeira versão' }).click();
    await page.getByRole('textbox', { name: 'Descrição da versão' }).fill('primeira');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('version-saved-check')).toBeVisible();
    const bar = page.getByTestId('toast-progress');
    await expect(bar).toBeVisible();
    const name = await bar.evaluate((el) => getComputedStyle(el).animationName);
    expect(name).toContain('sk-toast-bar');
    // Hovering the toast freezes the bar with the timer.
    await page.locator('[role="status"]:has([data-testid="toast-progress"])').hover();
    await expect(bar).toHaveCSS('animation-play-state', 'paused');
  });

  async function connectNewPair(page: Page) {
    const nodeIds = await page.locator('.react-flow__node-icon').evaluateAll((els) => els.map((el) => el.getAttribute('data-id')!));
    const edgeIds = await page.locator('.react-flow__edge').evaluateAll((els) => els.map((el) => el.getAttribute('data-id')!));
    const linked = (a: string, b: string) => edgeIds.some((id) => id.includes(a) && id.includes(b));
    const pair = nodeIds.flatMap((a) => nodeIds.filter((b) => b !== a && !linked(a, b)).map((b) => [a, b] as const))[0]!;
    const from = (await node(page, pair[0]).locator('.react-flow__handle.source').first().boundingBox())!;
    const to = (await node(page, pair[1]).boundingBox())!;
    await node(page, pair[0]).hover();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
    await page.mouse.up();
    return edgeIds.length;
  }

  test('a new connection draws in once (class gone after ~600 ms)', async ({ page }) => {
    await page.goto('/app/');
    await expect(node(page, 'Kafka')).toBeVisible();
    const before = await connectNewPair(page);
    await expect(page.locator('.react-flow__edge')).toHaveCount(before + 1);
    const drawing = page.locator('.react-flow__edge.sk-edge-draw');
    await expect(drawing).toHaveCount(1);
    await expect(drawing.locator('.react-flow__edge-path')).toHaveCSS('animation-name', 'sk-edge-draw');
    await expect(drawing).toHaveCount(0, { timeout: 3000 });
  });

  test('with prefers-reduced-motion the new connection does not draw in', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/app/');
    await expect(node(page, 'Kafka')).toBeVisible();
    const before = await connectNewPair(page);
    await expect(page.locator('.react-flow__edge')).toHaveCount(before + 1);
    await expect(page.locator('.react-flow__edge.sk-edge-draw')).toHaveCount(0);
  });
});

test('accepting an AI draft: the new node fades in (opacity only) and its edges draw in', async ({ page }) => {
  await page.route('**/api/ai/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'sem chave' }) }));
  await page.goto('/app/');
  await expect(node(page, 'Kafka')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByRole('region', { name: 'Assistente de IA' });
  await panel.getByLabel('Instrução para a IA').fill('adicione Redis entre API Gateway e Pedidos');
  await panel.getByRole('button', { name: 'Enviar' }).click();
  await expect(panel.getByRole('button', { name: 'Aplicar' })).toBeVisible();
  await panel.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.locator('.react-flow__edge.sk-edge-draw')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge.sk-edge-draw')).toHaveCount(0, { timeout: 3000 });
  // Nodes never animate a transform (it would skew the boxes React Flow measures).
  const animations = await page.locator('.react-flow__node').evaluateAll((els) => els.flatMap((el) => el.getAnimations().flatMap((a) => (a as CSSAnimation).animationName)));
  expect(animations.every((name) => name === 'sk-fade-in')).toBe(true);
});
