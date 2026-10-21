import { expect, test } from '@playwright/test';
import { readFile, savedDiagram } from './storage';
import { axeFindings } from './support/axe';
const chat = (page: import('@playwright/test').Page) => page.getByRole('complementary', { name: 'Chat com a IA', exact: true });
const send = async (page: import('@playwright/test').Page, text: string) => { await chat(page).getByRole('textbox', { name: 'Mensagem para a IA' }).fill(text); await chat(page).getByRole('button', { name: 'Enviar', exact: true }).click(); };
test.use({ reducedMotion: 'reduce' });

for (const theme of ['dark', 'light'] as const) test(`multiple editable diagrams share one canvas in ${theme}`, async ({ page }, info) => {
  await page.addInitScript(theme => localStorage.setItem('strukt:theme', theme), theme);
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
  await page.route('**/api/ai/chat', route => {
    const target = route.request().postDataJSON().target;
    const existing = JSON.parse(target.content).nodes;
    const edit = existing.some((node: { canvasFrame?: boolean }) => node.canvasFrame) ? { kind: 'add_canvas_diagram', summary: 'Terceiro desenho adicionado.', title: 'Observabilidade', ops: [{ op: 'add_node', id: 'Métricas', icon: 'activity', description: 'Coleta de métricas' }, { op: 'add_node', id: 'Painel' }, { op: 'connect', from: 'Métricas', to: 'Painel' }] } : { kind: 'split_diagram', destination: 'canvas', summary: 'Dois diagramas no mesmo canvas.', parts: [{ title: 'Visão geral', elements: existing.map((node: { id: string }) => node.id) }, { title: 'Serviços', elements: [existing.find((node: { id: string }) => node.id === 'Serviços').id] }] };
    return route.fulfill({ contentType: 'application/x-ndjson', body: [{ t: 'Organizando o canvas.' }, { edit }, { done: true }].map(e => JSON.stringify(e)).join('\n') + '\n' });
  });
  await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
  await send(page, 'Divida em dois diagramas aqui no mesmo canvas');
  await expect(chat(page).getByText('Dois diagramas no mesmo canvas.', { exact: true })).toBeVisible();
  await expect(page.locator('.strukt-group[data-canvas-frame]')).toHaveCount(2);
  await expect.poll(async () => (await savedDiagram(page))?.model.elements['Visão geral']?.kind).toBe('group');
  const before = (await savedDiagram(page))!;
  expect(JSON.parse((await readFile(page, 'strukt.json'))!).diagrams).toHaveLength(1);
  const previousNodes = before.layout.nodes;
  await send(page, 'Adicione outro diagrama de observabilidade ao lado');
  await expect(page.locator('.strukt-group[data-canvas-frame]')).toHaveCount(3);
  await expect.poll(async () => (await savedDiagram(page))?.model.elements.Métricas?.description).toBe('Coleta de métricas');
  const after = (await savedDiagram(page))!;
  for (const [id, box] of Object.entries(previousNodes)) expect(after.layout.nodes[id]).toEqual(box);
  await page.screenshot({ path: info.outputPath('multiple-diagrams-chat.png'), animations: 'disabled' });
  await chat(page).getByRole('button', { name: 'Desfazer alteração' }).last().click();
  await expect(page.locator('.strukt-group[data-canvas-frame]')).toHaveCount(2);
  await expect.poll(async () => (await savedDiagram(page))?.model.order.length).toBe(before.model.order.length);
  await page.reload();
  await expect(page.locator('.strukt-group[data-canvas-frame]')).toHaveCount(2);
  if (await chat(page).isVisible()) await chat(page).getByRole('button', { name: 'Fechar chat', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar diagrama ao canvas', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Diagramas no canvas', exact: true });
  await expect(picker.getByRole('button', { name: 'Organizar Serviços verticalmente', exact: true })).toBeVisible();
  expect(await axeFindings(page)).toEqual([]);
  await picker.getByLabel('Nome do diagrama no canvas').fill('Novo fluxo');
  await picker.getByRole('button', { name: 'Criar área vazia', exact: true }).click();
  await expect(page.locator('.strukt-group[data-canvas-frame]')).toHaveCount(3);
  await page.getByRole('button', { name: 'Adicionar nó (N)', exact: true }).click();
  await page.locator('.strukt-label-input').fill('Etapa local'); await page.locator('.strukt-label-input').press('Enter');
  await expect.poll(async () => { const m = (await savedDiagram(page))?.model; return m?.elements['Etapa local']?.parentId; }).toBe('Novo fluxo');
});

