import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Workspace' });

async function newDoc(page: Page, title: string) {
  await sidebar(page).getByRole('button', { name: 'Novo documento' }).click();
  await page.getByRole('textbox', { name: /documento/i }).fill(title);
  await page.keyboard.press('Enter');
  await expect(sidebar(page).getByRole('button', { name: title, exact: true })).toBeVisible();
}

/** A real drag: a few intermediate moves, so the browser starts the drag session and fires dragover on the target. */
async function drag(page: Page, from: Locator, to: Locator) {
  const [a, b] = [(await from.boundingBox())!, (await to.boundingBox())!];
  await page.mouse.move(a.x + 40, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 46, a.y + a.height / 2 - 4, { steps: 3 });
  await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}

/** Folder and item buttons only show while the row is hovered (or focused). */
async function openFolderMenu(page: Page, name: string) {
  await sidebar(page).getByRole('button', { name: new RegExp(`^${name}`) }).hover();
  await sidebar(page).getByRole('button', { name: `Ações da pasta ${name}` }).click();
}

async function newFolder(page: Page, section: string, name: string) {
  await sidebar(page).getByRole('button', { name: `Nova pasta de ${section}` }).click();
  await page.getByRole('textbox', { name: 'Nome da pasta' }).fill(name);
  await page.keyboard.press('Enter');
  await expect(sidebar(page).getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
});

test('a folder holds docs; moving, folding and reloading keep them there', async ({ page }) => {
  await newDoc(page, 'Notas');
  await newFolder(page, 'documentos', 'Guias');
  await sidebar(page).getByRole('button', { name: 'Notas', exact: true }).hover(); // the row's buttons show on hover
  await sidebar(page).getByRole('button', { name: 'Mover Notas para uma pasta' }).click();
  await page.getByRole('menuitem', { name: 'Guias' }).click();
  const group = sidebar(page).getByRole('group', { name: 'Pasta Guias' });
  await expect(group.getByRole('button', { name: 'Notas', exact: true })).toBeVisible();

  const toggle = sidebar(page).getByRole('button', { name: /^Guias/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(group).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await expect(sidebar(page).getByRole('button', { name: /^Guias/ })).toHaveAttribute('aria-expanded', 'false');
  await sidebar(page).getByRole('button', { name: /^Guias/ }).click();
  await expect(sidebar(page).getByRole('group', { name: 'Pasta Guias' }).getByRole('button', { name: 'Notas', exact: true })).toBeVisible();
});

test('diagrams have folders too, and dragging an item onto a folder moves it', async ({ page }) => {
  await sidebar(page).getByRole('button', { name: 'Novo diagrama' }).click();
  await page.getByRole('textbox', { name: 'Nome do diagrama' }).fill('Pagamentos');
  await page.keyboard.press('Enter');
  await expect(sidebar(page).getByRole('button', { name: 'Pagamentos', exact: true })).toBeVisible();
  await newFolder(page, 'diagramas', 'Backend');
  await drag(page, sidebar(page).getByRole('button', { name: 'Pagamentos', exact: true }), sidebar(page).getByRole('button', { name: /^Backend/ }));
  await expect(sidebar(page).getByRole('group', { name: 'Pasta Backend' }).getByRole('button', { name: 'Pagamentos', exact: true })).toBeVisible();
  // The diagram still opens from inside the folder.
  await sidebar(page).getByRole('button', { name: 'Exemplo', exact: true }).click();
  await sidebar(page).getByRole('group', { name: 'Pasta Backend' }).getByRole('button', { name: 'Pagamentos', exact: true }).click();
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toHaveCount(0);
});

test('sketches have folders too, and the folder sits inside its section', async ({ page }) => {
  await sidebar(page).getByRole('button', { name: 'Novo sketch' }).click();
  await page.getByRole('textbox', { name: /sketch/i }).fill('oi');
  await page.keyboard.press('Enter');
  await expect(sidebar(page).getByRole('button', { name: 'oi', exact: true })).toBeVisible();
  await expect(page.locator('.excalidraw')).toBeVisible(); // the heavy editor has loaded: nothing shifts mid-drag
  await newFolder(page, 'sketches', 'teste');
  // The sketch editor is still settling right after it opens: retry the drag until the drop lands.
  await expect(async () => {
    await drag(page, sidebar(page).getByRole('button', { name: 'oi', exact: true }), sidebar(page).getByRole('button', { name: /^teste/ }));
    await expect(sidebar(page).getByRole('group', { name: 'Pasta teste' }).getByRole('button', { name: 'oi', exact: true })).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 12_000 });
  // Hierarchy: the folder is a child of its section, so it starts to the right of the section title.
  const title = (await sidebar(page).getByRole('button', { name: /^Sketches/ }).boundingBox())!;
  const folder = (await sidebar(page).getByRole('button', { name: /^teste/ }).boundingBox())!;
  expect(folder.x).toBeGreaterThan(title.x + 6);
});

test('folder menu: new item inside, rename, and delete keeps the content one level up', async ({ page }) => {
  await newFolder(page, 'documentos', 'Guias');
  await openFolderMenu(page, 'Guias');
  await page.getByRole('menuitem', { name: 'Novo documento aqui' }).click();
  await page.getByRole('textbox', { name: /documento/i }).fill('Dentro');
  await page.keyboard.press('Enter');
  await expect(sidebar(page).getByRole('group', { name: 'Pasta Guias' }).getByRole('button', { name: 'Dentro', exact: true })).toBeVisible();

  await openFolderMenu(page, 'Guias');
  await page.getByRole('menuitem', { name: 'Renomear pasta' }).click();
  await page.getByRole('textbox', { name: 'Nome da pasta' }).fill('Manuais');
  await page.keyboard.press('Enter');
  await expect(sidebar(page).getByRole('group', { name: 'Pasta Manuais' }).getByRole('button', { name: 'Dentro', exact: true })).toBeVisible();

  await openFolderMenu(page, 'Manuais');
  await page.getByRole('menuitem', { name: 'Excluir pasta' }).click();
  await expect(sidebar(page).getByRole('group', { name: 'Pasta Manuais' })).toHaveCount(0);
  await expect(sidebar(page).getByRole('button', { name: 'Dentro', exact: true })).toBeVisible();
});

test('Overview: a selected card offers "Abrir" and goes to the item', async ({ page }) => {
  await newDoc(page, 'Notas');
  await sidebar(page).getByRole('button', { name: 'Overview', exact: true }).click();
  const card = page.locator('.react-flow__node[data-id="doc:notas"]');
  await expect(card).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir Notas', exact: true })).toHaveCount(0);
  await card.click();
  await page.getByRole('button', { name: 'Abrir Notas', exact: true }).click();
  await expect(page.getByLabel('Editor do documento')).toBeVisible();
  // A diagram card opens the canvas.
  await sidebar(page).getByRole('button', { name: 'Overview', exact: true }).click();
  await page.locator('.react-flow__node[data-id="diagram:exemplo"]').click();
  await page.getByRole('button', { name: 'Abrir Exemplo', exact: true }).click();
  await expect(page.locator('.react-flow__node[data-id="Kafka"]')).toBeVisible();
});
