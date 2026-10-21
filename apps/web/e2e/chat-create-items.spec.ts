import { expect, test } from '@playwright/test';
import { readFile as readLocalFile } from 'node:fs/promises';
import { readFile, savedDiagram } from './storage';

test.use({ reducedMotion: 'reduce' });
const created = { kind: 'create_workspace_items', summary: 'Documento, arquitetura e sketch criados.', items: [
  { kind: 'doc', title: 'Requisitos', folder: 'Planejamento', markdown: '# Requisitos\n\nTranscrição ao vivo com vários participantes.\n\nRetenção: a definir.' },
  { kind: 'diagram', title: 'Arquitetura', folder: 'Arquitetura', ops: [{ op: 'add_node', id: 'Áudio', icon: 'mic' }, { op: 'add_node', id: 'Fila', icon: 'kafka' }, { op: 'connect', from: 'Áudio', to: 'Fila', type: '-->' }] },
  { kind: 'sketch', title: 'Fluxo', folder: 'Arquitetura', layout: 'horizontal', upsert: [{ id: 'api', type: 'rectangle', x: 0, y: 0, width: 220, height: 100, text: 'API de transcrição' }] },
] };
const panel = (page: import('@playwright/test').Page) => page.getByRole('complementary', { name: 'Chat com a IA', exact: true });
const send = async (page: import('@playwright/test').Page) => {
  await panel(page).getByRole('textbox', { name: 'Mensagem para a IA' }).fill('Você mesmo pode criar no workspace os documentos, diagramas e sketches.');
  await panel(page).getByRole('button', { name: 'Enviar', exact: true }).click();
};
test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Menu do workspace' }).click();
  await page.getByRole('menuitem', { name: 'Meus projetos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo workspace', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo workspace', exact: true });
  await dialog.getByRole('textbox', { name: 'Nome do workspace' }).fill('Transcrição');
  await dialog.getByRole('button', { name: 'Criar workspace' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => JSON.parse((await readFile(page, 'strukt.json'))!).diagrams).toEqual([]);
  await page.getByRole('button', { name: 'Chat com a IA', exact: true }).click();
});

test('chat creates complete content and folders from an empty workspace, opens documents, undoes and persists on reload', async ({ page }, info) => {
  await page.route('**/api/ai/chat', route => {
    const target = route.request().postDataJSON().target;
    expect(target.kind).toBe('workspace');
    expect(JSON.parse(target.workspace).diagrams).toEqual([]);
    return route.fulfill({ contentType: 'application/x-ndjson', body: [{ t: 'Preparando os arquivos.' }, { edit: created }, { done: true }].map(e => JSON.stringify(e)).join('\n') + '\n' });
  });
  await send(page);
  await expect(panel(page).getByText(created.summary, { exact: true })).toBeVisible();
  for (const id of ['doc:requisitos', 'diagram:arquitetura', 'sketch:fluxo']) await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toBeVisible();
  await expect.poll(async () => (await savedDiagram(page, 'arquitetura'))?.model.order).toEqual(['Áudio', 'Fila']);
  expect((await savedDiagram(page, 'arquitetura'))?.layout.nodes['Áudio']).toBeTruthy();
  await expect.poll(() => readFile(page, 'docs/requisitos.md')).toContain('Retenção: a definir.');
  await expect.poll(async () => JSON.parse((await readFile(page, 'sketches/fluxo.excalidraw')) ?? '{"elements":[]}').elements.some((e: { text?: string }) => e.text === 'API de transcrição')).toBe(true);
  await page.screenshot({ path: info.outputPath('chat-created-workspace.png'), animations: 'disabled' });
  await page.locator('.react-flow__node[data-id="doc:requisitos"]').dblclick();
  await expect(page.getByLabel('Editor do documento').locator('.cm-content')).toContainText('Transcrição ao vivo');
  await panel(page).getByRole('button', { name: 'Desfazer alteração', exact: true }).click();
  await expect.poll(async () => JSON.parse((await readFile(page, 'strukt.json'))!).docs).toEqual([]);
  await expect.poll(() => readFile(page, 'docs/requisitos.md')).toBeNull();
  await send(page);
  await expect.poll(async () => JSON.parse((await readFile(page, 'strukt.json'))!).diagrams).toHaveLength(1);
  await page.reload();
  await expect(page.locator('.react-flow__node[data-id="Áudio"]')).toBeVisible();
  const manifest = JSON.parse((await readFile(page, 'strukt.json'))!);
  expect(manifest.docs[0]?.folder).toBe('Planejamento'); expect(manifest.sketches[0]?.folder).toBe('Arquitetura');
});

test('an invalid later drawing and an interrupted response cannot leave a partially created workspace', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/ai/chat', route => {
    if (++calls === 1) return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ edit: created }) + '\n' });
    const edit = { ...created, items: [created.items[0], { kind: 'diagram', title: 'Inválido', ops: [{ op: 'connect', from: 'A', to: 'B' }] }] };
    return route.fulfill({ json: { reply: 'Preparado', edit } });
  });
  await send(page); await expect(panel(page).getByRole('alert')).toContainText('interrompida');
  expect(JSON.parse((await readFile(page, 'strukt.json'))!).docs).toEqual([]);
  await panel(page).getByRole('button', { name: 'Tentar de novo', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toContainText('Inválido');
  expect(JSON.parse((await readFile(page, 'strukt.json'))!).docs).toEqual([]);
});

test('a creation returned by the real provider is accepted and persisted by the browser', async ({ page }) => {
  test.skip(!process.env.STRUKT_LIVE_CREATION_FIXTURE, 'Optional real-provider fixture generated outside the test suite.');
  const edit = JSON.parse(await readLocalFile(process.env.STRUKT_LIVE_CREATION_FIXTURE!, 'utf8'));
  await page.route('**/api/ai/chat', route => route.fulfill({ json: { reply: 'Arquivos preparados.', edit } }));
  await send(page);
  await expect(panel(page).getByText(edit.summary, { exact: true })).toBeVisible();
  await expect.poll(async () => { const manifest = JSON.parse((await readFile(page, 'strukt.json'))!); return manifest.docs.length + manifest.diagrams.length + manifest.sketches.length; }).toBe(edit.items.length);
  const manifest = JSON.parse((await readFile(page, 'strukt.json'))!);
  for (const doc of manifest.docs) expect((await readFile(page, `docs/${doc.slug}.md`))?.length).toBeGreaterThan(20);
  for (const drawing of manifest.diagrams) expect((await savedDiagram(page, drawing.slug))!.model.order.length).toBeGreaterThan(0);
});
