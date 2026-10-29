import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Board } from '@strukt/workspace';

const boardOf = (page: Page) => page.evaluate(async () => (await import('/src/workspace/appWorkspace.ts')).workspace.store.getState().data!.board);
const flush = (page: Page) => page.evaluate(async () => (await import('/src/workspace/appWorkspace.ts')).workspace.flush());

async function openBoard(page: Page, board: Board) {
  await page.goto('/app/?lang=pt-BR');
  await expect(page.locator('.react-flow')).toBeVisible();
  await page.evaluate(async (board) => {
    const { workspace } = await import('/src/workspace/appWorkspace.ts');
    await workspace.show({ kind: 'board' });
    workspace.updateBoard(() => board);
    await workspace.flush();
  }, board);
}

async function drag(page: Page, box: { x: number; y: number; width: number; height: number }, dx: number, dy: number) {
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 15 });
  await page.mouse.up();
}

test('an Overview drag is saved on release and survives reload', async ({ page }) => {
  await openBoard(page, { version: 1, cards: [{ id: 'note', kind: 'note', text: 'Persist this position', x: 400, y: 250, w: 280, h: 200 }], sections: [], connections: [] });
  const grip = page.locator('[data-id="note"] .strukt-card__grip');
  await expect(grip).toBeVisible();
  const before = (await grip.boundingBox())!;
  await drag(page, before, 140, 90);
  expect(Math.abs((await grip.boundingBox())!.x - before.x)).toBeGreaterThan(70);
  await expect.poll(async () => (await boardOf(page)).cards[0]!.x).not.toBe(400);
  await flush(page);
  const saved = await boardOf(page);
  await page.reload();
  await expect(page.locator('.strukt-board')).toBeVisible();
  expect((await boardOf(page)).cards.find((card) => card.id === 'note')).toEqual(saved.cards[0]);
});

test('an empty section resize is saved, undoable and survives reload', async ({ page }) => {
  await openBoard(page, {
    version: 1, cards: [{ id: 'note', kind: 'note', text: 'Outside', x: 40, y: 40, w: 200, h: 160 }],
    sections: [{ id: 'section', title: 'Resize', x: 400, y: 250, w: 300, h: 200 }], connections: [],
  });
  const section = page.locator('.react-flow__node[data-id="section"]');
  await section.locator('.strukt-group__title').click();
  const handle = section.locator('.react-flow__resize-control.bottom.right.handle');
  await expect(handle).toBeVisible();
  await drag(page, (await handle.boundingBox())!, 100, 70);
  await expect.poll(async () => (await boardOf(page)).sections[0]!.w).toBeGreaterThan(350);
  const resized = (await boardOf(page)).sections;
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await boardOf(page)).sections[0]!.w).toBe(300);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => (await boardOf(page)).sections).toEqual(resized);
  await flush(page);
  await page.reload();
  await expect(page.locator('.strukt-board')).toBeVisible();
  expect((await boardOf(page)).sections).toEqual(resized);
});
