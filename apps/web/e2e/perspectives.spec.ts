import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from './storage';
import { togglePanel } from './panelMenu';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const applyPerspective = async (page: Page, name: string) => {
  if (!(await panel(page).isVisible())) await togglePanel(page, 'Perspectivas');
  await panel(page).getByRole('listitem').filter({has:page.getByText(name,{exact:true})}).getByRole('button',{name:'Aplicar',exact:true}).click();
};
const panel = (page: Page) => page.getByRole('complementary', { name: 'Perspectivas' });

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(node(page, 'Kafka')).toBeVisible();
});

/** "Sugerir níveis C4" from the palette, then accept what it proposes. */
async function acceptSuggestedLevels(page: Page) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('sugerir níveis');
  await page.keyboard.press('Enter');
  const suggestions = panel(page).getByRole('group', { name: 'Níveis sugeridos' });
  await expect(suggestions).toBeVisible();
  // Proposed, not applied: nothing is tagged until the person accepts.
  expect(await readFile(page, 'model.json')).toBeNull();
  await panel(page).getByRole('button', { name: /^Aceitar \d+/ }).click();
  await expect(suggestions).toHaveCount(0);
}

test('suggested C4 levels are only a proposal until accepted, then become tags', async ({ page }) => {
  await acceptSuggestedLevels(page);
  await expect.poll(async () => {
    const shared = JSON.parse((await readFile(page, 'model.json')) ?? '{"entities":{},"views":{}}') as { entities: Record<string, { tags?: string[] }>; views: Record<string, Record<string, string>> };
    const levelOf = (id: string) => shared.entities[shared.views.exemplo?.[id] ?? '']?.tags?.find((tag) => tag.startsWith('nivel:'));
    return [levelOf('Serviços'), levelOf('Pedidos'), levelOf('Kafka')];
  }).toEqual(['nivel:contexto', 'nivel:container', 'nivel:contexto']);
  await expect(panel(page)).toContainText('0 sem nível');
  // Accepting changes the tags of shared entities, never the diagram.
  await expect(node(page, 'Pedidos')).toBeVisible();
});

test('a C4 perspective is a reading: it hides what is out of the level, leaves the diagram whole, and exports what it shows', async ({ page }) => {
  await acceptSuggestedLevels(page);
  const before = await readFile(page, 'diagrams/exemplo.strukt.json');
  await applyPerspective(page,'C4: Contexto');
  await togglePanel(page,'Perspectivas');
  const banner = page.getByRole('status').filter({ hasText: 'C4: Contexto' });
  await expect(banner).toContainText('visão de leitura');
  await expect(node(page, 'Pedidos')).toHaveCount(0);
  await expect(node(page, 'Web App')).toHaveCount(0);
  await expect(node(page, 'Serviços')).toBeVisible();
  await expect(node(page, 'Kafka')).toBeVisible();

  // The export is the reading too.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await page.getByRole('menuitem', { name: /Exportar SVG/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('diagrama-c4-contexto.svg');
  const svg = await (await import('node:fs/promises')).readFile((await file.path())!, 'utf8');
  expect(svg).toContain('Kafka');
  expect(svg).not.toContain('Pedidos');

  // Leaving brings everything back; nothing was saved or undoable in between.
  await banner.getByRole('button', { name: 'Sair da perspectiva' }).click();
  await expect(node(page, 'Pedidos')).toBeVisible();
  await expect(banner).toHaveCount(0);
  await page.waitForTimeout(600);
  expect(await readFile(page, 'diagrams/exemplo.strukt.json')).toBe(before);
});

test('a saved perspective survives a reload and can be applied again', async ({ page }) => {
  // A level set by hand in the Inspector (the element becomes shared to carry it).
  await node(page, 'Pedidos').click();
  await page.getByRole('tab', { name: 'Editar' }).click();
  await page.getByText('Modelo e compartilhamento', {exact:true}).click();
  await page.getByRole('combobox', { name: 'Nível C4' }).selectOption('container');
  await expect.poll(async () => JSON.stringify(JSON.parse((await readFile(page, 'model.json')) ?? '{"entities":{}}').entities)).toContain('nivel:container');

  await togglePanel(page, 'Perspectivas');
  await panel(page).getByRole('button', { name: 'Nova perspectiva', exact: true }).click();
  await panel(page).getByRole('textbox', { name: 'Nome' }).fill('Só containers');
  await panel(page).getByRole('textbox', { name: 'Nome' }).press('Tab');
  await panel(page).getByRole('button', { name: 'Container', exact: true }).click();
  await expect.poll(async () => JSON.parse((await readFile(page, 'diagrams/exemplo.perspectives.json')) ?? '{}').perspectives?.[0]).toMatchObject({ id: 'nova-perspectiva', name: 'Só containers', levels: ['container'] });

  await page.reload();
  await expect(node(page, 'Kafka')).toBeVisible();
  await applyPerspective(page,'Só containers');
  await expect(page.getByRole('status').filter({ hasText: 'Só containers' })).toBeVisible();
  await expect(node(page, 'Pedidos')).toBeVisible();
  await expect(node(page, 'Kafka')).toHaveCount(0);
});

test('"esmaecer o resto" keeps every element and fades what does not match', async ({ page }) => {
  await node(page, 'Pedidos').click();
  await page.getByRole('tab', { name: 'Editar' }).click();
  await page.getByText('Modelo e compartilhamento', {exact:true}).click();
  await page.getByRole('combobox', { name: 'Nível C4' }).selectOption('container');
  await togglePanel(page, 'Perspectivas');
  await panel(page).getByRole('button', { name: 'Nova perspectiva', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Container', exact: true }).click();
  await panel(page).getByRole('switch', { name: /Esmaecer o resto/ }).click();
  await panel(page).getByRole('button', { name: 'Aplicar', exact: true }).first().click();
  await expect(node(page, 'Kafka')).toHaveClass(/sk-dim/);
  await expect(node(page, 'Pedidos')).not.toHaveClass(/sk-dim/);
  await expect(page.locator('.react-flow__node')).toHaveCount(11);
});
