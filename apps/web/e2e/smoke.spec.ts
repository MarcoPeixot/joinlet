import { readFileSync } from 'node:fs';
import { applyOps } from '@strukt/core';
import { printDiagramJson } from '@strukt/json';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { savedDiagram } from './storage';

type Saved = Awaited<ReturnType<typeof savedDiagram>>;

/** Each test starts with empty storage: a new workspace whose diagram "Exemplo" is the example. */
const saved = (page: Page) => savedDiagram(page, 'exemplo');
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(node(page, 'Kafka')).toBeVisible();
});

test('dragging a node into a group is a single undo step', async ({ page }) => {
  const kafka = node(page, 'Kafka');
  const before = (await kafka.boundingBox())!;
  const group = (await node(page, 'Serviços').boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(group.x + group.width / 2, group.y + group.height - 24, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await saved(page))?.model.elements.Kafka?.parentId).toBe('Serviços');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await saved(page))?.model.elements.Kafka?.parentId ?? 'none').toBe('none');
  await expect.poll(async () => (await kafka.boundingBox())?.x).toBeCloseTo(before.x, 0);
  expect((await kafka.boundingBox())?.y).toBeCloseTo(before.y, 0);
});

test('⌘→ on a selected node creates exactly one connected node', async ({ page }) => {
  const nodes = page.locator('.react-flow__node');
  const edges = page.locator('.react-flow__edge');
  const [nodeCount, edgeCount] = [await nodes.count(), await edges.count()];
  await node(page, 'Redis').click();
  await page.keyboard.press('ControlOrMeta+ArrowRight');
  await expect(nodes).toHaveCount(nodeCount + 1);
  await expect(edges).toHaveCount(edgeCount + 1);
  await expect.poll(async () => (await saved(page))?.model.edges.filter((e) => e.from === 'Redis').length).toBe(1);
});

test('diagram appearance lives in a toolbar popover; the Inspector only shows with a selection', async ({ page }) => {
  const inspector = page.getByRole('complementary', { name: 'Propriedades' });
  await expect(inspector).toHaveCount(0);
  await page.getByRole('button', { name: 'Aparência do diagrama' }).click();
  const menu = page.getByRole('dialog', { name: 'Aparência do diagrama' });
  await menu.getByRole('button', { name: 'Forte' }).click();
  await expect.poll(async () => (await saved(page))?.model.style.colorMode).toBe('bold');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await node(page, 'Redis').click();
  await expect(inspector.getByRole('heading', { name: 'Nó' })).toBeVisible();
});

