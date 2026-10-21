import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from './storage';

async function projects(page: Page) {
  await page.getByRole('button', { name: 'Menu do workspace' }).click();
  await page.getByRole('menuitem', { name: 'Meus projetos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meus projetos' })).toBeVisible();
}

async function create(page: Page, name: string) {
  await page.getByRole('button', { name: 'Novo workspace', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo workspace', exact: true });
  await dialog.getByRole('textbox', { name: 'Nome do workspace' }).fill(name);
  await dialog.getByRole('button', { name: 'Criar workspace' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toContainText(name);
}

async function note(page: Page, text: string) {
  await page.getByRole('button', { name: 'Novo documento', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nome do documento' }).fill('Contrato');
  await page.keyboard.press('Enter');
  const editor = page.getByLabel('Editor do documento').locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
  await expect.poll(() => readFile(page, 'docs/contrato.md')).toBe(text);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
});

test('creates isolated projects, preserves the legacy workspace and remembers the last opened project', async ({ page }) => {
  const legacy = await readFile(page, 'diagrams/exemplo.strukt.json');
  const extras = { 'versions/exemplo/preserved.json': '{"saved":"original version bytes"}', 'context/preserved.md': '# Contexto original\n' };
  await page.evaluate(async (files) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('strukt');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      for (const [path, text] of Object.entries(files)) tx.objectStore('files').put(text, path);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, extras);
  await projects(page);
  await expect(page.getByRole('button', { name: 'Abrir workspace Meu workspace', exact: true })).toBeVisible();
  await create(page, 'Projeto A');
  expect(JSON.parse((await readFile(page, 'strukt.json'))!).diagrams).toEqual([]);
  await note(page, '# Contrato de A');
  await projects(page);
  await create(page, 'Projeto B');
  expect(await readFile(page, 'docs/contrato.md')).toBeNull();
  await note(page, '# Contrato de B');
  await projects(page);
  await page.getByRole('button', { name: 'Abrir workspace Projeto A', exact: true }).click();
  await expect.poll(() => readFile(page, 'docs/contrato.md')).toBe('# Contrato de A');
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toContainText('Projeto A');
  await projects(page);
  await page.getByRole('textbox', { name: 'Buscar projetos' }).fill('não existe');
  await expect(page.getByRole('heading', { name: 'Nenhum projeto encontrado' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Buscar projetos' }).fill('');
  await page.getByRole('button', { name: 'Abrir workspace Meu workspace', exact: true }).click();
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
  expect(await readFile(page, 'diagrams/exemplo.strukt.json')).toBe(legacy);
  for (const [path, text] of Object.entries(extras)) expect(await readFile(page, path)).toBe(text);
});

test('two tabs creating projects preserve both catalog entries and their current project identity', async ({ page, context }) => {
  const other = await context.newPage();
  await other.goto('/app/');
  await expect(other.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
  await Promise.all([projects(page), projects(other)]);
  await Promise.all([create(page, 'A em outra aba'), create(other, 'B em outra aba')]);
  await projects(page);
  await expect(page.getByRole('button', { name: 'Abrir workspace A em outra aba', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir workspace B em outra aba', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir workspace A em outra aba', exact: true })).toContainText('Atual');
  await other.close();
});

test('an empty project can configure its repository from the workspace menu', async ({ page }) => {
  await projects(page);
  await create(page, 'Projeto vazio');
  await page.getByRole('button', { name: 'Menu do workspace' }).click();
  await page.getByRole('menuitem', { name: 'Conectar repositório…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Conectar repositório', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Pasta do repositório', exact: true })).toBeVisible();
});

test('migrates an unavailable remembered repository without targeting it from the browser project', async ({ page }) => {
  await page.route('**/api/git/connect', (route) => route.fulfill({ status: 400, json: { error: 'Repositório indisponível.' } }));
  await page.evaluate(async () => {
    localStorage.setItem('strukt:repo', '/projetos/indisponivel');
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('strukt');
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').delete('catalog');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
  await projects(page);
  await expect(page.getByRole('button', { name: 'Abrir workspace indisponivel', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir workspace indisponivel', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Repositório indisponível');
  await expect(page.getByRole('button', { name: 'Abrir workspace Meu workspace', exact: true })).toContainText('Atual');
});

test('equal project names remain independent, and renaming preserves the project identity', async ({ page }) => {
  await projects(page);
  await create(page, 'NORA');
  await note(page, 'Primeiro');
  await projects(page);
  await create(page, 'NORA');
  expect(await readFile(page, 'docs/contrato.md')).toBeNull();
  await page.getByRole('button', { name: 'Menu do workspace' }).click();
  await page.getByRole('menuitem', { name: 'Renomear workspace', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nome do workspace', exact: true }).fill('NORA 2');
  await page.keyboard.press('Enter');
  await projects(page);
  await expect(page.getByRole('button', { name: 'Abrir workspace NORA 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir workspace NORA', exact: true }).click();
  await expect.poll(() => readFile(page, 'docs/contrato.md')).toBe('Primeiro');
});

test('an invalid JSON buffer survives a refused switch, and returning to the editor preserves it', async ({ page }) => {
  await page.getByRole('button', { name: 'Mostrar/ocultar código' }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('{ inválido');
  await projects(page);
  await page.getByRole('button', { name: 'Novo workspace', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo workspace', exact: true });
  await dialog.getByRole('textbox', { name: 'Nome do workspace' }).fill('Bloqueado');
  await dialog.getByRole('button', { name: 'Criar workspace' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Corrija o JSON');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByRole('button', { name: 'Voltar ao workspace' }).click();
  await expect(editor).toContainText('{ inválido');
});

test('the project list and create form work on mobile and cancel without adding a project', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  if (!(await page.getByRole('navigation', { name: 'Workspace' }).isVisible())) {
    await page.getByRole('button', { name: 'Mostrar/ocultar barra lateral (⌘\\)' }).click();
  }
  await projects(page);
  await page.getByRole('button', { name: 'Novo workspace', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo workspace', exact: true });
  await expect(dialog.getByRole('button', { name: 'Criar workspace' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Projetos', exact: true }).getByRole('button')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
