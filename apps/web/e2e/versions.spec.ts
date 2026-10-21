import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { listFiles, readFile, savedDiagram } from './storage';
import { togglePanel } from './panelMenu';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const versionsPanel = (page: Page) => page.getByRole('complementary', { name: 'Versões' });
const versionFiles = async (page: Page) => (await listFiles(page)).filter((path) => path.startsWith('versions/exemplo/') && !path.endsWith('/index.json'));

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(node(page, 'Kafka')).toBeVisible();
});

test('save a version with ⌘S, change the diagram, compare on the canvas and restore it', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+s');
  const dialog = page.getByRole('dialog', { name: 'Salvar versão' });
  await dialog.getByLabel('Descrição da versão').fill('Antes de tirar o Kafka');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await versionFiles(page)).length).toBe(1);

  await node(page, 'Kafka').click();
  await page.keyboard.press('Delete');
  await expect(node(page, 'Kafka')).toHaveCount(0);

  await togglePanel(page, 'Versões');
  await versionsPanel(page).getByRole('button', { name: /Antes de tirar o Kafka/ }).click();
  await expect(page.locator('.react-flow__node.sk-diff-added')).toHaveCount(1);
  await expect(node(page, 'Kafka')).toHaveClass(/sk-diff-added/);
  await expect(page.locator('.react-flow__edge.sk-diff-added')).toHaveCount(2);
  await expect(versionsPanel(page).getByRole('list', { name: 'Mudanças' })).toContainText('+ Kafka');
  await expect(page.getByRole('button', { name: 'Adicionar nó (N)' })).toBeDisabled();

  await versionsPanel(page).getByRole('button', { name: 'Restaurar esta versão' }).click();
  await expect(page.locator('.sk-diff-added, .sk-diff-removed, .sk-diff-changed')).toHaveCount(0);
  await expect(node(page, 'Kafka')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adicionar nó (N)' })).toBeEnabled();
  await expect.poll(async () => (await savedDiagram(page))?.model.elements.Kafka?.icon).toBe('kafka');
  await expect(versionsPanel(page).getByRole('button', { name: /Restaurado de/ })).toBeVisible();
  await expect.poll(async () => (await versionFiles(page)).length).toBe(2);

  await page.getByRole('button', { name: 'Desfazer (⌘Z)' }).click();
  await expect(node(page, 'Kafka')).toHaveCount(0);
});

test('accepting an AI proposal records a version by the AI', async ({ page }) => {
  await page.route('**/api/ai/**', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'IA indisponível: defina ANTHROPIC_API_KEY no servidor.' }) }),
  );
  await page.keyboard.press('ControlOrMeta+j');
  const ai = page.getByRole('region', { name: 'Assistente de IA' });
  await ai.getByLabel('Instrução para a IA').fill('remova Kafka');
  await ai.getByRole('button', { name: 'Enviar' }).click();
  await ai.getByRole('button', { name: 'Aplicar' }).click();
  await expect(node(page, 'Kafka')).toHaveCount(0);

  await togglePanel(page, 'Versões');
  const entry = versionsPanel(page).getByRole('listitem').first();
  await expect(entry).toContainText('IA');
  await expect.poll(async () => (await versionFiles(page)).length).toBe(1);
  const [path] = await versionFiles(page);
  expect(JSON.parse((await readFile(page, path!))!)).toMatchObject({ author: 'ai' });
});

test('"Gerar contexto para agentes" writes ARCHITECTURE.md with the diagram JSON and keeps it fresh', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Menu do workspace' }).click();
  await page.getByRole('menuitem', { name: /Gerar contexto para agentes/ }).click();
  const modal = page.getByRole('dialog', { name: 'Contexto para agentes' });
  await expect(modal.getByLabel('Prévia do ARCHITECTURE.md')).toContainText('```json');
  await expect(modal.getByRole('list', { name: 'Arquivos gerados' })).toContainText('.arch/context/llms.txt');
  await expect(modal.getByLabel('Trecho para AGENTS.md')).toContainText('.arch/context/ARCHITECTURE.md');

  const json = await readFile(page, 'diagrams/exemplo.strukt.json');
  expect(await readFile(page, 'context/ARCHITECTURE.md')).toContain(`\`\`\`json\n${json!.trimEnd()}\n\`\`\``);
  expect(await readFile(page, 'context/llms.txt')).toMatch(/^# Meu workspace\n\n> /);

  const download = page.waitForEvent('download');
  await modal.getByRole('button', { name: 'Baixar .zip' }).click();
  expect((await download).suggestedFilename()).toBe('meu-workspace-contexto.zip');
  await modal.getByRole('button', { name: 'Fechar contexto' }).click();

  await page.getByRole('button', { name: 'Adicionar nó (N)' }).click();
  await page.keyboard.type('Stripe');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await readFile(page, 'context/ARCHITECTURE.md')) ?? '').toContain('| `Stripe` | nó |');
});
