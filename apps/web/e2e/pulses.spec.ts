import { expect, test } from '@playwright/test';

// The focus pulse runs along the drawn line, which stops where the arrowhead begins: it never crosses the head.

test('a focused edge pulses along its line, ending before the arrowhead', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  const edge = page.locator('.react-flow__edge[data-id="Pedidos→PostgreSQL"]');
  await expect(edge).toBeVisible();
  await page.locator('.react-flow__node[data-id="Pedidos"]').click();

  const pulse = edge.locator('.strukt-flow path').first();
  await expect(pulse).toHaveCount(1);
  const line = await edge.locator('.react-flow__edge-path').getAttribute('d');
  expect(await pulse.getAttribute('d')).toBe(line);

  // The line (and so the pulse) ends short of the arrowhead's tip, which is the route's last point.
  const end = (d: string) => d.trim().split(/\s+/).slice(-2).map(Number);
  const head = await edge.locator('path[fill]').last().getAttribute('d');
  const tip = head!.match(/M\s*([\d.-]+)\s+([\d.-]+)/)!.slice(1).map(Number);
  const [x, y] = end(line!);
  expect(Math.hypot(x! - tip[0]!, y! - tip[1]!)).toBeGreaterThan(5);
});

test('zooming never changes how fast pulses travel along the drawing', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await page.locator('.react-flow__node[data-id="Pedidos"]').click();
  const pulse = page.locator('.react-flow__edge[data-id="Pedidos→PostgreSQL"] .strukt-flow path').first();
  await expect(pulse).toHaveCount(1);
  const seconds = () => pulse.evaluate((el) => getComputedStyle(el).animationDuration);
  const before = await seconds();
  await page.getByRole('button', { name: 'Diminuir zoom', exact: true }).click();
  await page.waitForTimeout(400);
  expect(await seconds()).toBe(before);
  await page.getByRole('button', { name: 'Aumentar zoom', exact: true }).click();
  await page.getByRole('button', { name: 'Aumentar zoom', exact: true }).click();
  await page.waitForTimeout(400);
  expect(await seconds()).toBe(before);
});
