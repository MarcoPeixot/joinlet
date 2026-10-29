import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { pathPoints } from './paths';

type Box = { x: number; y: number; width: number; height: number };
const label = (page: Page, text: string) => page.locator('.strukt-edge-label', { hasText: text });
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const boxes = (locator: Locator) => locator.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as Box));

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
});

test('ELK organizes groups and keeps long captions inside their reserved space', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (/ELK worker unavailable|ELK worker failed/.test(message.text())) errors.push(message.text()); });
  await page.getByRole('button', { name: 'Mostrar/ocultar código' }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(JSON.stringify({ version: 1, style: { typeface: 'clean', styleMode: 'plain' }, nodes: [
    { id: 'Runtime', type: 'group', children: [{ id: 'LongCaption', icon: 'layers', label: 'Fila de resultados e processamento assíncrono dos workers' }, { id: 'QueueConsumersModule', icon: 'layers' }] },
    { id: 'Dados', type: 'group', children: [{ id: 'Storage', shape: 'cylinder', icon: 'postgres', label: 'PostgreSQL e pgvector' }] },
  ], connections: [{ from: 'LongCaption', to: 'Storage', label: 'Persistência' }, { from: 'QueueConsumersModule', to: 'Storage', label: 'Resultados' }] }));
  await expect(page.locator('.react-flow__node[data-id="LongCaption"]')).toBeVisible();
  await page.getByRole('button', { name: 'Mostrar/ocultar código' }).click();
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('Reorganizar diagrama');
  await page.keyboard.press('Enter');
  const runtime = page.locator('.react-flow__node[data-id="Runtime"]');
  const data = page.locator('.react-flow__node[data-id="Dados"]');
  await expect.poll(async () => overlaps((await runtime.boundingBox())!, (await data.boundingBox())!)).toBe(false);
  for (const id of ['LongCaption', 'QueueConsumersModule']) {
    const caption = (await page.locator(`.react-flow__node[data-id="${id}"] .strukt-icon-node__label`).boundingBox())!;
    const group = (await runtime.boundingBox())!;
    expect(caption.y + caption.height).toBeLessThanOrEqual(group.y + group.height + 1);
  }
  expect(errors).toEqual([]);
});

test('example edge labels are placed clear of each other and of group borders', async ({ page }) => {
  // Routes (and the labels placed with them) land ~100 ms after the diagram settles; until then the canvas
  // draws quick fallback lines. The routed Pedidos → Kafka goes around Pagamentos (corners), its fallback is straight.
  const detour = page.locator('.react-flow__edge[data-id="Pedidos→Kafka"] .react-flow__edge-path');
  await expect.poll(async () => ((await detour.getAttribute('d')) ?? '').split('Q').length - 1).toBeGreaterThanOrEqual(2);

  const [cache] = await boxes(label(page, 'cache'));
  const [events] = await boxes(label(page, 'eventos'));
  expect(overlaps(cache!, events!)).toBe(false);
  // Every label is either inside a group or outside it, never across its border (HTTPS / Frontend, eventos / Serviços).
  const inside = (outer: Box, inner: Box) =>
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
  const labels = await boxes(page.locator('.strukt-edge-label'));
  const groups = await boxes(page.locator('.react-flow__node-sgroup'));
  expect(labels).toHaveLength(5);
  expect(groups).toHaveLength(3);
  const across = labels.filter((l) => groups.some((g) => overlaps(l, g) && !inside(g, l)));
  expect(across).toEqual([]);
});

test('a Overview connection goes around the card in its way, its label clear of it', async ({ page }) => {
  const sidebar = page.getByRole('navigation', { name: 'Workspace' });
  for (const title of ['Pagamentos', 'Estoque']) {
    await sidebar.getByRole('button', { name: 'Novo diagrama' }).click();
    await page.getByRole('textbox', { name: 'Nome do diagrama' }).fill(title);
    await page.keyboard.press('Enter');
  }
  await sidebar.getByRole('button', { name: 'Overview' }).click();
  const cards = page.locator('.strukt-board .react-flow__node');
  await expect(cards).toHaveCount(3);
  let previousBoxes = '';
  await expect.poll(async () => {
    const current = JSON.stringify(await boxes(cards));
    const settled = current === previousBoxes;
    previousBoxes = current;
    return settled;
  }, { intervals: [250] }).toBe(true);
  // The Overview grid puts the three diagram cards in a row.
  const cardBoxes = (await Promise.all((await cards.all()).map(async (card) => ({ card, box: (await card.boundingBox())! })))).sort((a, b) => a.box.x - b.box.x);
  const [first, middle, last] = cardBoxes as [(typeof cardBoxes)[number], (typeof cardBoxes)[number], (typeof cardBoxes)[number]];
  expect(Math.abs(first.box.y - last.box.y)).toBeLessThan(1);
  const port = (await first.card.locator('.react-flow__handle-right.source').boundingBox())!;
  await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.box.x + last.box.width / 2, last.box.y + last.box.height / 2, { steps: 16 });
  await page.mouse.up();
  const path = page.locator('.strukt-board .react-flow__edge .react-flow__edge-path');
  await expect(path).toHaveCount(1);

  const inMiddle = (p: { x: number; y: number }) =>
    p.x > middle.box.x && p.x < middle.box.x + middle.box.width && p.y > middle.box.y && p.y < middle.box.y + middle.box.height;
  // Until the route lands (~100 ms after the geometry settles) the plain elbow runs behind the middle card.
  await expect.poll(async () => (await pathPoints(path, 80)).filter(inMiddle).length).toBe(0);

  const [, halfway] = await pathPoints(path, 2);
  await page.mouse.dblclick(halfway!.x, halfway!.y);
  await page.getByRole('textbox', { name: 'Rótulo da conexão' }).fill('HTTP');
  await page.keyboard.press('Enter');
  const pill = page.locator('.strukt-board .strukt-edge-label');
  await expect(pill).toHaveText('HTTP');
  await expect.poll(async () => overlaps((await pill.boundingBox())!, middle.box)).toBe(false);
});