test('chrome: ⌘\\ folds the sidebar, an empty canvas offers a start, the AI pill opens the composer', async ({ page }) => {
  const sidebar = page.getByRole('navigation', { name: 'Workspace' });
  await page.keyboard.press('ControlOrMeta+Backslash');
  await expect(sidebar).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Backslash');
  await expect(sidebar).toBeVisible();
  // No toggle button on desktop (⌘\\ and Configurações do it); the sidebar has no collapse button either.
  await expect(page.getByRole('button', { name: /barra lateral/ })).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Backslash');
  await expect(sidebar).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Backslash');
  await expect(sidebar).toBeVisible();

  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  const start = page.getByRole('heading', { name: 'Descreva sua arquitetura' });
  await expect(start).toBeVisible();
  await page.getByRole('button', { name: /Adicionar nó/ }).first().click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(start).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+j');
  await expect(page.getByRole('region', { name: 'Assistente de IA' }).getByLabel('Instrução para a IA')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Assistente de IA' })).toHaveCount(0);
});

test('focus: a clicked node lights its neighbours and pulses its edges; the passport walks the connections', async ({ page }) => {
  const focusEdges = page.locator('.react-flow__edge.sk-focus-edge');
  await node(page, 'Pedidos').click();
  await expect(node(page, 'Web App')).toHaveClass(/sk-dim/);
  await expect(node(page, 'API Gateway')).not.toHaveClass(/sk-dim/);
  await expect(node(page, 'Pedidos')).toHaveClass(/sk-focus-origin/);
  await expect(focusEdges).toHaveCount(4);
  // "Animar fluxo" is off, yet the focused edges carry their requests (two bars per direction).
  await expect(page.locator('.react-flow__edge[data-id="Pedidos→Redis"] [data-flow-pulse]')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge[data-id="Web App→API Gateway"] [data-flow-pulse]')).toHaveCount(0);

  const panel = page.getByRole('complementary', { name: 'Propriedades' });
  await expect(panel.getByRole('list', { name: 'Saídas' }).getByRole('listitem')).toHaveCount(3);
  await expect(panel.getByRole('list', { name: 'Entradas' }).getByRole('listitem')).toHaveCount(1);

  await panel.getByRole('button', { name: /Depois/ }).click();
  await expect(node(page, 'Pagamentos')).not.toHaveClass(/sk-dim/);
  await expect(node(page, 'API Gateway')).toHaveClass(/sk-dim/);
  await panel.getByRole('button', { name: /Depois/ }).click();

  await panel.getByRole('list', { name: 'Saídas' }).getByRole('button', { name: /Redis/ }).hover();
  await expect(focusEdges).toHaveCount(1);
  await panel.getByRole('list', { name: 'Entradas' }).getByRole('button', { name: /API Gateway/ }).click();
  await expect(node(page, 'API Gateway')).toHaveClass(/sk-focus-origin/);
  await expect(panel.getByText('API Gateway').first()).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.react-flow__node.sk-dim')).toHaveCount(0);
});

test('SVG export downloads a standalone, non-empty svg', async ({ page }) => {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar' }).click();
  await page.getByRole('menuitem', { name: /Exportar SVG/ }).click();
  const svg = readFileSync((await (await download).path())!, 'utf8');
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  expect(svg).toContain('>API Gateway</text>');
  expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
});

test('code panel: pasting JSON adds a node in place, undo on the canvas reprints the text', async ({ page }) => {
  const before = await saved(page);
  const next = applyOps(before!.model, [{ op: 'add_node', id: 'Fila', icon: 'aws-sqs' }, { op: 'connect', from: 'Pagamentos', to: 'Fila' }]);
  if (!next.ok) throw new Error(next.error.message);
  await page.getByRole('button', { name: 'Mostrar/ocultar código' }).click();
  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('"id": "Frontend"');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(printDiagramJson(next.model));
  await expect(node(page, 'Fila')).toBeVisible();
  await expect.poll(async () => (await saved(page))?.model.edges.some((e) => e.from === 'Pagamentos' && e.to === 'Fila')).toBe(true);
  await page.getByRole('button', { name: 'Desfazer (⌘Z)' }).click();
  await expect(node(page, 'Fila')).toHaveCount(0);
  await expect.poll(async () => (await saved(page))?.model.elements.Fila ?? 'none').toBe('none');
  await expect(editor).toContainText('"id": "Frontend"');
});

test('code panel: ⌘Z in the editor is the app undo and never empties the diagram', async ({ page }) => {
  const nodes = page.locator('.react-flow__node');
  const count = await nodes.count();
  await page.getByRole('button', { name: 'Mostrar/ocultar código' }).click();
  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('"id": "Frontend"');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+z');
  // Longer than the editor debounce (300 ms) plus the autosave delay (400 ms).
  await page.waitForTimeout(1000);
  await expect(nodes).toHaveCount(count);
  await page.keyboard.press('ControlOrMeta+Home');
  await expect(editor).toContainText('"id": "Frontend"');

  // A canvas step while the editor is open: the editor reprints the text.
  const mobile = node(page, 'Mobile');
  const before = (await mobile.boundingBox())!;
  await mobile.click();
  await page.keyboard.press('Delete');
  await expect(mobile).toHaveCount(0);
  await expect(editor).not.toContainText('Mobile');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(mobile).toBeVisible();
  await expect.poll(async () => (await saved(page))?.model.edges.some((e) => e.from === 'Mobile')).toBe(true);
  await expect(editor).toContainText('"id": "Mobile"');
  // The app undo restores the old box; re-adding Mobile from the text would place it anew.
  expect((await mobile.boundingBox())?.x).toBeCloseTo(before.x, 0);
  expect((await mobile.boundingBox())?.y).toBeCloseTo(before.y, 0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(mobile).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(1000);
  await expect(nodes).toHaveCount(count);
  await expect.poll(async () => (await saved(page))?.model.order.length).toBe(count);
});

test('code panel: Undo/Redo from the Edit or context menu (beforeinput) is the app history too', async ({ page }) => {
  await page.getByRole('button', { name: 'Mostrar/ocultar código' }).click();
  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('"id": "Mobile"');
  const mobile = node(page, 'Mobile');
  await mobile.click();
  await page.keyboard.press('Delete');
  await expect(mobile).toHaveCount(0);
  const menu = (inputType: string) =>
    editor.evaluate((el, type) => el.dispatchEvent(new InputEvent('beforeinput', { inputType: type, bubbles: true, cancelable: true })), inputType);
  await menu('historyUndo');
  await expect(mobile).toBeVisible();
  await expect.poll(async () => (await saved(page))?.model.edges.some((e) => e.from === 'Mobile')).toBe(true);
  await expect(editor).toContainText('"id": "Mobile"');
  await menu('historyRedo');
  await expect(mobile).toHaveCount(0);
  await expect(editor).not.toContainText('Mobile');
});

const edgeIds = (data: Saved | null) => (data?.model.edges ?? []).map((e) => `${e.from}→${e.to}`);

test('AI panel offline: preview "adicione Redis entre API Gateway e Pedidos", apply, one undo reverts', async ({ page }) => {
  // No network: the AI server "has no key" (503), so the offline interpreter answers.
  await page.route('**/api/ai/**', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'IA indisponível: defina ANTHROPIC_API_KEY no servidor.' }) }),
  );
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByRole('region', { name: 'Assistente de IA' });
  await panel.getByLabel('Instrução para a IA').fill('adicione Redis entre API Gateway e Pedidos');
  await panel.getByRole('button', { name: 'Enviar' }).click();
  await expect(panel.getByText('modo offline')).toBeVisible();
  await expect(panel.getByText('Adicionei "Redis" entre "API Gateway" e "Pedidos".')).toBeVisible();
  await expect(page.locator('.react-flow__edge.sk-diff-added')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge.sk-diff-removed')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Adicionar nó (N)' })).toBeDisabled();
  await expect(page.getByText('Revise a proposta da IA: aplique ou descarte antes de editar.')).toBeVisible();
  await page.getByRole('button', { name: 'Mostrar/ocultar código' }).click();
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');

  await panel.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.locator('.sk-diff-added, .sk-diff-removed, .sk-diff-changed')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
  await expect(page.locator('.cm-content')).toContainText('"id": "Frontend"');
  await expect.poll(async () => edgeIds(await saved(page))).toContain('API Gateway→Redis');
  const applied = edgeIds(await saved(page));
  expect(applied).toContain('Redis→Pedidos');
  expect(applied).not.toContain('API Gateway→Pedidos');

  await page.getByRole('button', { name: 'Desfazer (⌘Z)' }).click();
  await expect.poll(async () => edgeIds(await saved(page))).toContain('API Gateway→Pedidos');
  const reverted = edgeIds(await saved(page));
  expect(reverted).not.toContain('API Gateway→Redis');
  expect(reverted).not.toContain('Redis→Pedidos');
});

