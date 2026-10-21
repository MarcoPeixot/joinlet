import type { Page } from '@playwright/test';

/** One click per animation: `zoomIn` glides for 180 ms, and clicks during the glide are swallowed. */
export async function zoomIn(page: Page, times: number) {
  for (let i = 0; i < times; i++) {
    await page.getByRole('button', { name: 'Aumentar zoom' }).click();
    await page.waitForTimeout(230);
  }
}
