import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const chip = (page: Page) => page.getByRole('status', { name: 'Primeiro acesso' });
const nodes = (page: Page) => page.locator('.react-flow__node');

async function newDiagram(page: Page, title: string) {
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Novo diagrama' }).click();
  await page.getByRole('textbox', { name: 'Nome do diagrama' }).fill(title);
  await page.keyboard.press('Enter');
}

const checklist = (page: Page) => page.getByRole('region', { name: 'Primeiros passos' });

test('the first visit explains the sample and stays dismissed after reload', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
  await expect(chip(page)).toContainText('Este é um exemplo');
  await chip(page).getByRole('button', { name: 'Dispensar aviso' }).click();
  await expect(chip(page)).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
  await expect(chip(page)).toHaveCount(0);
});

test('one onboarding surface at a time: the checklist waits for the first-run note', async ({ page }) => {
  await page.goto('/app/');
  await expect(chip(page)).toBeVisible();
  await expect(checklist(page)).toHaveCount(0);
  await chip(page).getByRole('button', { name: 'Dispensar aviso' }).click();
  await expect(chip(page)).toHaveCount(0);
  await expect(checklist(page)).toBeVisible();
  await expect(checklist(page)).toContainText('Começando · 0/4');
});

test('editing the sample retires the note and brings the checklist, already ticked', async ({ page }) => {
  await page.goto('/app/');
  await expect(chip(page)).toBeVisible();
  await page.getByRole('button', { name: /Adicionar nó/ }).first().click();
  await expect(chip(page)).toHaveCount(0);
  await expect(checklist(page)).toContainText('Começando · 1/4');
});

test('the empty state sends the prompt to the AI composer and offers models', async ({ page }) => {
  await page.goto('/app/');
  await chip(page).getByRole('button', { name: 'Dispensar aviso' }).click();
  await newDiagram(page, 'Vazio');
  const box = page.getByRole('textbox', { name: 'Descreva o sistema' });
  await expect(page.getByRole('button', { name: 'Gerar com IA' })).toBeDisabled();
  await box.fill('api com fila e banco');
  await expect(page.getByRole('button', { name: 'Gerar com IA' })).toBeEnabled();
  await expect(page.getByRole('group', { name: 'Modelos' }).getByRole('button', { name: 'Microsserviços' })).toBeVisible();
});

test('an empty diagram lets its start card speak alone; the checklist comes back with the first node', async ({ page }) => {
  await page.goto('/app/');
  await chip(page).getByRole('button', { name: 'Dispensar aviso' }).click();
  await expect(checklist(page)).toBeVisible();
  await newDiagram(page, 'Vazio');
  await expect(page.getByRole('heading', { name: 'Descreva sua arquitetura' })).toBeVisible();
  await expect(checklist(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Adicionar nó (N)' }).click();
  await expect(page.getByRole('heading', { name: 'Descreva sua arquitetura' })).toHaveCount(0);
  await expect(checklist(page)).toContainText('Começando · 1/4');
});

test('an edited sample never shows the chip again, even undismissed after reload', async ({ page }) => {
  await page.goto('/app/');
  await expect(chip(page)).toContainText('Este é um exemplo');
  await page.getByRole('button', { name: /Adicionar nó/ }).first().click();
  await expect(nodes(page)).toHaveCount(12);
  await expect(chip(page)).toHaveCount(0);
  await page.waitForTimeout(800);
  await page.reload();
  await expect(nodes(page).first()).toBeVisible();
  await expect(chip(page)).toHaveCount(0);
});

test('Limpar empties the sample in a single undoable step', async ({ page }) => {
  await page.goto('/app/');
  await expect(nodes(page).first()).toBeVisible();
  await chip(page).getByRole('button', { name: 'Limpar' }).click();
  await expect(nodes(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Desfazer (⌘Z)' }).click();
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
});

test('a template fills an empty diagram and one undo removes it', async ({ page }) => {
  await page.goto('/app/');
  await expect(nodes(page).first()).toBeVisible();
  await newDiagram(page, 'Do zero');
  await expect(page.getByRole('heading', { name: 'Descreva sua arquitetura' })).toBeVisible();
  await page.getByRole('group', { name: 'Modelos' }).getByRole('button', { name: 'Microsserviços' }).click();
  await expect(page.locator('.react-flow__node[data-id="Gateway de API"]')).toBeVisible();
  expect(await nodes(page).count()).toBeGreaterThanOrEqual(5);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(nodes(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Descreva sua arquitetura' })).toBeVisible();
});

test('the tour walks the anchors and can be replayed from the checklist', async ({ page }) => {
  await page.goto('/app/');
  await expect(nodes(page).first()).toBeVisible();
  await chip(page).getByRole('button', { name: 'Dispensar aviso' }).click();
  await checklist(page).getByRole('button', { name: 'Fazer o tour' }).click();
  const tour = page.getByRole('dialog', { name: /^Tour:/ });
  await expect(tour).toContainText('O canvas');
  await tour.getByRole('button', { name: 'Próximo' }).click();
  await expect(tour).toContainText('IA');
  await tour.getByRole('button', { name: 'Pular' }).click();
  await expect(tour).toHaveCount(0);
});

test('empty documents get a formatting toolbar and a link action', async ({ page }) => {
  await page.goto('/app/');
  await expect(nodes(page).first()).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Workspace' });
  await nav.getByRole('button', { name: 'Novo documento' }).click();
  await page.getByRole('textbox', { name: /documento/i }).fill('Notas');
  await page.keyboard.press('Enter');
  const toolbar = page.getByRole('toolbar', { name: 'Formatação' });
  await expect(toolbar).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await expect(page.getByText('Documento em branco')).toBeVisible();
  await toolbar.getByRole('button', { name: 'Negrito' }).click();
  await expect(page.getByLabel('Editor do documento')).toContainText('**texto**');
  await page.getByRole('button', { name: 'Vincular a um nó' }).click();
  await page.getByRole('menuitem', { name: 'Kafka' }).click();
  await expect(page.getByRole('region', { name: 'Referenciado por' }).getByRole('button', { name: /Kafka/ })).toBeVisible();
});
