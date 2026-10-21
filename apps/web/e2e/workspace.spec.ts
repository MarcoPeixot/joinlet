import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { pathPoints } from './paths';
import { readFile, savedDiagram } from './storage';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Workspace' });

async function create(page: Page, kind: 'diagrama' | 'documento', title: string) {
  await sidebar(page).getByRole('button', { name: `Novo ${kind}` }).click();
  await page.getByRole('textbox', { name: `Nome do ${kind}` }).fill(title);
  await page.keyboard.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(node(page, 'Kafka')).toBeVisible();
});

test('two diagrams, a doc linked to a node and the Overview survive a reload', async ({ page }) => {
  await create(page, 'diagrama', 'Pagamentos');
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page.getByRole('button', { name: 'Adicionar nó (N)' }).click();
  await page.keyboard.type('Stripe');
  await page.keyboard.press('Enter');
  await expect(node(page, 'Stripe')).toBeVisible();

  await sidebar(page).getByRole('button', { name: 'Exemplo', exact: true }).click();
  await expect(node(page, 'Kafka')).toBeVisible();
  await expect(node(page, 'Stripe')).toHaveCount(0);

  await create(page, 'documento', 'API de Pedidos');
  await page.getByLabel('Editor do documento').locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('Contrato REST com idempotência.');
  await expect(page.locator('.cm-content')).toContainText('Contrato REST com idempotência.');

  await sidebar(page).getByRole('button', { name: 'Exemplo', exact: true }).click();
  await node(page, 'Pedidos').click();
  await page.getByRole('tab', { name: 'Editar' }).click();
  await page.getByText('Vínculos e documentação', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Documento', exact: true }).selectOption('api-de-pedidos');
  await node(page, 'Pedidos').getByRole('button', { name: 'Abrir documento' }).click();
  await page.getByRole('button', { name: 'Vínculos do documento', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Referenciado por' })).toContainText('Pedidos · Exemplo');

  await sidebar(page).getByRole('button', { name: 'Overview' }).click();
  for (const id of ['diagram:exemplo', 'diagram:pagamentos', 'doc:api-de-pedidos']) await expect(node(page, id)).toBeVisible();
  await expect(node(page, 'diagram:exemplo').locator('img')).toBeVisible();
  await expect(node(page, 'doc:api-de-pedidos')).toContainText('Contrato REST');

  await expect.poll(async () => (await savedDiagram(page, 'pagamentos'))?.model.order).toEqual(['Stripe']);
  await expect.poll(async () => (await savedDiagram(page, 'exemplo'))?.model.elements.Pedidos?.link).toBe('doc:api-de-pedidos');
  await expect.poll(async () => JSON.parse((await readFile(page, 'board.json')) ?? '{"cards":[]}').cards.length).toBe(3);

  await page.reload();
  await expect(node(page, 'diagram:exemplo')).toBeVisible();
  await expect(sidebar(page).getByRole('button', { name: 'Pagamentos', exact: true })).toBeVisible();
  await sidebar(page).getByRole('button', { name: 'Overview' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await node(page, 'diagram:pagamentos').dblclick();
  await expect(node(page, 'Stripe')).toBeVisible();
});

test('docs render sanitized Markdown', async ({ page }) => {
  await create(page, 'documento', 'Notas');
  await page.getByLabel('Editor do documento').locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('[site](https://example.com) [x](javascript:alert(1)) <img src=x onerror="window.pwned=1">');
  await page.keyboard.type('\n\n');
  const preview = page.locator('.sk-doc-editor');
  await expect(preview.locator('.cm-link').first()).toContainText('site');
  await expect(preview.locator('a[href^="javascript"]')).toHaveCount(0);
  await expect(preview.locator('img[onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as { pwned?: number }).pwned)).toBeUndefined();
});

test('deleting an item removes it at once and "Desfazer" brings it back', async ({ page }) => {
  await create(page, 'documento', 'Rascunho');
  const item = sidebar(page).getByRole('button', { name: 'Rascunho', exact: true });
  await expect(item).toBeVisible();
  await item.hover();
  await sidebar(page).getByRole('button', { name: 'Excluir Rascunho' }).click();
  await expect(item).toHaveCount(0);
  await expect.poll(() => readFile(page, 'docs/rascunho.md')).toBeNull();
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(item).toBeVisible();
  await expect.poll(() => readFile(page, 'docs/rascunho.md')).not.toBeNull();
});

test('"Salvar como doc" keeps the generated documentation as a workspace doc', async ({ page }) => {
  const markdown = '# Arquitetura da Loja\n\n## Visão geral\n\nTexto gerado.\n';
  await page.route('**/api/ai/doc', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ markdown }) }));
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('Gerar documentação');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Documentação da arquitetura' });
  await dialog.getByRole('button', { name: 'Salvar como doc' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(sidebar(page).getByRole('button', { name: 'Arquitetura da Loja', exact: true })).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('Visão geral');
  await expect.poll(() => readFile(page, 'docs/arquitetura-da-loja.md')).toBe(markdown);
});

test('Nova nota lands in view, focused, and is saved', async ({ page }) => {
  await sidebar(page).getByRole('button', { name: 'Overview' }).click();
  const board = page.locator('.strukt-board');
  await expect(node(page, 'diagram:exemplo')).toBeVisible();
  await board.getByRole('button', { name: 'Nova nota' }).click();
  await page.keyboard.type('Lembrete');
  const note = page.locator('[aria-label="Texto da nota"]');
  await expect(note).toHaveValue('Lembrete');
  const inPane = async () => {
    const [box, pane] = await Promise.all([note.boundingBox(), board.boundingBox()]);
    return !!box && !!pane && box.x >= pane.x && box.y >= pane.y && box.x + box.width <= pane.x + pane.width && box.y + box.height <= pane.y + pane.height;
  };
  expect(await inPane()).toBe(true);
  await expect
    .poll(async () => {
      const saved = JSON.parse((await readFile(page, 'board.json')) ?? '{"cards":[]}') as { cards: { kind: string; text?: string }[] };
      return saved.cards.find((card) => card.kind === 'note')?.text;
    })
    .toBe('Lembrete');
  await board.getByRole('button', { name: 'Ajustar à tela' }).click();
  await expect.poll(inPane).toBe(true);
});

test('a Overview connection takes a label, and "Animar fluxo" sends packets along diagram and Overview edges', async ({ page }) => {
  const pulses = (scope: string) => page.locator(`${scope} [data-flow-pulse]`);
  const https = ['Web App→API Gateway', 'Mobile→API Gateway'].map((id) => page.locator(`.react-flow__edge[data-id="${id}"]`));
  await expect(pulses('.react-flow')).toHaveCount(0);
  await expect(page.getByRole('toolbar',{name:'Ferramentas do diagrama'}).getByRole('button',{name:'Animar fluxo'})).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('Animar fluxo');
  await page.keyboard.press('Enter');
  // Two packets per edge, half a trip apart, on the request's way (Mobile → gateway).
  for (const edge of https) await expect(edge.locator('[data-flow-pulse]')).toHaveCount(2);

  await sidebar(page).getByRole('button', { name: 'Overview' }).click();
  const board = page.locator('.strukt-board');
  await expect(node(page, 'diagram:exemplo')).toBeVisible();
  await board.getByRole('button', { name: 'Nova nota' }).click();
  const note = page.locator('.react-flow__node').filter({ has: page.getByLabel('Texto da nota') });
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
  };
  const center = (box: { x: number; y: number; width: number; height: number } | null) => ({ x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });
  // The new note lands flush under the card: the connection goes around them, visible.
  await drag(center(await node(page, 'diagram:exemplo').locator('.react-flow__handle.source').boundingBox()), center(await note.boundingBox()));
  const link = board.locator('.react-flow__edge');
  await expect(link).toHaveCount(1);
  const path = link.locator('.react-flow__edge-path');
  expect(await path.evaluate((el) => (el as SVGPathElement).getTotalLength())).toBeGreaterThan(40);

  const [, middle] = await pathPoints(path, 2);
  await page.mouse.dblclick(middle!.x, middle!.y);
  await page.getByRole('textbox', { name: 'Rótulo da conexão' }).fill('HTTP');
  await page.keyboard.press('Enter');
  await expect(board.locator('.strukt-link__label')).toHaveText('HTTP');
  await expect.poll(() => readFile(page, 'board.json')).toContain('"label": "HTTP"');

  // The preference is the visitor's, shared by both canvases: already on here.
  const boardFlow = board.getByRole('button', { name: 'Animar fluxo' });
  await expect(boardFlow).toHaveAttribute('aria-pressed', 'true');
  await expect(pulses('.strukt-board')).toHaveCount(2);
  await boardFlow.click();
  await expect(pulses('.strukt-board')).toHaveCount(0);
  await sidebar(page).getByRole('button', { name: 'Exemplo', exact: true }).click();
  await expect(node(page, 'Kafka')).toBeVisible();
  await expect(pulses('.react-flow')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('Animar fluxo');
  await page.keyboard.press('Enter');
  for (const edge of https) await expect(edge.locator('[data-flow-pulse]')).toHaveCount(2);
});

test('M4 criterion: a workspace with 3 diagrams and 2 docs is navigable from the Overview and survives a reload', async ({ page }) => {
  await create(page, 'diagrama', 'Pagamentos');
  await create(page, 'diagrama', 'Estoque');
  await create(page, 'documento', 'Decisões');
  await create(page, 'documento', 'Glossário');
  await expect(sidebar(page).getByRole('button', { name: 'Glossário', exact: true })).toBeVisible();

  await sidebar(page).getByRole('button', { name: 'Overview' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await node(page, 'doc:glossario').dblclick();
  await expect(page.getByLabel('Editor do documento')).toBeVisible();
  await page.getByRole('button', { name: 'Vínculos do documento', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Referenciado por' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trocar documento: Glossário', exact: true })).toBeVisible();

  await sidebar(page).getByRole('button', { name: 'Overview' }).click();
  await node(page, 'diagram:estoque').dblclick();
  await expect(sidebar(page).getByRole('button', { name: 'Estoque', exact: true })).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);

  await expect.poll(async () => JSON.parse((await readFile(page, 'strukt.json')) ?? '{"docs":[]}').docs.length).toBe(2);
  await expect.poll(async () => JSON.parse((await readFile(page, 'board.json')) ?? '{"cards":[]}').cards.length).toBe(5);
  await page.reload();
  await expect(sidebar(page).getByRole('button', { name: 'Glossário', exact: true })).toBeVisible();
  await sidebar(page).getByRole('button', { name: 'Overview' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
});
