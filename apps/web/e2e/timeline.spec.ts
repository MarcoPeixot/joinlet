import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { listFiles, readFile } from './storage';
import { togglePanel } from './panelMenu';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const panel = (page: Page) => page.getByRole('complementary', { name: 'Linha do tempo' });
const ruler = (page: Page) => panel(page).getByRole('list', { name: 'Régua do tempo' });
const point = (page: Page, name: RegExp | string) => ruler(page).getByRole('button', { name });
const versionFiles = async (page: Page) => (await listFiles(page)).filter((path) => path.startsWith('versions/exemplo/') && !path.endsWith('/index.json'));
const GOAL = '2099-01-15';

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(node(page, 'Kafka')).toBeVisible();
});

test('plan a future state, open the ruler, compare on the canvas and apply it', async ({ page }) => {
  // The present: saved as a plain version, then the diagram is reshaped into the future (no Kafka).
  await page.keyboard.press('ControlOrMeta+s');
  const save = page.getByRole('dialog', { name: 'Salvar versão' });
  await save.getByLabel('Descrição da versão').fill('Estado de hoje');
  await save.getByRole('button', { name: 'Salvar' }).click();
  await expect(save).toHaveCount(0);
  await node(page, 'Kafka').click();
  await page.keyboard.press('Delete');
  await expect(node(page, 'Kafka')).toHaveCount(0);

  // "Planejar estado futuro" from the command palette: opens the panel and the dialog.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox').fill('Planejar estado futuro');
  await page.keyboard.press('Enter');
  const plan = page.getByRole('dialog', { name: 'Planejar estado futuro' });
  await expect(plan).toBeVisible();
  await plan.getByLabel('Descrição do estado').fill('Sem Kafka');
  await plan.getByLabel('Meta').fill(GOAL);
  await plan.getByRole('button', { name: 'Planejar' }).click();
  await expect(plan).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
  await expect.poll(async () => (await versionFiles(page)).length).toBe(2);
  const files = await Promise.all((await versionFiles(page)).map(async (path) => JSON.parse((await readFile(page, path))!)));
  expect(files.find((v) => v.message === 'Sem Kafka')).toMatchObject({ stage: 'planejado', target: GOAL });
  expect(files.find((v) => v.message === 'Estado de hoje')).not.toHaveProperty('stage');

  // The ruler: past → hoje → planned, with the countdown.
  await expect(ruler(page).getByRole('listitem')).toHaveCount(3);
  await expect(ruler(page).getByRole('listitem').nth(0)).toContainText('Estado de hoje');
  await expect(ruler(page).getByRole('listitem').nth(1)).toContainText('Hoje');
  await expect(ruler(page).getByRole('listitem').nth(2)).toContainText('Sem Kafka');
  await expect(ruler(page).getByRole('listitem').nth(2)).toContainText('Meta 15/01/2099');
  await expect(ruler(page).getByRole('listitem').nth(2)).toContainText(/faltam \d+ dias/);
  await expect(panel(page).getByText(/Próxima meta:/)).toContainText('Sem Kafka');

  // Back to the present: the past point compared with today shows Kafka returning, and applying it is the restore.
  await point(page, /Estado de hoje/).click();
  await expect(panel(page).getByRole('region', { name: 'Comparação' })).toContainText('3 removidos');
  await expect(page.getByRole('button', { name: 'Adicionar nó (N)' })).toBeDisabled();
  await panel(page).getByRole('button', { name: 'Aplicar este estado' }).click();
  await expect(node(page, 'Kafka')).toBeVisible();
  await expect(page.locator('.sk-diff-added, .sk-diff-removed, .sk-diff-changed')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Adicionar nó (N)' })).toBeEnabled();

  // The planned point against today: what changes until the goal, drawn on the read-only canvas.
  await point(page, /Sem Kafka/).click();
  const card = panel(page).getByRole('region', { name: 'Comparação' });
  await expect(card).toContainText('Hoje');
  await expect(card).toContainText('Meta 15/01/2099');
  await expect(card.getByRole('list', { name: 'Mudanças' })).toContainText('− Kafka');
  await expect(page.locator('.react-flow__node.sk-diff-removed')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Adicionar nó (N)' })).toBeDisabled();

  // Two points: the earlier to the later one, in the direction of time.
  await point(page, /Estado de hoje/).click();
  await expect(card).toContainText('De Estado de hoje até Sem Kafka');
  await expect(card.getByRole('list', { name: 'Mudanças' })).toContainText('− Kafka');
  await expect(card.getByRole('button', { name: /Aplicar este estado/ })).toHaveCount(2);

  // Apply the planned state (the existing restore: one undo step), then undo it.
  await card.getByRole('button', { name: 'Aplicar este estado · Sem Kafka' }).click();
  await expect(node(page, 'Kafka')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Adicionar nó (N)' })).toBeEnabled();
  await page.getByRole('button', { name: 'Desfazer (⌘Z)' }).click();
  await expect(node(page, 'Kafka')).toBeVisible();

  // Closing the panel ends a comparison.
  await point(page, /Sem Kafka/).click();
  await expect(page.getByRole('button', { name: 'Adicionar nó (N)' })).toBeDisabled();
  await panel(page).getByRole('button', { name: 'Fechar linha do tempo' }).click();
  await expect(page.getByRole('button', { name: 'Adicionar nó (N)' })).toBeEnabled();
  await expect(page.locator('.sk-diff-removed')).toHaveCount(0);
});

test('an invalid goal is explained in the dialog and nothing is saved; Versões labels the planned state', async ({ page }) => {
  await togglePanel(page, 'Linha do tempo');
  await expect(panel(page).getByText('Nenhum estado salvo ainda')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Planejar estado futuro' }).first().click();
  const plan = page.getByRole('dialog', { name: 'Planejar estado futuro' });
  await plan.getByRole('button', { name: 'Transição' }).click();
  await plan.getByLabel('Descrição do estado').fill('Passo 1');
  await plan.getByLabel('Meta').fill(GOAL);
  await plan.getByRole('button', { name: 'Planejar' }).click();
  await expect(plan).toHaveCount(0);
  await expect(point(page, /Passo 1/)).toContainText('Transição');

  await togglePanel(page, 'Versões');
  await expect(page.getByRole('complementary', { name: 'Versões' }).getByRole('listitem').first()).toContainText('Transição até 15/01/2099');
  expect((await versionFiles(page)).length).toBe(1);
});
