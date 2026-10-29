import { expect, test } from '@playwright/test';

// Hovering a connection in the Inspector lights only that one on the canvas; moving down the list goes straight
// from one to the next (no gap between rows, no flash of the plain state where every connection is lit).

test('moving across the connection list never flashes the plain state', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await page.locator('.react-flow__node[data-id="Pedidos"]').click();
  const rows = page.locator('.sk-inspector-connection');
  await expect(rows.nth(2)).toBeVisible();

  // Rows touch: the pointer is always over one of them.
  const first = (await rows.nth(0).boundingBox())!;
  const second = (await rows.nth(1).boundingBox())!;
  expect(Math.abs(second.y - (first.y + first.height))).toBeLessThanOrEqual(1);

  await rows.nth(0).hover();
  await expect(page.locator('.react-flow__edge.sk-focus-edge')).toHaveCount(1);
  // Record, every frame, how many edges are lit while the pointer walks down the list.
  await page.evaluate(() => {
    const lit: number[] = [];
    const tick = () => { lit.push(document.querySelectorAll('.react-flow__edge.sk-focus-edge').length); if (lit.length < 400) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    (window as unknown as { lit: number[] }).lit = lit;
  });
  const last = (await rows.nth(2).boundingBox())!;
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 20 });
  await page.waitForTimeout(300);
  const lit = await page.evaluate(() => (window as unknown as { lit: number[] }).lit);
  expect(Math.max(...lit)).toBe(1);
});
