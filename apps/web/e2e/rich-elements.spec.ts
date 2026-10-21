import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { savedDiagram } from './storage';
import { pathPoints } from './paths';

async function useTemplate(page: Page, title: string) {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Modelos de diagramas', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Explorar modelos', exact: true }).click();
  const gallery = page.getByRole('dialog', { name: 'Modelos de diagramas' });
  await gallery.getByRole('button', { name: `Ver modelo ${title}`, exact: true }).click();
  await gallery.getByRole('button', { name: 'Usar modelo', exact: true }).click();
  await expect(gallery).toHaveCount(0);
}

test('table fields, typed keys and cardinality remain editable through undo and reload', async ({ page }) => {
  await useTemplate(page, 'Banco relacional de pedidos');
  const slug = 'banco-relacional-de-pedidos';
  const clients = page.locator('.react-flow__node[data-id="Clientes"]');
  await clients.locator('.strukt-data-table__header').click();
  const inspector = page.getByRole('complementary', { name: 'Propriedades', exact: true });
  await inspector.getByRole('tab', { name: 'Editar', exact: true }).click();
  await inspector.getByRole('button', { name: 'Adicionar campo', exact: true }).click();
  await inspector.getByRole('textbox', { name: 'Nome do campo 4', exact: true }).fill('workspace_id');
  await inspector.getByRole('textbox', { name: 'Nome do campo 4', exact: true }).press('Enter');
  await inspector.getByRole('textbox', { name: 'Tipo do campo 4', exact: true }).fill('uuid');
  await inspector.getByRole('textbox', { name: 'Tipo do campo 4', exact: true }).press('Enter');
  await inspector.getByRole('combobox', { name: 'Chave do campo 4', exact: true }).selectOption('FK');
  await expect.poll(async () => (await savedDiagram(page, slug))?.model.elements.Clientes!.fields?.[3]).toEqual({ name: 'workspace_id', type: 'uuid', key: 'FK' });
  await expect(clients.locator('.strukt-data-table__row')).toHaveCount(4);
  await inspector.getByRole('button', { name: 'Excluir campo workspace_id', exact: true }).click();
  await expect(clients.locator('.strukt-data-table__row')).toHaveCount(3);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(clients.locator('.strukt-data-table__row')).toHaveCount(4);
  await inspector.getByRole('button', { name: 'Fechar propriedades', exact: true }).click();
  const edge = page.locator('.react-flow__edge[data-id="Clientes→Pedidos"] .react-flow__edge-path');
  const [, midpoint] = await pathPoints(edge, 2);
  await page.mouse.click(midpoint!.x, midpoint!.y);
  await inspector.getByRole('combobox', { name: 'Cardinalidade do destino', exact: true }).selectOption('many');
  await expect.poll(async () => (await savedDiagram(page, slug))?.model.edges[0]!.toCardinality).toBe('many');
  await page.reload();
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Banco relacional de pedidos', exact: true }).click();
  await expect(clients.locator('.strukt-data-table__row')).toHaveCount(4);
  await expect.poll(async () => (await savedDiagram(page, slug))?.model.elements.Clientes!.fields?.[3]!.key).toBe('FK');
});

test('sequence headers, lifelines and horizontal messages survive reordering and undo', async ({ page }) => {
  await useTemplate(page, 'Requisição de API');
  const slug = 'requisicao-de-api';
  await expect(page.locator('.react-flow__node-participant')).toHaveCount(4);
  const edge = page.locator('.react-flow__edge[data-id="Cliente→API"] .react-flow__edge-path');
  const [start, midpoint, end] = await pathPoints(edge, 2);
  expect(Math.abs(start!.y - end!.y)).toBeLessThan(1);
  await page.mouse.click(midpoint!.x, midpoint!.y);
  const inspector = page.getByRole('complementary', { name: 'Propriedades', exact: true });
  await inspector.getByRole('button', { name: 'Descer', exact: true }).click();
  await expect.poll(async () => (await savedDiagram(page, slug))?.model.edges[1]!.from).toBe('Cliente');
  await expect(page.locator('.strukt-edge-label').filter({ hasText: '2. GET /pedidos + token' })).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.strukt-edge-label').filter({ hasText: '1. GET /pedidos + token' })).toHaveCount(1);
  await expect(page.locator('.strukt-participant__lifeline')).toHaveCount(4);
  const reply = page.locator('.react-flow__edge[data-id="API→Cliente"] .react-flow__edge-path');
  expect(await reply.getAttribute('style')).toContain('stroke-dasharray: 6, 5');
  await page.reload();
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Requisição de API', exact: true }).click();
  await expect(page.locator('.react-flow__node-participant')).toHaveCount(4);
  const restored = await pathPoints(edge, 2);
  expect(Math.abs(restored[0]!.y - restored[2]!.y)).toBeLessThan(1);
});