test('the chat organizes folders from the board with persistence, confirmed receipts and undo', async ({ page }) => {
  await page.goto('/app/');
  const nav = page.getByRole('navigation', { name: 'Workspace' });
  await nav.getByRole('button', { name: 'Overview', exact: true }).click();
  let n = 0;
  await page.route('**/api/ai/chat', route => {
    const body = route.request().postDataJSON();
    if (++n > 1) {
      expect(body.messages.some((m: { content: string }) => m.content.includes('Resultado confirmado pelo Joinlet: Workspace organizado.'))).toBe(true);
      return route.fulfill({ json: { reply: 'O Joinlet confirmou a organização.' } });
    }
    expect(body.target.kind).toBe('workspace');
    return route.fulfill({ json: { reply: 'Organização preparada.', edit: { kind: 'workspace', summary: 'Workspace organizado.', ops: [{ op: 'create_folder', kind: 'diagram', path: 'Arquitetura/RAG' }, { op: 'move_item', kind: 'diagram', slug: 'exemplo', folder: 'Arquitetura/RAG' }, { op: 'rename_item', kind: 'diagram', slug: 'exemplo', title: 'Visão geral' }] } } });
  });
  await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
  await send(page, 'Organize meus diagramas em pastas');
  await expect(chat(page).getByText('Workspace organizado.', { exact: true })).toBeVisible();
  await expect(nav.getByRole('group', { name: 'Pasta Arquitetura/RAG', exact: true })).toBeVisible();
  await expect.poll(async () => JSON.parse((await readFile(page, 'strukt.json'))!).diagrams[0].folder).toBe('Arquitetura/RAG');
  await send(page, 'Você aplicou a organização?');
  await expect(chat(page).getByText('O Joinlet confirmou a organização.', { exact: true })).toBeVisible();
  await chat(page).getByRole('button', { name: 'Desfazer alteração', exact: true }).click();
  await expect.poll(async () => JSON.parse((await readFile(page, 'strukt.json'))!).diagrams[0].folder).toBeUndefined();
  await page.reload();
  expect(JSON.parse((await readFile(page, 'strukt.json'))!).diagrams[0].title).toBe('Exemplo');
});

test('resize highlights align with sidebar, code and chat borders', async ({ page }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
  const dock = page.getByRole('separator', { name: 'Redimensionar painel lateral', exact: true });
  await expect(dock).toBeVisible();
  const line = async (el: import('@playwright/test').Locator) => el.evaluate(node => { const rect = node.getBoundingClientRect(), after = getComputedStyle(node, '::after'); return { x: rect.x + parseFloat(after.left), y: rect.y + parseFloat(after.top), w: parseFloat(after.width) }; });
  const panel = chat(page);
  await expect.poll(async () => Math.abs((await line(dock)).x - (await panel.boundingBox())!.x)).toBeLessThan(0.6);
  expect((await line(dock)).y).toBe((await panel.boundingBox())!.y + 10);
  await dock.focus(); await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => Math.abs((await line(dock)).x - (await panel.boundingBox())!.x)).toBeLessThan(0.6);
  const sidebar = page.getByRole('separator', { name: 'Redimensionar sidebar', exact: true });
  const nav = page.getByRole('navigation', { name: 'Workspace' });
  const sidebarLine = await sidebar.evaluate(node => { const r = node.getBoundingClientRect(), a = getComputedStyle(node, '::after'); return r.right - parseFloat(a.right) - parseFloat(a.width); });
  expect(Math.abs(sidebarLine - ((await nav.boundingBox())!.x + (await nav.boundingBox())!.width - 1))).toBeLessThan(0.6);
  await page.getByRole('button', { name: 'Mostrar/ocultar código', exact: true }).click();
  const code = page.getByRole('separator', { name: 'Redimensionar código', exact: true });
  await expect(code).toBeVisible(); await expect(code).toHaveAttribute('tabindex', '0');
  await expect(page.locator('.cm-content')).toBeVisible();
  const codeLine = await code.evaluate(node => { const r = node.getBoundingClientRect(), a = getComputedStyle(node, '::after'); return r.right - parseFloat(a.right) - parseFloat(a.width); });
  const codePanel = (await page.locator('.sk-code-dock').boundingBox())!;
  expect(Math.abs(codeLine - (codePanel.x + codePanel.width - 1))).toBeLessThan(.6);
  await dock.focus();
  expect(await code.getAttribute('title')).toBeNull();
  await page.screenshot({ path: test.info().outputPath('aligned-panel-dividers.png'), animations: 'disabled' });
});