test('AI addition automatically reorganizes the diagram and undo restores its previous positions', async ({ page }) => {
  const before = await saved(page);
  await page.route('**/api/ai/diagram', (route) => route.fulfill({
    json: {
      ops: [
        { op: 'add_node', id: 'Auth', parentId: 'Serviços', icon: 'lock' },
        { op: 'connect', from: 'API Gateway', to: 'Auth', label: 'validar token' },
      ],
      summary: 'Adicionei Auth.',
      model: 'mock',
    },
  }));
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByRole('region', { name: 'Assistente de IA' });
  await panel.getByLabel('Instrução para a IA').fill('adicione um serviço Auth');
  await panel.getByRole('button', { name: 'Enviar' }).click();
  await expect(node(page, 'Auth')).toBeVisible();
  await expect(panel.getByText('Adicionei Auth.')).toBeVisible();
  await panel.getByRole('button', { name: 'Aplicar' }).click();

  await expect.poll(async () => (await saved(page))?.model.elements.Auth?.parentId).toBe('Serviços');
  const after = await saved(page);
  expect(after?.layout.nodes['Web App']).not.toEqual(before?.layout.nodes['Web App']);
  expect(after?.layout.nodes.Auth).toBeDefined();

  await page.getByRole('button', { name: 'Desfazer (⌘Z)' }).click();
  await expect.poll(async () => (await saved(page))?.model.elements.Auth).toBeUndefined();
  await expect.poll(async () => (await saved(page))?.layout.nodes['Web App']).toEqual(before?.layout.nodes['Web App']);
});

test('documentation modal sanitizes AI markdown: no images, no CSS, javascript: stripped, links open in a new tab', async ({ page }) => {
  const markdown = [
    '# Loja',
    '',
    '## Visão geral',
    '',
    'Texto <img src=x onerror="window.__xss=1">',
    '',
    '<script>window.__xss=2</script>',
    '',
    '![pixel](https://evil.example/md.png)',
    '',
    '<img src="https://evil.example/raw.png">',
    '',
    '<div style="background-image:url(https://evil.example/style.png)">x</div>',
    '',
    '<style>body{background:url(https://evil.example/sheet.png)}</style>',
    '',
    '[clique](javascript:window.__xss=3)',
    '',
    '[site](https://example.com)',
    '',
    '| a | b |',
    '|:-|-:|',
    '| 1 | 2 |',
    '',
  ].join('\n');
  const leaks: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('evil.example')) leaks.push(r.url());
  });
  await page.route('**://evil.example/**', (route) => route.abort());
  await page.route('**/api/ai/doc', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ markdown }) }));
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('gerar doc');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Documentação da arquitetura' });
  await expect(dialog.getByRole('heading', { name: 'Loja' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Visão geral' })).toBeVisible();
  await expect(dialog.locator('img, style, [style], [src], [srcset], [background]')).toHaveCount(0);
  await expect(dialog.locator('a[href^="javascript:" i]')).toHaveCount(0);
  const site = dialog.getByRole('link', { name: 'site' });
  await expect(site).toHaveAttribute('target', '_blank');
  await expect(site).toHaveAttribute('rel', /noopener/);
  await expect(dialog.getByRole('table')).toBeVisible();
  expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
  await expect.poll(() => leaks).toEqual([]);
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Baixar .md' }).click();
  expect((await download).suggestedFilename()).toBe('arquitetura.md');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
