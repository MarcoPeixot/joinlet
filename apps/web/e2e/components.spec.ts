import { expect, test } from '@playwright/test';
import { BASIC_SHAPES, COMPONENT_PRESETS } from '@strukt/core';
import { CLOUD_COMPONENT_PRESETS } from '@strukt/core/cloud';
import { savedDiagram } from './storage';

test('library inserts a queue, supports undo and preserves its form after reload', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
  await page.getByRole('button', { name: 'Biblioteca de componentes', exact: true }).click();
  const library = page.getByRole('dialog', { name: 'Biblioteca de componentes' });
  await expect(library.getByRole('button', { name: /^Adicionar / })).toHaveCount(Math.min(90, COMPONENT_PRESETS.length + CLOUD_COMPONENT_PRESETS.length));
  await library.getByRole('combobox', {name:'Biblioteca de componentes'}).selectOption('basics');
  await library.getByRole('textbox', { name: 'Buscar componente' }).fill('fila');
  await expect(library.getByRole('button', { name: /^Adicionar / })).toHaveCount(1);
  await library.getByRole('button', { name: 'Adicionar Fila', exact: true }).click();
  await page.locator('.strukt-label-input').press('Enter');
  await expect(page.locator('.react-flow__node[data-id="Fila"]')).toBeVisible();
  await expect.poll(async () => (await savedDiagram(page))?.model.elements.Fila?.icon).toBe('layers');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.react-flow__node[data-id="Fila"]')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('.react-flow__node[data-id="Fila"]')).toBeVisible();
  await expect.poll(async () => (await savedDiagram(page))?.model.elements.Fila?.icon).toBe('layers');
  await page.reload();
  await expect(page.locator('.react-flow__node[data-id="Fila"]')).toBeVisible();
});

test('library fits a mobile screen and searches without accents', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Biblioteca de componentes', exact: true }).click();
  const library = page.getByRole('dialog', { name: 'Biblioteca de componentes' });
  const box = (await library.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await library.getByRole('textbox', { name: 'Buscar componente' }).fill('usuario');
  await library.getByRole('button', { name: 'Adicionar Usuário', exact: true }).click();
  await page.locator('.strukt-label-input').press('Enter');
  await expect.poll(async () => (await savedDiagram(page))?.model.elements['Usuário']?.icon).toBe('user');
  await page.getByRole('button', { name: 'Biblioteca de componentes', exact: true }).click();
  await library.getByRole('textbox', { name: 'Buscar componente' }).fill('xyz');
  await expect(library.getByText('Nenhum componente encontrado.')).toBeVisible();
});

test('basic shapes contain multiline labels and legacy nodes stay readable', async ({ page }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Mostrar/ocultar código' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(JSON.stringify({ version: 1, style: { typeface: 'clean', styleMode: 'plain' }, nodes: [
    ...BASIC_SHAPES.map((shape) => ({ id: shape, shape, icon: 'layers', label: 'Processamento assíncrono\nde arquivos do projeto' })),
    { id: 'Legacy module', shape: 'package', icon: 'layers', label: 'Módulo de conversas', tech: 'Módulo NestJS' },
  ], connections: [] }));
  await expect(page.locator('.react-flow__node')).toHaveCount(BASIC_SHAPES.length + 1);
  await expect(page.locator('.react-flow__node-icon[data-id="Legacy module"]')).toBeVisible();
  await expect(page.locator('[data-id="Legacy module"] .strukt-icon-node__technology')).toHaveText('Módulo NestJS');
  await page.getByRole('button', { name: 'Mostrar/ocultar código' }).click();
  const clipped = await page.locator('.strukt-node__content').evaluateAll((contents) => contents.flatMap((content) => {
    const label = content.querySelector('.strukt-label')!;
    const a = content.getBoundingClientRect(), b = label.getBoundingClientRect();
    return b.x < a.x - 1 || b.right > a.right + 1 || b.y < a.y - 1 || b.bottom > a.bottom + 1 ? [content.closest('[data-id]')?.getAttribute('data-id')] : [];
  }));
  expect(clipped).toEqual([]);
});