test('imports another workspace diagram into an independent editable area without changing its original file', async ({ page }) => {
  await page.goto('/app/');
  const nav = page.getByRole('navigation', { name: 'Workspace' });
  await nav.getByRole('button', { name: 'Novo diagrama', exact: true }).click();
  await nav.getByRole('textbox', { name: 'Nome do diagrama', exact: true }).fill('Pagamentos');
  await nav.getByRole('textbox', { name: 'Nome do diagrama', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Adicionar nó (N)', exact: true }).click();
  await page.locator('.strukt-label-input').fill('Kafka'); await page.locator('.strukt-label-input').press('Enter');
  await expect.poll(async () => (await savedDiagram(page, 'pagamentos'))?.model.order).toEqual(['Kafka']);
  const source = await readFile(page, 'diagrams/pagamentos.strukt.json');
  await nav.getByRole('button', { name: 'Exemplo', exact: true }).click();
  const before = (await savedDiagram(page))!;
  await page.getByRole('button', { name: 'Adicionar diagrama ao canvas', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar Pagamentos ao canvas', exact: true }).click();
  await expect(page.locator('.strukt-group[data-canvas-frame]')).toHaveCount(1);
  await expect.poll(async () => (await savedDiagram(page))!.model.order.length).toBe(before.model.order.length + 2);
  const after = (await savedDiagram(page))!;
  expect(after.model.order.filter(id => (after.model.elements[id]?.label ?? id) === 'Kafka')).toHaveLength(2);
  for (const [id, box] of Object.entries(before.layout.nodes)) expect(after.layout.nodes[id]).toEqual(box);
  expect(await readFile(page, 'diagrams/pagamentos.strukt.json')).toBe(source);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await savedDiagram(page))!.model.order.length).toBe(before.model.order.length);
  expect(await readFile(page, 'diagrams/pagamentos.strukt.json')).toBe(source);
});

test('the diagram-area menu fits a phone and saves an empty area in the same file', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('strukt:theme', 'dark'));
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Adicionar diagrama ao canvas', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Diagramas no canvas', exact: true });
  await expect(picker).toBeVisible();
  const bounds = (await picker.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  expect(await axeFindings(page)).toEqual([]);
  await page.screenshot({ path: info.outputPath('canvas-diagrams-mobile.png'), animations: 'disabled' });
  await picker.getByLabel('Nome do diagrama no canvas').fill('Fluxo adicional');
  await picker.getByRole('button', { name: 'Criar área vazia', exact: true }).click();
  await expect.poll(async () => (await savedDiagram(page))?.model.elements['Fluxo adicional']?.kind === 'group' && (await savedDiagram(page))?.model.elements['Fluxo adicional'] && 'canvasFrame' in (await savedDiagram(page))!.model.elements['Fluxo adicional']!).toBe(true);
  expect(JSON.parse((await readFile(page, 'strukt.json'))!).diagrams).toHaveLength(1);
  await page.reload();
  await expect(page.locator('.strukt-group[data-canvas-frame]')).toHaveCount(1);
});
